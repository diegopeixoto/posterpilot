import { isDeepStrictEqual } from 'node:util';
import { resolveConfig, type AppConfig } from '$lib/server/config';
import {
	canonicalConfigPath,
	clearConfigCommitCancellationAtBinding,
	clearConfigCommitProofAtBinding,
	discardUnpublishedConfigCommitProofAtBinding,
	finalizePublishedConfigCommitProofAtBinding,
	inspectConfigCommitProofAtBinding,
	recoverConfigCommitProofAtBinding
} from './config-io';
import {
	completeKometaConfigMutationCheckpointBundle,
	discardKometaConfigMutationCheckpoint,
	finalizeKometaConfigMutationCheckpointCleanup,
	loadKometaConfigMutationCheckpoint,
	type KometaConfigMutationCheckpointV1
} from './config-mutation-checkpoint';
import {
	withKometaMigrationControlLock,
	type KometaMigrationControlLease
} from './migration-control-lock';
import { resolveKometaServerBinding } from './server-binding';
import type { KometaServerBinding } from './server-binding';
import { kometaStructuredDependencyFingerprint } from './plan';
import { withConfigLock } from './config-io';

export type KometaConfigMutationRecoveryErrorCode =
	| 'kometa_config_recovery_not_required'
	| 'kometa_config_recovery_required'
	| 'kometa_config_recovery_ambiguous'
	| 'kometa_config_recovery_changed';

export class KometaConfigMutationRecoveryError extends Error {
	constructor(readonly code: KometaConfigMutationRecoveryErrorCode) {
		super(code);
		this.name = 'KometaConfigMutationRecoveryError';
	}
}

export interface PublicKometaConfigMutationRecovery {
	status: 'prepared' | 'completed' | 'unreadable';
	scopeMatches: boolean;
	canRecover: boolean;
}

/** Compare only frozen logical scope. Exact file identity is checked by the bound proof recovery. */
function kometaConfigMutationCheckpointScopeMatches(
	checkpoint: KometaConfigMutationCheckpointV1,
	config: AppConfig,
	binding: KometaServerBinding | null
): boolean {
	return (
		binding?.id === checkpoint.serverInstanceId &&
		Boolean(config.kometaConfigPath) &&
		canonicalConfigPath(config.kometaConfigPath) === checkpoint.pathBinding.canonicalPath &&
		config.kometaConfigMode === checkpoint.configMode &&
		(checkpoint.action !== 'structured' ||
			(config.kometaMetadataPathPrefix === checkpoint.metadataPathPrefix &&
				checkpoint.structuredDependencyFingerprint ===
					kometaStructuredDependencyFingerprint({
						serverInstanceId: binding.id,
						plexUrl: binding.plexUrl,
						plexToken: binding.plexToken,
						tmdbKey: config.tmdbKey
					})))
	);
}

async function currentCheckpointScopeMatches(
	checkpoint: KometaConfigMutationCheckpointV1
): Promise<boolean> {
	try {
		const config = await resolveConfig();
		const binding = await resolveKometaServerBinding(config.kometaServerInstanceId);
		return kometaConfigMutationCheckpointScopeMatches(checkpoint, config, binding.binding);
	} catch {
		return false;
	}
}

export async function publicKometaConfigMutationRecoveryState(): Promise<PublicKometaConfigMutationRecovery | null> {
	let checkpoint: KometaConfigMutationCheckpointV1 | null;
	try {
		checkpoint = await loadKometaConfigMutationCheckpoint();
	} catch {
		// Keep SSR available while making every mutation fail closed through the
		// uncaught store error in assertNoPendingKometaConfigMutation().
		return { status: 'unreadable', scopeMatches: false, canRecover: false };
	}
	if (!checkpoint) return null;
	const scopeMatches = await currentCheckpointScopeMatches(checkpoint);
	// A mismatch remains recoverable: the resolver can finish an already-proven
	// publication, or discard an unpublished attempt without applying stale bytes.
	return { status: checkpoint.status, scopeMatches, canRecover: true };
}

export async function assertNoPendingKometaConfigMutation(): Promise<void> {
	if (await loadKometaConfigMutationCheckpoint()) {
		throw new KometaConfigMutationRecoveryError('kometa_config_recovery_required');
	}
}

/** Read under the durable control lease, then renew it to close the insert race. */
export async function assertNoPendingKometaConfigMutationWhileOwned(
	assertControlLockOwned: () => Promise<KometaMigrationControlLease>
): Promise<KometaMigrationControlLease> {
	await assertNoPendingKometaConfigMutation();
	return assertControlLockOwned();
}

function assertSameCheckpoint(
	actual: KometaConfigMutationCheckpointV1 | null,
	expected: KometaConfigMutationCheckpointV1
): KometaConfigMutationCheckpointV1 {
	if (!actual || !isDeepStrictEqual(actual, expected)) {
		throw new KometaConfigMutationRecoveryError('kometa_config_recovery_changed');
	}
	return actual;
}

/**
 * Finish one already-confirmed config mutation from its authenticated checkpoint.
 * The token-specific hardlink is the only accepted proof that proposed bytes were
 * published; equal bytes written by another process remain ambiguous.
 */
async function recoverCheckpointWhileOwned(
	checkpoint: KometaConfigMutationCheckpointV1,
	assertControlLockOwned: () => Promise<KometaMigrationControlLease>
): Promise<{
	checkpoint: KometaConfigMutationCheckpointV1;
	resolution: 'completed' | 'superseded';
}> {
	let current = assertSameCheckpoint(await loadKometaConfigMutationCheckpoint(), checkpoint);

	if (current.status === 'prepared') {
		const scopeMatches = await currentCheckpointScopeMatches(current);
		await assertControlLockOwned();
		const inspected = inspectConfigCommitProofAtBinding(
			current.pathBinding,
			current.proofToken,
			current.sourceContent,
			current.proposedContent
		);
		// Multiple/conflicting proof artifacts are never safe to normalize through
		// the mutating recovery path, even when the live logical scope still matches.
		if (inspected === 'ambiguous') {
			throw new KometaConfigMutationRecoveryError('kometa_config_recovery_ambiguous');
		}
		const shouldCancel = !scopeMatches || inspected === 'cancelled';
		let physical = shouldCancel
			? inspected
			: recoverConfigCommitProofAtBinding(
					current.pathBinding,
					current.proofToken,
					current.sourceContent,
					current.proposedContent
				);

		if (shouldCancel && physical !== 'published') {
			if (physical === 'ambiguous') {
				throw new KometaConfigMutationRecoveryError('kometa_config_recovery_ambiguous');
			}
			// The live dependencies changed after confirmation. Abort only while the
			// exact proposed inode is still unpublished; this never links stale bytes.
			await assertControlLockOwned();
			const discarded = discardUnpublishedConfigCommitProofAtBinding(
				current.pathBinding,
				current.proofToken,
				current.sourceContent,
				current.proposedContent
			);
			if (discarded === 'discarded' || discarded === 'superseded') {
				const discardLease = await assertControlLockOwned();
				await discardKometaConfigMutationCheckpoint(current, discardLease);
				try {
					clearConfigCommitCancellationAtBinding(
						current.pathBinding,
						current.proofToken,
						current.proposedContent
					);
				} catch {
					// The authenticated checkpoint is already gone. A hidden mode-0600
					// cancellation marker remains inert and can be collected later.
				}
				return { checkpoint: current, resolution: 'superseded' };
			}
			if (discarded !== 'published') {
				throw new KometaConfigMutationRecoveryError('kometa_config_recovery_ambiguous');
			}
			physical = 'published';
		}

		if (physical === 'published' && shouldCancel) {
			// Cleanup-only revalidation can never relink proposed bytes if an external
			// editor replaces the target after the non-mutating inspection.
			await assertControlLockOwned();
			physical = finalizePublishedConfigCommitProofAtBinding(
				current.pathBinding,
				current.proofToken,
				current.sourceContent,
				current.proposedContent
			);
		}
		if (physical === 'superseded') {
			// Re-check after renewing the durable lease. With no proof inode and no
			// quarantine, PosterPilot never published this prepared mutation; preserve
			// the external winner and release only the authenticated checkpoint.
			await assertControlLockOwned();
			physical = recoverConfigCommitProofAtBinding(
				current.pathBinding,
				current.proofToken,
				current.sourceContent,
				current.proposedContent
			);
			if (physical === 'superseded') {
				const discardLease = await assertControlLockOwned();
				await discardKometaConfigMutationCheckpoint(current, discardLease);
				return { checkpoint: current, resolution: 'superseded' };
			}
		}
		if (physical === 'not_published') {
			// A valid checkpoint is installed only after its proof is durable. Never
			// recreate a missing proof: an expired owner may still be inside its CAS.
			throw new KometaConfigMutationRecoveryError('kometa_config_recovery_ambiguous');
		}
		if (physical !== 'published') {
			throw new KometaConfigMutationRecoveryError('kometa_config_recovery_ambiguous');
		}
		const lease = await assertControlLockOwned();
		current = await completeKometaConfigMutationCheckpointBundle(current, lease);
	}

	await assertControlLockOwned();
	clearConfigCommitProofAtBinding(current.pathBinding, current.proofToken, current.proposedContent);
	const cleanupLease = await assertControlLockOwned();
	await finalizeKometaConfigMutationCheckpointCleanup(current, cleanupLease);
	return { checkpoint: current, resolution: 'completed' };
}

/** Explicit recovery entry point used by the manager UI after interrupted confirmation. */
export async function recoverPendingKometaConfigMutation(): Promise<{
	recovered: boolean;
	resolution: 'completed' | 'superseded';
	action: KometaConfigMutationCheckpointV1['action'];
}> {
	const initial = await loadKometaConfigMutationCheckpoint();
	if (!initial) {
		throw new KometaConfigMutationRecoveryError('kometa_config_recovery_not_required');
	}
	return withConfigLock(initial.pathBinding.canonicalPath, () =>
		withKometaMigrationControlLock(async (assertControlLockOwned) => {
			const current = assertSameCheckpoint(await loadKometaConfigMutationCheckpoint(), initial);
			const result = await recoverCheckpointWhileOwned(current, assertControlLockOwned);
			return {
				recovered: result.resolution === 'completed',
				resolution: result.resolution,
				action: result.checkpoint.action
			};
		})
	);
}

/** Internal confirm path: finalize the exact freshly prepared checkpoint. */
export async function completePreparedKometaConfigMutation(
	checkpoint: KometaConfigMutationCheckpointV1,
	assertControlLockOwned: () => Promise<KometaMigrationControlLease>
): Promise<KometaConfigMutationCheckpointV1> {
	const result = await recoverCheckpointWhileOwned(checkpoint, assertControlLockOwned);
	if (result.resolution !== 'completed') {
		throw new KometaConfigMutationRecoveryError('kometa_config_recovery_changed');
	}
	return result.checkpoint;
}
