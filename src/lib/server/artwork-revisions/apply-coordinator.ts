import { join } from 'node:path';
import { readConfig } from '$lib/server/kometa/config-io';
import {
	isKometaDestinationV2,
	kometaYamlMappingKey,
	type KometaDestinationV2
} from '$lib/server/kometa/destination';
import type { MediaServer, ServerArtwork } from '$lib/server/media-server';
import {
	downloadRemoteArtwork,
	RemoteArtworkDownloadError,
	safeArtworkRedirectPolicy,
	type DownloadedRemoteArtwork,
	type RemoteArtworkFetch,
	type RemoteArtworkUrlValidator
} from '$lib/server/remote-artwork';
import type {
	ApplyOperationExecutionContext,
	ApplyOperationExecutionResult,
	ApplyPlanExecutionResult
} from '$lib/server/plans/apply-executor';
import type { ApplyPlanOperation } from '$lib/server/plans/apply-plan';
import { hashCanonicalJson } from '$lib/server/plans/canonical-json';
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
	expectedBytes: ArrayBuffer;
	expectedContentType: string;
	expectedSha256: string;
}

interface PreparedKometaOperation {
	destination: 'kometa';
	beforeSnapshotId: string;
	beforeValue: KometaSlotSnapshotValue;
	kometaDestination: KometaDestinationV2;
	fileFingerprint: string;
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
	/**
	 * Test/integration seam; null or empty results fail the mandatory preflight.
	 * ArrayBuffer remains accepted for backwards compatibility and is treated as JPEG.
	 */
	fetchArtworkBytes?: (
		url: string
	) => Promise<ArrayBuffer | Pick<DownloadedRemoteArtwork, 'bytes' | 'contentType'> | null>;
}

function safeNow(clock: () => Date): Date {
	const now = new Date(clock().getTime());
	if (!Number.isFinite(now.getTime())) throw new TypeError('Artwork coordinator clock is invalid');
	return now;
}

const MAX_PREFLIGHT_ARTWORK_BYTES = 50 * 1024 * 1024;

/**
 * Validate and download the exact frozen selection before any media-server mutation.
 * Known provider provenance stays on its strict asset-host allowlist. Custom and
 * providerless legacy selections keep their original URL semantics and use the
 * redirect policy shared by the media-server adapters.
 */
export async function preflightServerArtwork(
	url: string,
	provider: string | null,
	fetchImpl?: RemoteArtworkFetch
): Promise<Pick<DownloadedRemoteArtwork, 'bytes' | 'contentType'>> {
	const validateUrl: RemoteArtworkUrlValidator =
		provider === null || provider === 'custom'
			? safeArtworkRedirectPolicy
			: (target) => trustedProviderArtworkUrl(target, provider);
	const downloaded = await downloadRemoteArtwork(url, {
		maxBytes: MAX_PREFLIGHT_ARTWORK_BYTES,
		timeoutMs: 30_000,
		maxRedirects: 3,
		validateUrl,
		...(fetchImpl ? { fetchImpl } : {})
	});
	return { bytes: downloaded.bytes, contentType: downloaded.contentType };
}

/** Exported for direct unit testing of the per-provider artwork host allowlist. */
export function trustedProviderArtworkUrl(url: string | URL, provider: string | null): boolean {
	if (!provider) return false;
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port)
		return false;
	const host = parsed.hostname.toLowerCase();
	switch (provider) {
		case 'mediux':
			return host === 'api.mediux.pro';
		case 'tmdb':
			return host === 'image.tmdb.org';
		case 'theposterdb':
			// Candidates parsed from a set page live on the asset CDN
			// (images.theposterdb.com); the apex hosts stay trusted for the legacy
			// /api/assets fallback candidates.
			return (
				host === 'images.theposterdb.com' ||
				host === 'theposterdb.com' ||
				host === 'www.theposterdb.com'
			);
		case 'fanarttv':
			return host === 'fanart.tv' || host.endsWith('.fanart.tv');
		default:
			return false;
	}
}

function serverArtworkKind(operation: ApplyPlanOperation): 'poster' | 'background' {
	return operation.slot.kind === 'background' ? 'background' : 'poster';
}

function preparedArtwork(
	result: ArrayBuffer | Pick<DownloadedRemoteArtwork, 'bytes' | 'contentType'> | null
): Pick<DownloadedRemoteArtwork, 'bytes' | 'contentType'> {
	if (!result) throw new RemoteArtworkDownloadError('remote_artwork_empty');
	const downloaded =
		result instanceof ArrayBuffer ? { bytes: result, contentType: 'image/jpeg' } : result;
	if (downloaded.bytes.byteLength === 0) {
		throw new RemoteArtworkDownloadError('remote_artwork_empty');
	}
	return downloaded;
}

function artworkFingerprint(artwork: ServerArtwork | null | undefined): string | null | undefined {
	return artwork === undefined ? undefined : artwork === null ? null : sha256Bytes(artwork.data);
}

function assertArtworkMatches(
	actual: ServerArtwork | null | undefined,
	expectedFingerprint: string | null | undefined
): void {
	if (actual === undefined || expectedFingerprint === undefined) {
		throw new Error('Current server artwork could not be verified before the artwork write');
	}
	if (artworkFingerprint(actual) !== expectedFingerprint) {
		throw new Error('Frozen destination changed before the artwork write');
	}
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
		height: operation.selection.height,
		...(operation.destination === 'kometa' && operation.kometaDestination
			? { kometaDestination: operation.kometaDestination }
			: {})
	};
}

function typedKometaDestination(operation: ApplyPlanOperation): KometaDestinationV2 {
	if (
		operation.destination !== 'kometa' ||
		!isKometaDestinationV2(operation.kometaDestination) ||
		operation.targetId !== operation.kometaDestination.key
	) {
		throw new TypeError('Kometa operation is missing a valid typed destination');
	}
	return operation.kometaDestination;
}

function kometaFileFingerprint(raw: string | null): string {
	return hashCanonicalJson({ exists: raw !== null, content: raw });
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
		const expected = preparedArtwork(
			options.fetchArtworkBytes
				? await options.fetchArtworkBytes(operation.selection.url)
				: await preflightServerArtwork(operation.selection.url, operation.selection.provider)
		);
		let beforeArtwork: ServerArtwork | null | undefined;
		if (server?.readArtwork) {
			try {
				beforeArtwork = await server.readArtwork(operation.targetId, serverArtworkKind(operation));
			} catch {
				beforeArtwork = undefined;
			}
		}
		if (beforeArtwork !== undefined) {
			assertArtworkMatches(beforeArtwork, operation.current.fingerprint);
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
			expectedBytes: expected.bytes,
			expectedContentType: expected.contentType,
			expectedSha256: sha256Bytes(expected.bytes)
		});
	}

	async function executeServerOperation(
		operation: ApplyPlanOperation,
		context: ApplyOperationExecutionContext
	): Promise<void> {
		const captured = prepared.get(operation.id);
		if (captured?.destination !== 'server') {
			throw new Error('Server operation was not prepared');
		}
		const server = context.server;
		if (!server?.readArtwork) {
			throw new Error('Current server artwork cannot be rechecked before the artwork write');
		}
		let liveArtwork: ServerArtwork | null | undefined;
		try {
			liveArtwork = await server.readArtwork(operation.targetId, serverArtworkKind(operation));
		} catch {
			liveArtwork = undefined;
		}
		assertArtworkMatches(liveArtwork, artworkFingerprint(captured.beforeArtwork));
		if (context.isCancelled?.()) throw new Error('cancelled');

		if (operation.slot.kind === 'background') {
			if (!server.applyBackgroundBytes) {
				throw new Error('Target server does not support background artwork bytes');
			}
			await server.applyBackgroundBytes(
				operation.targetId,
				captured.expectedBytes,
				captured.expectedContentType
			);
			return;
		}
		await server.applyPosterBytes(
			operation.targetId,
			captured.expectedBytes,
			captured.expectedContentType
		);
	}

	async function prepareKometa(operation: ApplyPlanOperation): Promise<void> {
		const kometaDestination = typedKometaDestination(operation);
		const kometaPath = join(options.kometaAssetsDirectory, kometaDestination.filename);
		const rawDocument = readConfig(kometaPath);
		const raw = rawDocument ?? '';
		const fileFingerprint = kometaFileFingerprint(rawDocument);
		if (operation.kometaFileFingerprint !== fileFingerprint) {
			throw new Error('Frozen Kometa metadata file changed before preparation');
		}
		const beforeValue = readKometaSlot(
			raw,
			kometaYamlMappingKey(kometaDestination),
			operation.slot
		);
		const scope = {
			serverInstanceId: operation.target.serverInstanceId,
			mediaItemId: operation.target.mediaItemId,
			destination: 'kometa' as const,
			slot: operation.slot,
			state: snapshotState(beforeValue),
			value: beforeValue.state === 'present' ? beforeValue : undefined,
			metadata: { kometaDestination }
		};
		await options.snapshots.captureValue({ ...scope, isOriginal: true });
		const before = await options.snapshots.captureValue(scope);
		prepared.set(operation.id, {
			destination: 'kometa',
			beforeSnapshotId: before.id,
			beforeValue,
			kometaDestination,
			fileFingerprint
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
			applyMethod: 'server_bytes',
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
		const kometaDestination = typedKometaDestination(operation);
		const kometaPath = join(options.kometaAssetsDirectory, kometaDestination.filename);
		let afterValue: KometaSlotSnapshotValue | null = null;
		let verification: 'exact' | 'mismatch' | 'failed';
		let errorCode: string | null = null;
		let error: string | null = result.error ?? null;
		try {
			const raw = readConfig(kometaPath) ?? '';
			afterValue = readKometaSlot(raw, kometaYamlMappingKey(kometaDestination), operation.slot);
			const expected: KometaSlotSnapshotValue = {
				state: 'present',
				url: operation.selection.url
			};
			verification =
				result.status === 'success' &&
				verifyKometaSlot(raw, kometaYamlMappingKey(kometaDestination), operation.slot, expected)
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
			metadata: { kometaDestination }
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
		try {
			const groupId = await ensureGroup(operation.target.serverInstanceId);
			return operation.destination === 'server'
				? await recordServerOutcome(operation, result, context.server, groupId)
				: await recordKometaOutcome(operation, result, groupId);
		} finally {
			prepared.delete(operation.id);
		}
	}

	function assertKometaFresh(operations: ApplyPlanOperation[], raw: string | null): void {
		for (const operation of operations) {
			const captured = prepared.get(operation.id);
			if (captured?.destination !== 'kometa') {
				throw new Error('Kometa operation was not prepared');
			}
			const kometaDestination = typedKometaDestination(operation);
			if (captured.kometaDestination.key !== kometaDestination.key) {
				throw new Error('Frozen Kometa destination identity changed before the artwork write');
			}
			if (kometaFileFingerprint(raw) !== captured.fileFingerprint) {
				throw new Error('Frozen Kometa metadata file changed before the artwork write');
			}
			const current = readKometaSlot(
				raw ?? '',
				kometaYamlMappingKey(kometaDestination),
				operation.slot
			);
			if (kometaSlotFingerprint(current) !== kometaSlotFingerprint(captured.beforeValue)) {
				throw new Error('Frozen Kometa destination changed before the artwork write');
			}
		}
	}

	function assertKometaGuardFresh(
		operations: ApplyPlanOperation[],
		guard: { migrationRequired: boolean; fingerprint: string }
	): void {
		if (guard.migrationRequired) {
			throw new Error('Kometa legacy layout requires migration before export');
		}
		for (const operation of operations) {
			const captured = prepared.get(operation.id);
			if (captured?.destination !== 'kometa') {
				throw new Error('Kometa operation was not prepared');
			}
			const destination = typedKometaDestination(operation);
			const typedDestinationFingerprint = hashCanonicalJson({
				filePath: join(options.kometaAssetsDirectory, destination.filename),
				destination,
				fileFingerprint: captured.fileFingerprint
			});
			const currentDestinationFingerprint = hashCanonicalJson({
				typedDestinationFingerprint,
				collisionGuardFingerprint: guard.fingerprint
			});
			if (operation.current.destinationFingerprint !== currentDestinationFingerprint) {
				throw new Error('Frozen Kometa collision guard changed before the artwork write');
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

	return {
		prepareOperation,
		executeServerOperation,
		recordOutcome,
		assertKometaFresh,
		assertKometaGuardFresh,
		finalize
	};
}

export type ArtworkApplyCoordinator = ReturnType<typeof createArtworkApplyCoordinator>;
