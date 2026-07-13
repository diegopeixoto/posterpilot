import { join } from 'node:path';
import { readConfig } from '$lib/server/kometa/config-io';
import { DEFAULT_FILENAME } from '$lib/server/kometa/yaml';
import type { MediaServer, ServerArtwork } from '$lib/server/media-server';
import type {
	ApplyOperationExecutionContext,
	ApplyOperationExecutionResult,
	ApplyPlanExecutionResult
} from '$lib/server/plans/apply-executor';
import type { ApplyPlanOperation } from '$lib/server/plans/apply-plan';
import {
	kometaSlotFingerprint,
	readKometaSlot,
	verifyKometaSlot,
	type KometaSlotSnapshotValue
} from '$lib/server/revisions/kometa-state';
import {
	sha256Bytes,
	unavailableArtworkVerification,
	verifyServerArtworkRead,
	type ArtworkVerificationResult
} from '$lib/server/revisions/verification';
import type { ArtworkRevisionLedger } from './ledger';
import type { ArtworkSnapshotRepository } from './snapshots';

interface PreparedServerOperation {
	destination: 'server';
	beforeSnapshotId: string;
	beforeArtwork: ServerArtwork | null | undefined;
	expectedSha256: string | null;
}

interface PreparedKometaOperation {
	destination: 'kometa';
	beforeSnapshotId: string;
	beforeValue: KometaSlotSnapshotValue;
}

type PreparedOperation = PreparedServerOperation | PreparedKometaOperation;

export interface ArtworkApplyCoordinatorOptions {
	snapshots: ArtworkSnapshotRepository;
	ledger: ArtworkRevisionLedger;
	planId: string;
	jobId?: number | null;
	collectionHistory?: {
		collectionId: string;
		targetItemIds: number[];
	};
	kometaAssetsDirectory: string;
	clock?: () => Date;
	fetchArtworkBytes?: (url: string) => Promise<ArrayBuffer | null>;
}

function safeNow(clock: () => Date): Date {
	const now = new Date(clock().getTime());
	if (!Number.isFinite(now.getTime())) throw new TypeError('Artwork coordinator clock is invalid');
	return now;
}

async function defaultFetchArtworkBytes(url: string): Promise<ArrayBuffer | null> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 15_000);
	try {
		const response = await fetch(url, { signal: controller.signal, redirect: 'error' });
		if (!response.ok) return null;
		return response.arrayBuffer();
	} catch {
		return null;
	} finally {
		clearTimeout(timeout);
	}
}

function trustedProviderArtworkUrl(url: string, provider: string | null): boolean {
	if (!provider) return false;
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (parsed.protocol !== 'https:') return false;
	const host = parsed.hostname.toLowerCase();
	switch (provider) {
		case 'mediux':
			return host === 'api.mediux.pro';
		case 'tmdb':
			return host === 'image.tmdb.org';
		case 'theposterdb':
			return host === 'theposterdb.com' || host === 'www.theposterdb.com';
		case 'fanarttv':
			return host === 'fanart.tv' || host.endsWith('.fanart.tv');
		default:
			return false;
	}
}

function serverArtworkKind(operation: ApplyPlanOperation): 'poster' | 'background' {
	return operation.slot.kind === 'background' ? 'background' : 'poster';
}

function snapshotState(value: KometaSlotSnapshotValue): 'present' | 'absent' {
	return value.state;
}

function safeSelectionProvenance(operation: ApplyPlanOperation): Record<string, unknown> {
	return {
		operationId: operation.id,
		selectionSource: operation.selection.selectionSource,
		sourceItem: operation.selection.sourceItem,
		providerAssetId: operation.selection.providerAssetId,
		setId: operation.selection.setId,
		setAuthor: operation.selection.setAuthor,
		designFamily: operation.selection.designFamily,
		language: operation.selection.language,
		discoveryRunId: operation.selection.discoveryRunId,
		resolvedTmdbId: operation.selection.resolvedTmdbId,
		resolvedMediaType: operation.selection.resolvedMediaType,
		score: operation.selection.score,
		width: operation.selection.width,
		height: operation.selection.height
	};
}

function failedVerification(result: ApplyOperationExecutionResult): ArtworkVerificationResult {
	return {
		ok: false,
		verification: 'failed',
		observedFingerprint: null,
		errorCode: 'artwork_write_failed',
		error: result.error ?? 'Artwork write failed.'
	};
}

/**
 * Bridge the frozen executor to immutable snapshots and append-only revisions.
 * A group is created lazily before the first operation for each server, so a
 * cancelled cross-server job never leaves untouched groups pending.
 */
export function createArtworkApplyCoordinator(options: ArtworkApplyCoordinatorOptions) {
	const clock = options.clock ?? (() => new Date());
	const kometaPath = join(options.kometaAssetsDirectory, DEFAULT_FILENAME);
	const prepared = new Map<string, PreparedOperation>();
	const groups = new Map<string, Promise<string>>();

	function ensureGroup(serverInstanceId: string): Promise<string> {
		let pending = groups.get(serverInstanceId);
		if (!pending) {
			pending = options.ledger
				.createGroup({
					serverInstanceId,
					operationPlanId: options.planId,
					jobId: options.jobId ?? null,
					kind: 'apply',
					initiator: options.jobId ? 'job' : 'user'
				})
				.then((group) => group.id);
			groups.set(serverInstanceId, pending);
		}
		return pending;
	}

	async function prepareServer(operation: ApplyPlanOperation, server?: MediaServer): Promise<void> {
		let beforeArtwork: ServerArtwork | null | undefined;
		if (server?.readArtwork) {
			try {
				beforeArtwork = await server.readArtwork(operation.targetId, serverArtworkKind(operation));
			} catch {
				beforeArtwork = undefined;
			}
		}

		const scope = {
			serverInstanceId: operation.target.serverInstanceId,
			mediaItemId: operation.target.mediaItemId,
			destination: 'server' as const,
			slot: operation.slot
		};
		await options.snapshots.captureServer({ ...scope, artwork: beforeArtwork, isOriginal: true });
		const before = await options.snapshots.captureServer({ ...scope, artwork: beforeArtwork });
		prepared.set(operation.id, {
			destination: 'server',
			beforeSnapshotId: before.id,
			beforeArtwork,
			expectedSha256: null
		});
		if (beforeArtwork !== undefined) {
			const liveFingerprint = beforeArtwork ? sha256Bytes(beforeArtwork.data) : null;
			if (liveFingerprint !== operation.current.fingerprint) {
				throw new Error('Frozen destination changed before the artwork write');
			}
		}
		const expectedBytes = options.fetchArtworkBytes
			? await options.fetchArtworkBytes(operation.selection.url)
			: trustedProviderArtworkUrl(operation.selection.url, operation.selection.provider)
				? await defaultFetchArtworkBytes(operation.selection.url)
				: null;
		prepared.set(operation.id, {
			destination: 'server',
			beforeSnapshotId: before.id,
			beforeArtwork,
			expectedSha256: expectedBytes ? sha256Bytes(expectedBytes) : null
		});
	}

	async function prepareKometa(operation: ApplyPlanOperation): Promise<void> {
		const raw = readConfig(kometaPath) ?? '';
		const tmdbId = operation.target.tmdbId;
		if (!tmdbId) throw new TypeError('Kometa operation is missing a TMDB id');
		const beforeValue = readKometaSlot(raw, tmdbId, operation.slot);
		const scope = {
			serverInstanceId: operation.target.serverInstanceId,
			mediaItemId: operation.target.mediaItemId,
			destination: 'kometa' as const,
			slot: operation.slot,
			state: snapshotState(beforeValue),
			value: beforeValue.state === 'present' ? beforeValue : undefined,
			metadata: { tmdbId }
		};
		await options.snapshots.captureValue({ ...scope, isOriginal: true });
		const before = await options.snapshots.captureValue(scope);
		prepared.set(operation.id, {
			destination: 'kometa',
			beforeSnapshotId: before.id,
			beforeValue
		});
	}

	async function prepareOperation(
		operation: ApplyPlanOperation,
		context: ApplyOperationExecutionContext
	): Promise<void> {
		await ensureGroup(operation.target.serverInstanceId);
		if (operation.destination === 'server') await prepareServer(operation, context.server);
		else await prepareKometa(operation);
	}

	async function recordServerOutcome(
		operation: ApplyPlanOperation,
		result: ApplyOperationExecutionResult,
		server: MediaServer | undefined,
		groupId: string
	): Promise<ApplyOperationExecutionResult> {
		const captured = prepared.get(operation.id);
		const before = captured?.destination === 'server' ? captured : null;
		let afterArtwork: ServerArtwork | null | undefined;
		let readError: unknown;
		if (server?.readArtwork) {
			try {
				afterArtwork = await server.readArtwork(operation.targetId, serverArtworkKind(operation));
			} catch (error) {
				readError = error;
				afterArtwork = undefined;
			}
		}
		const after = await options.snapshots.captureServer({
			serverInstanceId: operation.target.serverInstanceId,
			mediaItemId: operation.target.mediaItemId,
			destination: 'server',
			slot: operation.slot,
			artwork: afterArtwork
		});
		const observedFingerprint = afterArtwork ? sha256Bytes(afterArtwork.data) : null;

		let verification: ArtworkVerificationResult;
		if (result.status === 'failed') verification = failedVerification(result);
		else if (afterArtwork === undefined) verification = unavailableArtworkVerification(readError);
		else {
			verification = verifyServerArtworkRead({
				beforeState:
					before?.beforeArtwork === undefined
						? 'unavailable'
						: before.beforeArtwork === null
							? 'absent'
							: 'present',
				beforeIdentity: before?.beforeArtwork?.identity ?? null,
				beforeSha256:
					before?.beforeArtwork && before.beforeArtwork.data.byteLength > 0
						? sha256Bytes(before.beforeArtwork.data)
						: null,
				expectedSha256: before?.expectedSha256 ?? null,
				after: afterArtwork
			});
		}
		const verified = result.status === 'success' && verification.ok;
		const failed = result.status === 'failed' || !verification.ok;
		const observedAt = safeNow(clock);
		const recorded = await options.ledger.recordOutcome({
			groupId,
			serverInstanceId: operation.target.serverInstanceId,
			mediaItemId: operation.target.mediaItemId,
			beforeSnapshotId: before?.beforeSnapshotId ?? null,
			afterSnapshotId: after.id,
			action: 'apply',
			destination: 'server',
			kind: operation.slot.kind,
			season: operation.slot.season,
			episode: operation.slot.episode,
			applyMethod: 'server_url',
			sourceProvider: operation.selection.provider,
			provenance: safeSelectionProvenance(operation),
			priorFingerprint:
				before?.beforeArtwork && before.beforeArtwork.data.byteLength > 0
					? sha256Bytes(before.beforeArtwork.data)
					: operation.current.fingerprint,
			proposedFingerprint: before?.expectedSha256 ?? operation.selection.fingerprint,
			outcome: failed ? 'failed' : 'success',
			verification: verification.verification,
			errorCode: result.errorCode ?? verification.errorCode,
			error: result.error ?? verification.error,
			...(afterArtwork !== undefined
				? {
						slotState: {
							currentUrl: afterArtwork?.url ?? null,
							currentFingerprint: observedFingerprint,
							advanceArtworkVersion: verified,
							lastObservedAt: observedAt,
							...(verified ? { lastVerifiedAt: observedAt, externalChangedAt: null } : {})
						}
					}
				: {})
		});
		return {
			...result,
			status: failed ? 'failed' : 'success',
			verification: verification.verification,
			errorCode: result.errorCode ?? verification.errorCode ?? undefined,
			error: result.error ?? verification.error ?? undefined,
			observedFingerprint,
			...(recorded.currentSlotState
				? { artworkVersion: recorded.currentSlotState.artworkVersion }
				: {})
		};
	}

	async function recordKometaOutcome(
		operation: ApplyPlanOperation,
		result: ApplyOperationExecutionResult,
		groupId: string
	): Promise<ApplyOperationExecutionResult> {
		const captured = prepared.get(operation.id);
		const before = captured?.destination === 'kometa' ? captured : null;
		const tmdbId = operation.target.tmdbId;
		if (!tmdbId) throw new TypeError('Kometa operation is missing a TMDB id');
		let afterValue: KometaSlotSnapshotValue | null = null;
		let verification: 'exact' | 'mismatch' | 'failed';
		let errorCode: string | null = null;
		let error: string | null = result.error ?? null;
		try {
			const raw = readConfig(kometaPath) ?? '';
			afterValue = readKometaSlot(raw, tmdbId, operation.slot);
			const expected: KometaSlotSnapshotValue = {
				state: 'present',
				url: operation.selection.url
			};
			verification =
				result.status === 'success' && verifyKometaSlot(raw, tmdbId, operation.slot, expected)
					? 'exact'
					: result.status === 'failed'
						? 'failed'
						: 'mismatch';
			if (verification === 'mismatch') {
				errorCode = 'kometa_verify_mismatch';
				error = 'Kometa YAML did not retain the planned artwork value.';
			}
		} catch (caught) {
			verification = 'failed';
			errorCode = 'kometa_verify_failed';
			error = caught instanceof Error ? caught.message : String(caught);
		}

		const after = await options.snapshots.captureValue({
			serverInstanceId: operation.target.serverInstanceId,
			mediaItemId: operation.target.mediaItemId,
			destination: 'kometa',
			slot: operation.slot,
			state: afterValue ? snapshotState(afterValue) : 'unavailable',
			value: afterValue?.state === 'present' ? afterValue : undefined,
			metadata: { tmdbId }
		});
		await options.ledger.recordOutcome({
			groupId,
			serverInstanceId: operation.target.serverInstanceId,
			mediaItemId: operation.target.mediaItemId,
			beforeSnapshotId: before?.beforeSnapshotId ?? null,
			afterSnapshotId: after.id,
			action: 'apply',
			destination: 'kometa',
			kind: operation.slot.kind,
			season: operation.slot.season,
			episode: operation.slot.episode,
			applyMethod: 'kometa_yaml',
			sourceProvider: operation.selection.provider,
			provenance: safeSelectionProvenance(operation),
			priorFingerprint: before ? kometaSlotFingerprint(before.beforeValue) : null,
			proposedFingerprint: kometaSlotFingerprint({
				state: 'present',
				url: operation.selection.url
			}),
			outcome: verification === 'exact' ? 'success' : 'failed',
			verification,
			errorCode: result.errorCode ?? errorCode,
			error
		});
		return {
			...result,
			status: verification === 'exact' ? 'success' : 'failed',
			verification,
			errorCode: result.errorCode ?? errorCode ?? undefined,
			error: error ?? undefined,
			observedFingerprint: afterValue ? kometaSlotFingerprint(afterValue) : null
		};
	}

	async function recordOutcome(
		operation: ApplyPlanOperation,
		result: ApplyOperationExecutionResult,
		context: ApplyOperationExecutionContext
	): Promise<ApplyOperationExecutionResult> {
		const groupId = await ensureGroup(operation.target.serverInstanceId);
		return operation.destination === 'server'
			? recordServerOutcome(operation, result, context.server, groupId)
			: recordKometaOutcome(operation, result, groupId);
	}

	function assertKometaFresh(operations: ApplyPlanOperation[], raw: string | null): void {
		for (const operation of operations) {
			const captured = prepared.get(operation.id);
			if (captured?.destination !== 'kometa') {
				throw new Error('Kometa operation was not prepared');
			}
			const tmdbId = operation.target.tmdbId;
			if (!tmdbId) throw new TypeError('Kometa operation is missing a TMDB id');
			const current = readKometaSlot(raw ?? '', tmdbId, operation.slot);
			if (kometaSlotFingerprint(current) !== kometaSlotFingerprint(captured.beforeValue)) {
				throw new Error('Frozen Kometa destination changed before the artwork write');
			}
		}
	}

	async function finalize(result: ApplyPlanExecutionResult): Promise<void> {
		const touched = new Set(result.items.map((item) => item.serverInstanceId));
		for (const serverInstanceId of touched) {
			const group = groups.get(serverInstanceId);
			if (!group) continue;
			await options.ledger.finalizeGroup({
				groupId: await group,
				serverInstanceId,
				summary: {
					planId: options.planId,
					jobId: options.jobId ?? null,
					...(options.collectionHistory ? { collectionHistory: options.collectionHistory } : {})
				}
			});
		}
	}

	return { prepareOperation, recordOutcome, assertKometaFresh, finalize };
}

export type ArtworkApplyCoordinator = ReturnType<typeof createArtworkApplyCoordinator>;
