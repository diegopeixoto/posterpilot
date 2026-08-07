import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	load: vi.fn(),
	discard: vi.fn(),
	complete: vi.fn(),
	finalize: vi.fn(),
	resolveConfig: vi.fn(),
	resolveBinding: vi.fn(),
	inspectProof: vi.fn(),
	discardProof: vi.fn(),
	finalizeProof: vi.fn(),
	recoverProof: vi.fn(),
	write: vi.fn(),
	clearCancellation: vi.fn(),
	clearProof: vi.fn(),
	withConfigLock: vi.fn(),
	assertOwned: vi.fn()
}));

vi.mock('./config-mutation-checkpoint', () => ({
	loadKometaConfigMutationCheckpoint: h.load,
	discardKometaConfigMutationCheckpoint: h.discard,
	completeKometaConfigMutationCheckpointBundle: h.complete,
	finalizeKometaConfigMutationCheckpointCleanup: h.finalize
}));
vi.mock('$lib/server/config', () => ({ resolveConfig: h.resolveConfig }));
vi.mock('./server-binding', () => ({ resolveKometaServerBinding: h.resolveBinding }));
vi.mock('./config-io', () => ({
	canonicalConfigPath: (path: string) => path,
	clearConfigCommitCancellationAtBinding: h.clearCancellation,
	clearConfigCommitProofAtBinding: h.clearProof,
	discardUnpublishedConfigCommitProofAtBinding: h.discardProof,
	finalizePublishedConfigCommitProofAtBinding: h.finalizeProof,
	inspectConfigCommitProofAtBinding: h.inspectProof,
	recoverConfigCommitProofAtBinding: h.recoverProof,
	writeConfigAtomicAtBinding: h.write,
	withConfigLock: h.withConfigLock
}));
vi.mock('./migration-control-lock', () => ({
	withKometaMigrationControlLock: async (
		operation: (assertOwned: () => Promise<string>) => unknown
	) => operation(h.assertOwned)
}));

import {
	assertNoPendingKometaConfigMutation,
	publicKometaConfigMutationRecoveryState,
	recoverPendingKometaConfigMutation
} from './config-mutation-recovery';
import { kometaStructuredDependencyFingerprint } from './plan';

const checkpoint = {
	type: 'kometa_config_mutation_checkpoint',
	version: 1,
	status: 'prepared',
	checkpointId: 'checkpoint-1',
	proofToken: 'proof-token-1',
	planId: 'plan-1',
	planDigest: 'a'.repeat(64),
	action: 'raw',
	configMode: 'merge',
	metadataPathPrefix: 'config',
	serverInstanceId: 'server-a',
	pathBinding: {
		version: 1,
		canonicalPath: '/config/config.yml',
		anchorPath: '/config',
		anchorDevice: '1',
		anchorInode: '2'
	},
	sourceContent: 'settings:\n  cache: true\n',
	sourceFingerprint: 'b'.repeat(64),
	proposedContent: 'settings:\n  cache: false\n',
	proposedFingerprint: 'c'.repeat(64),
	structuredDependencyFingerprint: null,
	stateCommit: { managedSettings: {} }
} as const;

describe('Kometa config mutation recovery projection', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.resolveConfig.mockResolvedValue({
			kometaConfigPath: '/config/config.yml',
			kometaConfigMode: 'merge',
			kometaMetadataPathPrefix: 'config',
			kometaServerInstanceId: 'server-a',
			tmdbKey: 'tmdb-secret'
		});
		h.resolveBinding.mockResolvedValue({
			status: 'ready',
			binding: {
				id: 'server-a',
				name: 'Plex A',
				plexUrl: 'https://plex.example',
				plexToken: 'plex-secret'
			}
		});
		h.withConfigLock.mockImplementation(async (_path: string, operation: () => Promise<unknown>) =>
			operation()
		);
		h.assertOwned.mockResolvedValue('lease');
		h.complete.mockImplementation(async (prepared: typeof checkpoint) => ({
			...prepared,
			status: 'completed'
		}));
		h.finalize.mockResolvedValue(undefined);
		h.discard.mockResolvedValue(undefined);
		h.discardProof.mockReturnValue('discarded');
		h.finalizeProof.mockReturnValue('published');
	});

	it('keeps SSR available with a redacted fail-closed state when the checkpoint is corrupt', async () => {
		const corrupt = new Error('decrypted secret payload is invalid');
		h.load.mockRejectedValue(corrupt);

		await expect(publicKometaConfigMutationRecoveryState()).resolves.toEqual({
			status: 'unreadable',
			scopeMatches: false,
			canRecover: false
		});
		await expect(assertNoPendingKometaConfigMutation()).rejects.toBe(corrupt);
		expect(h.resolveConfig).not.toHaveBeenCalled();
	});

	it('keeps structured recovery available when a frozen credential dependency changes', async () => {
		const structured = {
			...checkpoint,
			action: 'structured',
			structuredDependencyFingerprint: kometaStructuredDependencyFingerprint({
				serverInstanceId: 'server-a',
				plexUrl: 'https://plex.example',
				plexToken: 'plex-secret',
				tmdbKey: 'tmdb-secret'
			})
		};
		h.load.mockResolvedValue(structured);

		await expect(publicKometaConfigMutationRecoveryState()).resolves.toMatchObject({
			scopeMatches: true,
			canRecover: true
		});
		h.resolveConfig.mockResolvedValue({
			kometaConfigPath: '/config/config.yml',
			kometaConfigMode: 'merge',
			kometaMetadataPathPrefix: 'config',
			kometaServerInstanceId: 'server-a',
			tmdbKey: 'rotated-tmdb-secret'
		});
		await expect(publicKometaConfigMutationRecoveryState()).resolves.toMatchObject({
			scopeMatches: false,
			canRecover: true
		});
	});

	it('finishes a target published before the database bundle and then removes the proof', async () => {
		h.load
			.mockResolvedValueOnce(checkpoint)
			.mockResolvedValueOnce(checkpoint)
			.mockResolvedValueOnce(checkpoint);
		h.recoverProof.mockReturnValue('published');

		await expect(recoverPendingKometaConfigMutation()).resolves.toEqual({
			recovered: true,
			resolution: 'completed',
			action: 'raw'
		});

		expect(h.write).not.toHaveBeenCalled();
		expect(h.complete).toHaveBeenCalledWith(checkpoint, 'lease');
		expect(h.clearProof).toHaveBeenCalledWith(
			checkpoint.pathBinding,
			checkpoint.proofToken,
			checkpoint.proposedContent
		);
		expect(h.finalize).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'completed' }),
			'lease'
		);
	});

	it('preserves an external winner and discards only the authenticated prepared checkpoint', async () => {
		h.load
			.mockResolvedValueOnce(checkpoint)
			.mockResolvedValueOnce(checkpoint)
			.mockResolvedValueOnce(checkpoint);
		h.recoverProof.mockReturnValue('superseded');

		await expect(recoverPendingKometaConfigMutation()).resolves.toEqual({
			recovered: false,
			resolution: 'superseded',
			action: 'raw'
		});

		expect(h.recoverProof).toHaveBeenCalledTimes(2);
		expect(h.discard).toHaveBeenCalledWith(checkpoint, 'lease');
		expect(h.write).not.toHaveBeenCalled();
		expect(h.complete).not.toHaveBeenCalled();
		expect(h.clearProof).not.toHaveBeenCalled();
		expect(h.finalize).not.toHaveBeenCalled();
	});

	it('fails closed instead of recreating a missing durable proof', async () => {
		h.load
			.mockResolvedValueOnce(checkpoint)
			.mockResolvedValueOnce(checkpoint)
			.mockResolvedValueOnce(checkpoint);
		h.recoverProof.mockReturnValue('not_published');

		await expect(recoverPendingKometaConfigMutation()).rejects.toMatchObject({
			code: 'kometa_config_recovery_ambiguous'
		});

		expect(h.write).not.toHaveBeenCalled();
		expect(h.complete).not.toHaveBeenCalled();
	});

	it('leaves the checkpoint and proof untouched when physical publication is ambiguous', async () => {
		h.load
			.mockResolvedValueOnce(checkpoint)
			.mockResolvedValueOnce(checkpoint)
			.mockResolvedValueOnce(checkpoint);
		h.recoverProof.mockReturnValue('ambiguous');

		await expect(recoverPendingKometaConfigMutation()).rejects.toMatchObject({
			code: 'kometa_config_recovery_ambiguous'
		});

		expect(h.complete).not.toHaveBeenCalled();
		expect(h.clearProof).not.toHaveBeenCalled();
		expect(h.finalize).not.toHaveBeenCalled();
	});

	it('never enters mutating recovery when inspection finds conflicting proof artifacts', async () => {
		h.load
			.mockResolvedValueOnce(checkpoint)
			.mockResolvedValueOnce(checkpoint)
			.mockResolvedValueOnce(checkpoint);
		h.inspectProof.mockReturnValue('ambiguous');
		h.recoverProof.mockReturnValue('published');

		await expect(recoverPendingKometaConfigMutation()).rejects.toMatchObject({
			code: 'kometa_config_recovery_ambiguous'
		});

		expect(h.recoverProof).not.toHaveBeenCalled();
		expect(h.discardProof).not.toHaveBeenCalled();
		expect(h.complete).not.toHaveBeenCalled();
		expect(h.clearProof).not.toHaveBeenCalled();
		expect(h.finalize).not.toHaveBeenCalled();
	});

	it.each(['not_published', 'prepared'] as const)(
		'discards a %s frozen attempt when live settings drifted after confirmation',
		async (proofState) => {
			h.load
				.mockResolvedValueOnce(checkpoint)
				.mockResolvedValueOnce(checkpoint)
				.mockResolvedValueOnce(checkpoint);
			h.resolveConfig.mockResolvedValue({
				kometaConfigPath: '/config/config.yml',
				kometaConfigMode: 'own',
				kometaMetadataPathPrefix: 'config',
				kometaServerInstanceId: 'server-a'
			});
			h.inspectProof.mockReturnValue(proofState);

			await expect(recoverPendingKometaConfigMutation()).resolves.toEqual({
				recovered: false,
				resolution: 'superseded',
				action: 'raw'
			});
			expect(h.inspectProof).toHaveBeenCalledWith(
				checkpoint.pathBinding,
				checkpoint.proofToken,
				checkpoint.sourceContent,
				checkpoint.proposedContent
			);
			expect(h.discardProof).toHaveBeenCalledOnce();
			expect(h.discard).toHaveBeenCalledWith(checkpoint, 'lease');
			expect(h.recoverProof).not.toHaveBeenCalled();
			expect(h.write).not.toHaveBeenCalled();
			expect(h.complete).not.toHaveBeenCalled();
		}
	);

	it('finishes a durable cancellation even after the live scope matches again', async () => {
		h.load
			.mockResolvedValueOnce(checkpoint)
			.mockResolvedValueOnce(checkpoint)
			.mockResolvedValueOnce(checkpoint);
		h.inspectProof.mockReturnValue('cancelled');
		h.discardProof.mockReturnValue('discarded');

		await expect(recoverPendingKometaConfigMutation()).resolves.toEqual({
			recovered: false,
			resolution: 'superseded',
			action: 'raw'
		});
		expect(h.recoverProof).not.toHaveBeenCalled();
		expect(h.discard).toHaveBeenCalledWith(checkpoint, 'lease');
		expect(h.clearCancellation).toHaveBeenCalledWith(
			checkpoint.pathBinding,
			checkpoint.proofToken,
			checkpoint.proposedContent
		);
	});

	it('finishes an exact publication proof even when live settings drifted', async () => {
		h.load
			.mockResolvedValueOnce(checkpoint)
			.mockResolvedValueOnce(checkpoint)
			.mockResolvedValueOnce(checkpoint);
		h.resolveConfig.mockResolvedValue({
			kometaConfigPath: '/different/config.yml',
			kometaConfigMode: 'own',
			kometaMetadataPathPrefix: 'different',
			kometaServerInstanceId: 'server-b'
		});
		h.resolveBinding.mockResolvedValue({ status: 'missing', binding: null });
		h.inspectProof.mockReturnValue('published');

		await expect(recoverPendingKometaConfigMutation()).resolves.toEqual({
			recovered: true,
			resolution: 'completed',
			action: 'raw'
		});
		expect(h.discardProof).not.toHaveBeenCalled();
		expect(h.write).not.toHaveBeenCalled();
		expect(h.finalizeProof).toHaveBeenCalledOnce();
		expect(h.recoverProof).not.toHaveBeenCalled();
		expect(h.complete).toHaveBeenCalledWith(checkpoint, 'lease');
	});

	it('never republishes stale bytes when a proven target changes before cleanup', async () => {
		h.load
			.mockResolvedValueOnce(checkpoint)
			.mockResolvedValueOnce(checkpoint)
			.mockResolvedValueOnce(checkpoint);
		h.resolveConfig.mockResolvedValue({
			kometaConfigPath: '/different/config.yml',
			kometaConfigMode: 'own',
			kometaMetadataPathPrefix: 'different',
			kometaServerInstanceId: 'server-b'
		});
		h.resolveBinding.mockResolvedValue({ status: 'missing', binding: null });
		h.inspectProof.mockReturnValue('published');
		h.finalizeProof.mockReturnValue('ambiguous');

		await expect(recoverPendingKometaConfigMutation()).rejects.toMatchObject({
			code: 'kometa_config_recovery_ambiguous'
		});
		expect(h.recoverProof).not.toHaveBeenCalled();
		expect(h.write).not.toHaveBeenCalled();
		expect(h.complete).not.toHaveBeenCalled();
		expect(h.discard).not.toHaveBeenCalled();
	});

	it('cleans up a completed checkpoint without consulting drifted live settings', async () => {
		const completed = { ...checkpoint, status: 'completed' as const };
		h.load
			.mockResolvedValueOnce(completed)
			.mockResolvedValueOnce(completed)
			.mockResolvedValueOnce(completed);

		await expect(recoverPendingKometaConfigMutation()).resolves.toEqual({
			recovered: true,
			resolution: 'completed',
			action: 'raw'
		});
		expect(h.resolveConfig).not.toHaveBeenCalled();
		expect(h.resolveBinding).not.toHaveBeenCalled();
		expect(h.inspectProof).not.toHaveBeenCalled();
		expect(h.recoverProof).not.toHaveBeenCalled();
		expect(h.clearProof).toHaveBeenCalledWith(
			completed.pathBinding,
			completed.proofToken,
			completed.proposedContent
		);
		expect(h.finalize).toHaveBeenCalledWith(completed, 'lease');
	});
});
