import { env } from '$env/dynamic/private';
import type { MediaServer, ServerArtwork } from '$lib/server/media-server';
import { db } from '$lib/server/db';
import { resolveDataPaths } from '$lib/server/data-paths';
import { assertMutationsAllowed } from '$lib/server/maintenance';
import { operationPlanStore } from '$lib/server/plans/operation-plan-store';
import { getMediaItem } from '$lib/server/queries';
import {
	sha256Bytes,
	unavailableArtworkVerification,
	verifyServerArtworkRead,
	type ArtworkVerificationResult
} from '$lib/server/revisions/verification';
import { getActiveServerInstance, resolveMediaServerInstance } from '$lib/server/server-instances';
import {
	confirmCustomUploadPlan,
	createCustomUploadPlanPreview,
	type CustomUploadContentType,
	type CustomUploadOperationPlanStore,
	type CustomUploadPlanPreview
} from './custom-upload-plan';
import { createArtworkRevisionLedger, type ArtworkRevisionLedger } from './ledger';
import { ArtworkSnapshotStore, resolveArtworkSnapshotDirectory } from './snapshot-store';
import { createArtworkSnapshotRepository, type ArtworkSnapshotRepository } from './snapshots';

export type CustomUploadRuntimeErrorCode =
	| 'invalid_request'
	| 'server_instance_not_found'
	| 'item_not_found'
	| 'scope_mismatch'
	| 'server_unavailable'
	| 'artwork_read_unavailable';

/** Locale-neutral runtime failure; HTTP adapters expose only this stable code. */
class CustomUploadRuntimeError extends Error {
	constructor(readonly code: CustomUploadRuntimeErrorCode) {
		super(code);
		this.name = 'CustomUploadRuntimeError';
	}
}

export interface CustomUploadRuntimeItem {
	id: number;
	serverInstanceId: string;
	targetId: string;
}

export interface CustomUploadRuntimeDependencies {
	store: CustomUploadOperationPlanStore;
	snapshots: ArtworkSnapshotRepository;
	ledger: ArtworkRevisionLedger;
	getActiveServerInstanceId(): Promise<string | null>;
	getItem(mediaItemId: number, serverInstanceId: string): Promise<CustomUploadRuntimeItem | null>;
	resolveServer(serverInstanceId: string): Promise<MediaServer>;
	clock?: () => Date;
}

export interface PreviewCustomUploadInput {
	mediaItemId: number;
	bytes: ArrayBuffer | Uint8Array;
	contentType: CustomUploadContentType;
	maxSizeBytes: number;
	ttlMs?: number;
}

export interface ConfirmCustomUploadInput extends PreviewCustomUploadInput {
	planId: string;
	digest: string;
	sizeBytes: number;
}

export interface CustomUploadExecutionResult {
	ok: boolean;
	planId: string;
	digest: string;
	groupId: string;
	revisionId: string;
	status: 'success' | 'failed';
	verification: 'exact' | 'best_effort' | 'unavailable' | 'mismatch' | 'failed';
	errorCode: string | null;
	observedFingerprint: string | null;
	artworkVersion: number | null;
}

function checkedNow(clock: () => Date): Date {
	const now = new Date(clock().getTime());
	if (!Number.isFinite(now.getTime())) throw new CustomUploadRuntimeError('invalid_request');
	return now;
}

function assertMediaItemId(value: number): void {
	if (!Number.isInteger(value) || value <= 0) {
		throw new CustomUploadRuntimeError('invalid_request');
	}
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function liveFingerprint(artwork: ServerArtwork | null): string | null {
	return artwork ? sha256Bytes(artwork.data) : null;
}

function failedWriteVerification(): ArtworkVerificationResult {
	return {
		ok: false,
		verification: 'failed',
		observedFingerprint: null,
		errorCode: 'artwork_write_failed',
		error: 'Artwork write failed.'
	};
}

export function createCustomUploadRuntime(dependencies: CustomUploadRuntimeDependencies) {
	const clock = dependencies.clock ?? (() => new Date());

	async function resolveScope(mediaItemId: number): Promise<{
		serverInstanceId: string;
		item: CustomUploadRuntimeItem;
		server: MediaServer;
	}> {
		assertMediaItemId(mediaItemId);
		const serverInstanceId = await dependencies.getActiveServerInstanceId();
		if (!serverInstanceId) throw new CustomUploadRuntimeError('server_instance_not_found');
		const item = await dependencies.getItem(mediaItemId, serverInstanceId);
		if (!item) throw new CustomUploadRuntimeError('item_not_found');
		if (
			item.id !== mediaItemId ||
			item.serverInstanceId !== serverInstanceId ||
			!item.targetId ||
			item.targetId.trim() !== item.targetId
		) {
			throw new CustomUploadRuntimeError('scope_mismatch');
		}
		let server: MediaServer;
		try {
			server = await dependencies.resolveServer(serverInstanceId);
		} catch {
			throw new CustomUploadRuntimeError('server_unavailable');
		}
		if (server.identity?.instanceId !== null && server.identity?.instanceId !== serverInstanceId) {
			throw new CustomUploadRuntimeError('scope_mismatch');
		}
		return { serverInstanceId, item, server };
	}

	async function readCurrentPoster(
		server: MediaServer,
		targetId: string
	): Promise<ServerArtwork | null> {
		if (!server.readArtwork) throw new CustomUploadRuntimeError('artwork_read_unavailable');
		try {
			return await server.readArtwork(targetId, 'poster');
		} catch {
			throw new CustomUploadRuntimeError('artwork_read_unavailable');
		}
	}

	async function preview(input: PreviewCustomUploadInput): Promise<CustomUploadPlanPreview> {
		const scope = await resolveScope(input.mediaItemId);
		const before = await readCurrentPoster(scope.server, scope.item.targetId);
		return createCustomUploadPlanPreview(
			{
				serverInstanceId: scope.serverInstanceId,
				mediaItemId: scope.item.id,
				targetId: scope.item.targetId,
				bytes: input.bytes,
				contentType: input.contentType,
				currentFingerprint: liveFingerprint(before),
				maxSizeBytes: input.maxSizeBytes,
				...(input.ttlMs === undefined ? {} : { ttlMs: input.ttlMs })
			},
			dependencies.store
		);
	}

	async function confirm(input: ConfirmCustomUploadInput): Promise<CustomUploadExecutionResult> {
		const scope = await resolveScope(input.mediaItemId);
		const beforeArtwork = await readCurrentPoster(scope.server, scope.item.targetId);
		const confirmed = await confirmCustomUploadPlan(
			{
				planId: input.planId,
				digest: input.digest,
				serverInstanceId: scope.serverInstanceId,
				mediaItemId: scope.item.id,
				targetId: scope.item.targetId,
				bytes: input.bytes,
				contentType: input.contentType,
				sizeBytes: input.sizeBytes,
				currentFingerprint: liveFingerprint(beforeArtwork),
				maxSizeBytes: input.maxSizeBytes
			},
			dependencies.store
		);

		const snapshotScope = {
			serverInstanceId: scope.serverInstanceId,
			mediaItemId: scope.item.id,
			destination: 'server' as const,
			slot: { kind: 'poster' as const, season: null, episode: null }
		};
		await dependencies.snapshots.captureServer({
			...snapshotScope,
			artwork: beforeArtwork,
			isOriginal: true
		});
		const before = await dependencies.snapshots.captureServer({
			...snapshotScope,
			artwork: beforeArtwork
		});
		const group = await dependencies.ledger.createGroup({
			serverInstanceId: scope.serverInstanceId,
			operationPlanId: confirmed.planId,
			jobId: null,
			kind: 'apply',
			initiator: 'user'
		});

		let writeFailed = false;
		try {
			await scope.server.applyPosterBytes(
				scope.item.targetId,
				asArrayBuffer(confirmed.bytes),
				confirmed.payload.image.contentType
			);
		} catch {
			writeFailed = true;
		}

		let afterArtwork: ServerArtwork | null | undefined;
		let afterReadError: unknown;
		try {
			afterArtwork = await scope.server.readArtwork?.(scope.item.targetId, 'poster');
		} catch (caught) {
			afterReadError = caught;
			afterArtwork = undefined;
		}
		const after = await dependencies.snapshots.captureServer({
			...snapshotScope,
			artwork: afterArtwork
		});

		const verification = writeFailed
			? failedWriteVerification()
			: afterArtwork === undefined
				? unavailableArtworkVerification(afterReadError)
				: verifyServerArtworkRead({
						beforeState: beforeArtwork === null ? 'absent' : 'present',
						beforeIdentity: beforeArtwork?.identity ?? null,
						beforeSha256: liveFingerprint(beforeArtwork),
						expectedSha256: confirmed.payload.image.sha256,
						after: afterArtwork
					});
		const verified = !writeFailed && verification.ok;
		const observedAt = checkedNow(clock);
		const recorded = await dependencies.ledger.recordOutcome({
			groupId: group.id,
			serverInstanceId: scope.serverInstanceId,
			mediaItemId: scope.item.id,
			beforeSnapshotId: before.id,
			afterSnapshotId: after.id,
			action: 'apply',
			destination: 'server',
			kind: 'poster',
			season: null,
			episode: null,
			applyMethod: 'server_bytes',
			sourceProvider: 'custom_upload',
			provenance: {
				planId: confirmed.planId,
				sha256: confirmed.payload.image.sha256,
				contentType: confirmed.payload.image.contentType,
				sizeBytes: confirmed.payload.image.sizeBytes
			},
			priorFingerprint: liveFingerprint(beforeArtwork),
			proposedFingerprint: confirmed.payload.image.sha256,
			outcome: verified ? 'success' : 'failed',
			verification: verification.verification,
			errorCode: verification.errorCode,
			error: verification.error,
			...(afterArtwork !== undefined
				? {
						slotState: {
							currentUrl: afterArtwork?.url ?? null,
							currentFingerprint: verification.observedFingerprint,
							advanceArtworkVersion: verified,
							lastObservedAt: observedAt,
							...(verified ? { lastVerifiedAt: observedAt, externalChangedAt: null } : {})
						}
					}
				: {})
		});
		await dependencies.ledger.finalizeGroup({
			groupId: group.id,
			serverInstanceId: scope.serverInstanceId,
			summary: {
				planId: confirmed.planId,
				customUpload: true
			}
		});

		return {
			ok: verified,
			planId: confirmed.planId,
			digest: confirmed.digest,
			groupId: group.id,
			revisionId: recorded.revision.id,
			status: verified ? 'success' : 'failed',
			verification: verification.verification,
			errorCode: verification.errorCode,
			observedFingerprint: verification.observedFingerprint,
			artworkVersion: recorded.currentSlotState?.artworkVersion ?? null
		};
	}

	return { preview, confirm };
}

let liveRuntime: ReturnType<typeof createCustomUploadRuntime> | null = null;

function runtime() {
	if (liveRuntime) return liveRuntime;
	const snapshotStore = new ArtworkSnapshotStore(
		resolveArtworkSnapshotDirectory(resolveDataPaths(env.DATABASE_URL, env.APP_KEY_FILE))
	);
	liveRuntime = createCustomUploadRuntime({
		store: operationPlanStore,
		snapshots: createArtworkSnapshotRepository(db, snapshotStore),
		ledger: createArtworkRevisionLedger(db),
		getActiveServerInstanceId: async () => (await getActiveServerInstance())?.id ?? null,
		getItem: async (mediaItemId, serverInstanceId) => {
			const item = await getMediaItem(mediaItemId, serverInstanceId);
			return item
				? {
						id: item.id,
						serverInstanceId: item.serverInstanceId,
						targetId: item.ratingKey
					}
				: null;
		},
		resolveServer: async (serverInstanceId) =>
			(await resolveMediaServerInstance(serverInstanceId, { requireEnabled: true })).server
	});
	return liveRuntime;
}

export async function previewActiveCustomUpload(
	input: PreviewCustomUploadInput
): Promise<CustomUploadPlanPreview> {
	assertMutationsAllowed();
	return runtime().preview(input);
}

export async function confirmActiveCustomUpload(
	input: ConfirmCustomUploadInput
): Promise<CustomUploadExecutionResult> {
	assertMutationsAllowed();
	return runtime().confirm(input);
}
