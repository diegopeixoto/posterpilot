import type { ArtworkSnapshot } from '$lib/server/db/schema';
import type { MediaServer, ServerArtwork } from '$lib/server/media-server';
import type { ApplyServerRegistry } from '$lib/server/plans/apply-server-registry';
import { canonicalJsonDigest } from '$lib/server/plans/canonical-json';
import { sanitizeNativeCollectionArtworkUrl } from '$lib/server/collections/native-artwork-url';
import {
	kometaSlotFingerprint,
	readKometaSlot,
	verifyKometaSlot,
	type KometaSlotSnapshotValue
} from '$lib/server/revisions/kometa-state';
import {
	sha256Bytes,
	verifyServerArtworkRead,
	type ArtworkVerification
} from '$lib/server/revisions/verification';
import type { ArtworkRevisionLedger } from './ledger';
import type { ArtworkSnapshotRepository } from './snapshots';
import {
	assertUndoPlanPayload,
	type UndoPlanOperation,
	type UndoPlanPayloadV1,
	type UndoPlanSlot,
	type UndoPlanTarget
} from './undo-plan';

type UndoLedger = Pick<ArtworkRevisionLedger, 'createGroup' | 'recordOutcome' | 'finalizeGroup'>;
type UndoSnapshots = Pick<
	ArtworkSnapshotRepository,
	'get' | 'readBytes' | 'captureServer' | 'captureValue'
>;

export type ArtworkUndoExecutionStatus = 'success' | 'partial' | 'failed';
export type ArtworkUndoOperationStatus = 'success' | 'failed' | 'skipped';

export type ArtworkUndoOperationErrorCode =
	| 'undo_server_unavailable'
	| 'undo_server_scope_mismatch'
	| 'undo_snapshot_capture_failed'
	| 'undo_snapshot_not_found'
	| 'undo_snapshot_scope_mismatch'
	| 'undo_snapshot_integrity_failed'
	| 'undo_snapshot_unavailable'
	| 'undo_current_state_unavailable'
	| 'undo_stale_destination'
	| 'undo_server_write_unsupported'
	| 'undo_server_delete_unsupported'
	| 'undo_server_write_failed'
	| 'undo_server_verify_unavailable'
	| 'undo_server_verify_mismatch'
	| 'undo_kometa_unavailable'
	| 'undo_kometa_target_invalid'
	| 'undo_kometa_write_failed'
	| 'undo_kometa_verify_failed'
	| 'undo_collection_snapshot_unsupported';

export type ArtworkUndoExecutionErrorCode =
	| 'invalid_undo_execution_input'
	| 'undo_plan_digest_mismatch';

/** Locale-neutral and credentials-safe failure raised before any operation starts. */
export class ArtworkUndoExecutionError extends Error {
	constructor(readonly code: ArtworkUndoExecutionErrorCode) {
		super(code);
		this.name = 'ArtworkUndoExecutionError';
	}
}

export interface UndoKometaMutationInput {
	serverInstanceId: string;
	tmdbId: string;
	slot: UndoPlanSlot;
	restore: KometaSlotSnapshotValue;
	/** Safe compare-and-set identity. The mutator should reject a different live value atomically. */
	expectedCurrent: {
		state: 'present' | 'absent';
		fingerprint: string | null;
	};
}

export interface ArtworkUndoExecutorDependencies {
	serverRegistry: ApplyServerRegistry;
	snapshots: UndoSnapshots;
	ledger: UndoLedger;
	/** null means an absent file/empty document; undefined means it could not be observed. */
	readKometa(serverInstanceId: string): Promise<string | null | undefined>;
	/** Atomically restore/remove exactly one managed scalar and preserve unrelated YAML. */
	mutateKometa(input: UndoKometaMutationInput): Promise<void>;
	clock?: () => Date;
}

export interface ExecuteArtworkUndoInput {
	planId: string;
	digest: string;
	payload: UndoPlanPayloadV1;
	jobId?: number | null;
	initiator?: string;
	/** Reported after each operation so the durable worker can publish progress. */
	onProgress?(completed: number, operation: UndoPlanOperation): void | Promise<void>;
}

export interface ArtworkUndoOperationResult {
	operationId: string;
	revisionId: string;
	serverInstanceId: string;
	target: UndoPlanTarget;
	destination: 'server' | 'kometa';
	slot: UndoPlanSlot;
	status: ArtworkUndoOperationStatus;
	verification: ArtworkVerification;
	errorCode: ArtworkUndoOperationErrorCode | null;
	artworkVersion: number | null;
}

export interface ArtworkUndoGroupResult {
	serverInstanceId: string;
	groupId: string;
	status: ArtworkUndoExecutionStatus;
}

export interface ArtworkUndoExecutionResult {
	planId: string;
	digest: string;
	status: ArtworkUndoExecutionStatus;
	summary: {
		total: number;
		succeeded: number;
		failed: number;
		skipped: number;
	};
	operations: ArtworkUndoOperationResult[];
	groups: ArtworkUndoGroupResult[];
}

interface CurrentServerObservation {
	artwork: ServerArtwork | null | undefined;
	state: 'present' | 'absent' | 'unavailable';
	fingerprint: string | null;
	snapshotId: string | null;
}

interface CurrentKometaObservation {
	raw: string | null | undefined;
	value: KometaSlotSnapshotValue | null;
	state: 'present' | 'absent' | 'unavailable';
	fingerprint: string | null;
	snapshotId: string | null;
}

interface OperationRecord {
	status: ArtworkUndoOperationStatus;
	verification: ArtworkVerification;
	errorCode: ArtworkUndoOperationErrorCode | null;
	beforeSnapshotId: string | null;
	afterSnapshotId: string | null;
	priorFingerprint: string | null;
	proposedFingerprint: string | null;
	applyMethod: string;
	observedArtwork?: ServerArtwork | null | undefined;
	observedFingerprint?: string | null;
	verified?: boolean;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;

const SAFE_ERROR_TEXT: Record<ArtworkUndoOperationErrorCode, string> = {
	undo_server_unavailable: 'The selected media server is unavailable.',
	undo_server_scope_mismatch: 'The media-server binding does not match the undo plan.',
	undo_snapshot_capture_failed: 'The current artwork state could not be captured safely.',
	undo_snapshot_not_found: 'The restoration snapshot is no longer available.',
	undo_snapshot_scope_mismatch: 'The restoration snapshot does not match this destination slot.',
	undo_snapshot_integrity_failed: 'The restoration snapshot failed its integrity check.',
	undo_snapshot_unavailable: 'The prior artwork state was not restorable.',
	undo_current_state_unavailable: 'The current destination state could not be compared safely.',
	undo_stale_destination: 'The destination changed after the undo preview.',
	undo_server_write_unsupported: 'This server cannot restore the selected artwork slot.',
	undo_server_delete_unsupported: 'This server cannot restore an absent artwork slot.',
	undo_server_write_failed: 'The media server did not complete the artwork restoration.',
	undo_server_verify_unavailable: 'The restored server artwork could not be verified.',
	undo_server_verify_mismatch: 'The media server does not expose the planned restored artwork.',
	undo_kometa_unavailable: 'The Kometa metadata destination is unavailable.',
	undo_kometa_target_invalid: 'The Kometa target in the undo plan is invalid.',
	undo_kometa_write_failed: 'The Kometa artwork value could not be restored atomically.',
	undo_kometa_verify_failed: 'The persisted Kometa artwork value does not match the undo plan.',
	undo_collection_snapshot_unsupported:
		'Collection snapshot capture is unavailable for this destination.'
};

function checkedNow(clock: () => Date): Date {
	const now = new Date(clock().getTime());
	if (!Number.isFinite(now.getTime())) {
		throw new ArtworkUndoExecutionError('invalid_undo_execution_input');
	}
	return now;
}

function assertExecutionInput(input: ExecuteArtworkUndoInput): void {
	if (
		!SAFE_IDENTIFIER_PATTERN.test(input.planId) ||
		input.planId.includes('..') ||
		input.planId.includes(':/')
	) {
		throw new ArtworkUndoExecutionError('invalid_undo_execution_input');
	}
	if (!SHA256_PATTERN.test(input.digest)) {
		throw new ArtworkUndoExecutionError('invalid_undo_execution_input');
	}
	if (input.jobId != null && (!Number.isSafeInteger(input.jobId) || input.jobId <= 0)) {
		throw new ArtworkUndoExecutionError('invalid_undo_execution_input');
	}
	if (
		input.initiator !== undefined &&
		(!input.initiator || input.initiator.trim() !== input.initiator)
	) {
		throw new ArtworkUndoExecutionError('invalid_undo_execution_input');
	}
	assertUndoPlanPayload(input.payload);
	if (canonicalJsonDigest(input.payload).digest !== input.digest) {
		throw new ArtworkUndoExecutionError('undo_plan_digest_mismatch');
	}
}

function serverArtworkKind(slot: UndoPlanSlot): 'poster' | 'background' {
	return slot.kind === 'background' ? 'background' : 'poster';
}

function targetFields(target: UndoPlanTarget): {
	mediaItemId: number | null;
	mediaCollectionId: string | null;
} {
	return target.kind === 'item'
		? { mediaItemId: target.mediaItemId, mediaCollectionId: null }
		: { mediaItemId: null, mediaCollectionId: target.mediaCollectionId };
}

function snapshotMatchesOperation(
	snapshot: ArtworkSnapshot,
	operation: UndoPlanOperation
): boolean {
	const target = targetFields(operation.target);
	return (
		snapshot.id === operation.beforeSnapshotId &&
		snapshot.serverInstanceId === operation.serverInstanceId &&
		snapshot.mediaItemId === target.mediaItemId &&
		snapshot.mediaCollectionId === target.mediaCollectionId &&
		snapshot.destination === operation.destination &&
		snapshot.kind === operation.slot.kind &&
		snapshot.season === operation.slot.season &&
		snapshot.episode === operation.slot.episode &&
		snapshot.state === operation.snapshot.state
	);
}

function currentMatchesPlan(
	operation: UndoPlanOperation,
	state: 'present' | 'absent' | 'unavailable',
	fingerprint: string | null
): boolean {
	if (operation.current.state === 'unavailable' || state === 'unavailable') return false;
	if (operation.current.state !== state) return false;
	return state === 'present' ? operation.current.fingerprint === fingerprint : true;
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return Uint8Array.from(bytes).buffer;
}

function kometaSnapshotValue(snapshot: ArtworkSnapshot): KometaSlotSnapshotValue | null {
	if (snapshot.state === 'absent') return { state: 'absent', url: null };
	if (
		snapshot.state !== 'present' ||
		snapshot.value === null ||
		typeof snapshot.value !== 'object'
	) {
		return null;
	}
	const value = snapshot.value as Record<string, unknown>;
	if (value.state === 'present' && typeof value.url === 'string' && value.url.length > 0) {
		return { state: 'present', url: value.url };
	}
	return null;
}

function kometaTmdbId(operation: UndoPlanOperation): string | null {
	const prefix = 'kometa:';
	if (!operation.targetId.startsWith(prefix)) return null;
	const value = operation.targetId.slice(prefix.length);
	return value && !value.includes('/') && !value.includes('..') ? value : null;
}

function statusFromResults(results: ArtworkUndoOperationResult[]): ArtworkUndoExecutionStatus {
	const succeeded = results.filter((result) => result.status === 'success').length;
	return succeeded === results.length ? 'success' : succeeded === 0 ? 'failed' : 'partial';
}

function operationResult(
	operation: UndoPlanOperation,
	record: OperationRecord,
	artworkVersion: number | null
): ArtworkUndoOperationResult {
	return {
		operationId: operation.id,
		revisionId: operation.revisionId,
		serverInstanceId: operation.serverInstanceId,
		target: operation.target,
		destination: operation.destination,
		slot: operation.slot,
		status: record.status,
		verification: record.verification,
		errorCode: record.errorCode,
		artworkVersion
	};
}

/**
 * Execute only a previously frozen `UndoPlanPayloadV1`. Runtime concerns such as
 * consuming the single-use plan and queueing a job deliberately remain outside
 * this `$env`-free module.
 */
export function createArtworkUndoExecutor(dependencies: ArtworkUndoExecutorDependencies) {
	const clock = dependencies.clock ?? (() => new Date());

	return async function executeArtworkUndo(
		input: ExecuteArtworkUndoInput
	): Promise<ArtworkUndoExecutionResult> {
		assertExecutionInput(input);
		const observedAt = checkedNow(clock);
		const groupIds = new Map<string, Promise<string>>();
		const serverBindings = new Map<
			string,
			Promise<Awaited<ReturnType<ApplyServerRegistry['resolve']>>>
		>();
		const results: ArtworkUndoOperationResult[] = [];

		function ensureGroup(serverInstanceId: string): Promise<string> {
			let pending = groupIds.get(serverInstanceId);
			if (!pending) {
				pending = dependencies.ledger
					.createGroup({
						serverInstanceId,
						operationPlanId: input.planId,
						jobId: input.jobId ?? null,
						kind: 'undo',
						initiator: input.initiator ?? (input.jobId ? 'job' : 'user')
					})
					.then((group) => group.id);
				groupIds.set(serverInstanceId, pending);
			}
			return pending;
		}

		function resolveServer(serverInstanceId: string) {
			let pending = serverBindings.get(serverInstanceId);
			if (!pending) {
				pending = dependencies.serverRegistry.resolve(serverInstanceId);
				serverBindings.set(serverInstanceId, pending);
			}
			return pending;
		}

		async function captureServerObservation(
			operation: UndoPlanOperation,
			server: MediaServer | null
		): Promise<CurrentServerObservation> {
			let artwork: ServerArtwork | null | undefined;
			const collectionTarget = operation.target.kind === 'collection';
			if (collectionTarget ? server?.readCollectionArtwork : server?.readArtwork) {
				try {
					artwork = collectionTarget
						? await server!.readCollectionArtwork!(
								operation.targetId,
								serverArtworkKind(operation.slot)
							)
						: await server!.readArtwork!(operation.targetId, serverArtworkKind(operation.slot));
				} catch {
					artwork = undefined;
				}
			}
			const state = artwork === undefined ? 'unavailable' : artwork === null ? 'absent' : 'present';
			const fingerprint = artwork ? sha256Bytes(artwork.data) : null;
			try {
				const snapshot = await dependencies.snapshots.captureServer({
					serverInstanceId: operation.serverInstanceId,
					...(operation.target.kind === 'item'
						? { mediaItemId: operation.target.mediaItemId }
						: { mediaCollectionId: operation.target.mediaCollectionId }),
					destination: 'server',
					slot: operation.slot,
					artwork
				});
				return { artwork, state, fingerprint, snapshotId: snapshot.id };
			} catch {
				return { artwork, state, fingerprint, snapshotId: null };
			}
		}

		async function captureKometaObservation(
			operation: UndoPlanOperation
		): Promise<CurrentKometaObservation> {
			let raw: string | null | undefined;
			let value: KometaSlotSnapshotValue | null = null;
			try {
				raw = await dependencies.readKometa(operation.serverInstanceId);
				const tmdbId = kometaTmdbId(operation);
				if (raw !== undefined && tmdbId) value = readKometaSlot(raw ?? '', tmdbId, operation.slot);
			} catch {
				raw = undefined;
			}
			const state = raw === undefined || value === null ? 'unavailable' : value.state;
			const fingerprint = value?.state === 'present' ? kometaSlotFingerprint(value) : null;
			if (operation.target.kind === 'collection') {
				return { raw, value, state, fingerprint, snapshotId: null };
			}
			try {
				const snapshot = await dependencies.snapshots.captureValue({
					serverInstanceId: operation.serverInstanceId,
					mediaItemId: operation.target.mediaItemId,
					destination: 'kometa',
					slot: operation.slot,
					state,
					value: value?.state === 'present' ? value : undefined,
					metadata: { tmdbId: kometaTmdbId(operation) }
				});
				return { raw, value, state, fingerprint, snapshotId: snapshot.id };
			} catch {
				return { raw, value, state, fingerprint, snapshotId: null };
			}
		}

		async function loadDesiredSnapshot(operation: UndoPlanOperation): Promise<{
			snapshot: ArtworkSnapshot | null;
			errorCode: ArtworkUndoOperationErrorCode | null;
		}> {
			let snapshot: ArtworkSnapshot | null;
			try {
				snapshot = await dependencies.snapshots.get(operation.beforeSnapshotId);
			} catch {
				return { snapshot: null, errorCode: 'undo_snapshot_not_found' };
			}
			if (!snapshot) return { snapshot: null, errorCode: 'undo_snapshot_not_found' };
			if (!snapshotMatchesOperation(snapshot, operation)) {
				return { snapshot, errorCode: 'undo_snapshot_scope_mismatch' };
			}
			if (operation.snapshot.state === 'unavailable') {
				return { snapshot, errorCode: 'undo_snapshot_unavailable' };
			}
			return { snapshot, errorCode: null };
		}

		async function record(
			operation: UndoPlanOperation,
			groupId: string,
			record: OperationRecord
		): Promise<ArtworkUndoOperationResult> {
			const target = targetFields(operation.target);
			const recorded = await dependencies.ledger.recordOutcome({
				groupId,
				serverInstanceId: operation.serverInstanceId,
				mediaItemId: target.mediaItemId,
				mediaCollectionId: target.mediaCollectionId,
				undoOfRevisionId: operation.revisionId,
				beforeSnapshotId: record.beforeSnapshotId,
				afterSnapshotId: record.afterSnapshotId,
				action: 'undo',
				destination: operation.destination,
				kind: operation.slot.kind,
				season: operation.slot.season,
				episode: operation.slot.episode,
				applyMethod: record.applyMethod,
				sourceProvider: 'snapshot',
				provenance: {
					operationId: operation.id,
					revisionGroupId: operation.revisionGroupId,
					snapshotState: operation.snapshot.state
				},
				priorFingerprint: record.priorFingerprint,
				proposedFingerprint: record.proposedFingerprint,
				outcome: record.status,
				verification: record.verification,
				errorCode: record.errorCode,
				error: record.errorCode ? SAFE_ERROR_TEXT[record.errorCode] : null,
				...(operation.destination === 'server' && record.observedArtwork !== undefined
					? {
							slotState: {
								currentUrl:
									operation.target.kind === 'collection'
										? sanitizeNativeCollectionArtworkUrl(record.observedArtwork?.url ?? null)
										: (record.observedArtwork?.url ?? null),
								currentFingerprint: record.observedFingerprint ?? null,
								advanceArtworkVersion: record.verified === true,
								lastObservedAt: observedAt,
								...(record.verified ? { lastVerifiedAt: observedAt, externalChangedAt: null } : {})
							}
						}
					: {})
			});
			return operationResult(
				operation,
				record,
				recorded.currentSlotState?.artworkVersion ?? operation.current.artworkVersion
			);
		}

		async function executeServerOperation(
			operation: UndoPlanOperation,
			groupId: string
		): Promise<ArtworkUndoOperationResult> {
			let server: MediaServer | null = null;
			let bindingError: ArtworkUndoOperationErrorCode | null = null;
			try {
				const binding = await resolveServer(operation.serverInstanceId);
				if (
					binding.serverInstanceId !== operation.serverInstanceId ||
					(binding.server.identity.instanceId !== null &&
						binding.server.identity.instanceId !== operation.serverInstanceId)
				) {
					bindingError = 'undo_server_scope_mismatch';
				} else {
					server = binding.server;
				}
			} catch {
				bindingError = 'undo_server_unavailable';
			}

			const before = await captureServerObservation(operation, server);
			const base = {
				beforeSnapshotId: before.snapshotId,
				afterSnapshotId: before.snapshotId,
				priorFingerprint: before.fingerprint,
				proposedFingerprint: operation.snapshot.fingerprint,
				applyMethod: operation.snapshot.state === 'absent' ? 'server_delete' : 'server_bytes',
				observedArtwork: before.artwork,
				observedFingerprint: before.fingerprint
			};
			if (!before.snapshotId) {
				return record(operation, groupId, {
					...base,
					status: 'failed',
					verification: 'failed',
					errorCode: 'undo_snapshot_capture_failed'
				});
			}
			if (bindingError || !server) {
				return record(operation, groupId, {
					...base,
					status: 'failed',
					verification: 'unavailable',
					errorCode: bindingError ?? 'undo_server_unavailable'
				});
			}
			if (before.state === 'unavailable') {
				return record(operation, groupId, {
					...base,
					status: 'failed',
					verification: 'unavailable',
					errorCode: 'undo_current_state_unavailable'
				});
			}
			if (!currentMatchesPlan(operation, before.state, before.fingerprint)) {
				return record(operation, groupId, {
					...base,
					status: 'failed',
					verification: 'mismatch',
					errorCode: 'undo_stale_destination'
				});
			}

			const desired = await loadDesiredSnapshot(operation);
			if (desired.errorCode || !desired.snapshot) {
				return record(operation, groupId, {
					...base,
					status: desired.errorCode === 'undo_snapshot_unavailable' ? 'skipped' : 'failed',
					verification:
						desired.errorCode === 'undo_snapshot_unavailable' ? 'unavailable' : 'failed',
					errorCode: desired.errorCode ?? 'undo_snapshot_not_found'
				});
			}

			let expectedSha256: string | null = null;
			let restoreBytes: ArrayBuffer | null = null;
			if (desired.snapshot.state === 'present') {
				try {
					const bytes = await dependencies.snapshots.readBytes(desired.snapshot);
					expectedSha256 = sha256Bytes(bytes);
					if (
						expectedSha256 !== operation.snapshot.fingerprint ||
						desired.snapshot.sha256 !== expectedSha256
					) {
						return record(operation, groupId, {
							...base,
							status: 'failed',
							verification: 'failed',
							errorCode: 'undo_snapshot_integrity_failed'
						});
					}
					restoreBytes = arrayBuffer(bytes);
				} catch {
					return record(operation, groupId, {
						...base,
						status: 'failed',
						verification: 'failed',
						errorCode: 'undo_snapshot_integrity_failed'
					});
				}
			}
			let writeFailed = false;
			let unsupportedCode: ArtworkUndoOperationErrorCode | null = null;
			try {
				if (desired.snapshot.state === 'present') {
					const content = restoreBytes!;
					if (operation.target.kind === 'collection') {
						if (serverArtworkKind(operation.slot) === 'background') {
							if (!server.applyCollectionBackgroundBytes) {
								unsupportedCode = 'undo_server_write_unsupported';
							} else {
								await server.applyCollectionBackgroundBytes(
									operation.targetId,
									content,
									desired.snapshot.contentType ?? undefined
								);
							}
						} else if (!server.applyCollectionPosterBytes) {
							unsupportedCode = 'undo_server_write_unsupported';
						} else {
							await server.applyCollectionPosterBytes(
								operation.targetId,
								content,
								desired.snapshot.contentType ?? undefined
							);
						}
					} else if (serverArtworkKind(operation.slot) === 'background') {
						if (!server.applyBackgroundBytes) {
							unsupportedCode = 'undo_server_write_unsupported';
						} else {
							await server.applyBackgroundBytes(
								operation.targetId,
								content,
								desired.snapshot.contentType ?? undefined
							);
						}
					} else {
						await server.applyPosterBytes(
							operation.targetId,
							content,
							desired.snapshot.contentType ?? undefined
						);
					}
				} else if (desired.snapshot.state === 'absent') {
					if (operation.target.kind === 'collection') {
						if (!server.deleteCollectionArtwork) {
							unsupportedCode = 'undo_server_delete_unsupported';
						} else {
							await server.deleteCollectionArtwork(
								operation.targetId,
								serverArtworkKind(operation.slot)
							);
						}
					} else if (!server.deleteArtwork) {
						unsupportedCode = 'undo_server_delete_unsupported';
					} else {
						await server.deleteArtwork(operation.targetId, serverArtworkKind(operation.slot));
					}
				}
			} catch {
				writeFailed = true;
			}

			if (unsupportedCode) {
				return record(operation, groupId, {
					...base,
					status: 'failed',
					verification: 'failed',
					errorCode: unsupportedCode
				});
			}

			const after = await captureServerObservation(operation, server);
			const afterBase = {
				...base,
				afterSnapshotId: after.snapshotId,
				observedArtwork: after.artwork,
				observedFingerprint: after.fingerprint
			};
			if (writeFailed) {
				return record(operation, groupId, {
					...afterBase,
					status: 'failed',
					verification: 'failed',
					errorCode: 'undo_server_write_failed'
				});
			}
			if (!after.snapshotId || after.state === 'unavailable') {
				return record(operation, groupId, {
					...afterBase,
					status: 'failed',
					verification: 'unavailable',
					errorCode: 'undo_server_verify_unavailable'
				});
			}

			if (desired.snapshot.state === 'absent') {
				const exact = after.state === 'absent';
				return record(operation, groupId, {
					...afterBase,
					status: exact ? 'success' : 'failed',
					verification: exact ? 'exact' : 'mismatch',
					errorCode: exact ? null : 'undo_server_verify_mismatch',
					verified: exact
				});
			}

			const verification = verifyServerArtworkRead({
				beforeState: before.state,
				beforeIdentity: before.artwork?.identity ?? null,
				beforeSha256: before.fingerprint,
				expectedSha256,
				after: after.artwork ?? null
			});
			return record(operation, groupId, {
				...afterBase,
				status: verification.ok ? 'success' : 'failed',
				verification: verification.verification,
				errorCode: verification.ok ? null : 'undo_server_verify_mismatch',
				verified: verification.ok
			});
		}

		async function executeKometaOperation(
			operation: UndoPlanOperation,
			groupId: string
		): Promise<ArtworkUndoOperationResult> {
			const before = await captureKometaObservation(operation);
			const base = {
				beforeSnapshotId: before.snapshotId,
				afterSnapshotId: before.snapshotId,
				priorFingerprint: before.fingerprint,
				proposedFingerprint: operation.snapshot.fingerprint,
				applyMethod: 'kometa_yaml'
			};
			if (operation.target.kind === 'collection') {
				return record(operation, groupId, {
					...base,
					status: 'failed',
					verification: 'unavailable',
					errorCode: 'undo_collection_snapshot_unsupported'
				});
			}
			if (!before.snapshotId) {
				return record(operation, groupId, {
					...base,
					status: 'failed',
					verification: 'failed',
					errorCode: 'undo_snapshot_capture_failed'
				});
			}
			const tmdbId = kometaTmdbId(operation);
			if (!tmdbId) {
				return record(operation, groupId, {
					...base,
					status: 'failed',
					verification: 'failed',
					errorCode: 'undo_kometa_target_invalid'
				});
			}
			if (before.state === 'unavailable' || !before.value) {
				return record(operation, groupId, {
					...base,
					status: 'failed',
					verification: 'unavailable',
					errorCode: 'undo_kometa_unavailable'
				});
			}
			if (!currentMatchesPlan(operation, before.state, before.fingerprint)) {
				return record(operation, groupId, {
					...base,
					status: 'failed',
					verification: 'mismatch',
					errorCode: 'undo_stale_destination'
				});
			}

			const desired = await loadDesiredSnapshot(operation);
			if (desired.errorCode || !desired.snapshot) {
				return record(operation, groupId, {
					...base,
					status: desired.errorCode === 'undo_snapshot_unavailable' ? 'skipped' : 'failed',
					verification:
						desired.errorCode === 'undo_snapshot_unavailable' ? 'unavailable' : 'failed',
					errorCode: desired.errorCode ?? 'undo_snapshot_not_found'
				});
			}
			const restore = kometaSnapshotValue(desired.snapshot);
			if (
				!restore ||
				(restore.state === 'present' &&
					kometaSlotFingerprint(restore) !== operation.snapshot.fingerprint)
			) {
				return record(operation, groupId, {
					...base,
					status: 'failed',
					verification: 'failed',
					errorCode: 'undo_snapshot_integrity_failed'
				});
			}

			try {
				await dependencies.mutateKometa({
					serverInstanceId: operation.serverInstanceId,
					tmdbId,
					slot: operation.slot,
					restore,
					expectedCurrent: {
						state: before.value.state,
						fingerprint: before.fingerprint
					}
				});
			} catch {
				return record(operation, groupId, {
					...base,
					status: 'failed',
					verification: 'failed',
					errorCode: 'undo_kometa_write_failed'
				});
			}

			const after = await captureKometaObservation(operation);
			if (!after.snapshotId) {
				return record(operation, groupId, {
					...base,
					afterSnapshotId: null,
					status: 'failed',
					verification: 'failed',
					errorCode: 'undo_snapshot_capture_failed'
				});
			}
			let verified: boolean;
			try {
				verified =
					after.raw !== undefined &&
					verifyKometaSlot(after.raw ?? '', tmdbId, operation.slot, restore);
			} catch {
				verified = false;
			}
			return record(operation, groupId, {
				...base,
				afterSnapshotId: after.snapshotId,
				status: verified ? 'success' : 'failed',
				verification: verified ? 'exact' : after.raw === undefined ? 'unavailable' : 'mismatch',
				errorCode: verified ? null : 'undo_kometa_verify_failed',
				verified
			});
		}

		for (const operation of input.payload.operations) {
			const groupId = await ensureGroup(operation.serverInstanceId);
			const result =
				operation.destination === 'server'
					? await executeServerOperation(operation, groupId)
					: await executeKometaOperation(operation, groupId);
			results.push(result);
			await input.onProgress?.(results.length, operation);
		}

		const groups: ArtworkUndoGroupResult[] = [];
		for (const [serverInstanceId, pendingGroupId] of groupIds) {
			const groupId = await pendingGroupId;
			const serverResults = results.filter(
				(result) => result.serverInstanceId === serverInstanceId
			);
			const finalized = await dependencies.ledger.finalizeGroup({
				groupId,
				serverInstanceId,
				summary: { planId: input.planId, digest: input.digest }
			});
			groups.push({
				serverInstanceId,
				groupId,
				status:
					finalized.outcome === 'success'
						? 'success'
						: finalized.outcome === 'partial'
							? 'partial'
							: statusFromResults(serverResults)
			});
		}

		const summary = {
			total: results.length,
			succeeded: results.filter((result) => result.status === 'success').length,
			failed: results.filter((result) => result.status === 'failed').length,
			skipped: results.filter((result) => result.status === 'skipped').length
		};
		return {
			planId: input.planId,
			digest: input.digest,
			status: statusFromResults(results),
			summary,
			operations: results,
			groups
		};
	};
}

export type ArtworkUndoExecutor = ReturnType<typeof createArtworkUndoExecutor>;
