import { randomUUID } from 'node:crypto';
import { and, eq, isNull, or } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import { artworkRevisions, artworkSnapshots, type ArtworkSnapshot } from '$lib/server/db/schema';
import type { ServerArtwork } from '$lib/server/media-server';
import type { ApplyPlanDestination, ApplySlot } from '$lib/server/plans/apply-plan';
import { ArtworkSnapshotStore } from './snapshot-store';

type Database = LibSQLDatabase<typeof schema>;

interface ArtworkSnapshotScopeBase {
	serverInstanceId: string;
	destination: ApplyPlanDestination;
	slot: ApplySlot;
}

export type ArtworkSnapshotScope = ArtworkSnapshotScopeBase &
	(
		| { mediaItemId: number; mediaCollectionId?: null }
		| { mediaItemId?: null; mediaCollectionId: string }
	);

export type CaptureServerArtworkSnapshotInput = ArtworkSnapshotScope & {
	/** undefined = provider cannot read; null = the slot is genuinely absent. */
	artwork: ServerArtwork | null | undefined;
	isOriginal?: boolean;
	retainedUntil?: Date | null;
};

export type CaptureValueSnapshotInput = ArtworkSnapshotScope & {
	state: 'present' | 'absent' | 'unavailable';
	value?: unknown;
	metadata?: Record<string, unknown> | null;
	isOriginal?: boolean;
	retainedUntil?: Date | null;
};

export interface ArtworkSnapshotRepositoryOptions {
	clock?: () => Date;
	generateId?: () => string;
}

function assertScope(scope: ArtworkSnapshotScope): void {
	if (!scope.serverInstanceId || scope.serverInstanceId.trim() !== scope.serverInstanceId) {
		throw new TypeError('Snapshot server instance id is required');
	}
	const hasItem = scope.mediaItemId !== null && scope.mediaItemId !== undefined;
	const hasCollection = scope.mediaCollectionId !== null && scope.mediaCollectionId !== undefined;
	if (hasItem === hasCollection) {
		throw new TypeError('Exactly one snapshot media item or media collection is required');
	}
	if (hasItem && (!Number.isInteger(scope.mediaItemId) || Number(scope.mediaItemId) <= 0)) {
		throw new TypeError('Snapshot media item id must be positive');
	}
	if (
		hasCollection &&
		(!scope.mediaCollectionId || scope.mediaCollectionId.trim() !== scope.mediaCollectionId)
	) {
		throw new TypeError('Snapshot media collection id is required');
	}
	if (
		scope.slot.season !== null &&
		(!Number.isInteger(scope.slot.season) || scope.slot.season < 0)
	) {
		throw new TypeError('Snapshot season must be null or non-negative');
	}
	if (
		scope.slot.episode !== null &&
		(!Number.isInteger(scope.slot.episode) || scope.slot.episode < 0)
	) {
		throw new TypeError('Snapshot episode must be null or non-negative');
	}
	if (hasCollection && (scope.slot.season !== null || scope.slot.episode !== null)) {
		throw new TypeError('Collection snapshots cannot use season or episode scope');
	}
}

function originalPredicate(scope: ArtworkSnapshotScope) {
	const target =
		scope.mediaItemId != null
			? and(
					eq(artworkSnapshots.mediaItemId, scope.mediaItemId),
					isNull(artworkSnapshots.mediaCollectionId)
				)
			: and(
					isNull(artworkSnapshots.mediaItemId),
					eq(artworkSnapshots.mediaCollectionId, scope.mediaCollectionId)
				);
	return and(
		eq(artworkSnapshots.serverInstanceId, scope.serverInstanceId),
		target,
		eq(artworkSnapshots.destination, scope.destination),
		eq(artworkSnapshots.kind, scope.slot.kind),
		scope.slot.season === null
			? isNull(artworkSnapshots.season)
			: eq(artworkSnapshots.season, scope.slot.season),
		scope.slot.episode === null
			? isNull(artworkSnapshots.episode)
			: eq(artworkSnapshots.episode, scope.slot.episode),
		eq(artworkSnapshots.isOriginal, true)
	);
}

export function createArtworkSnapshotRepository(
	database: Database,
	store: ArtworkSnapshotStore,
	options: ArtworkSnapshotRepositoryOptions = {}
) {
	const clock = options.clock ?? (() => new Date());
	const generateId = options.generateId ?? randomUUID;

	async function findOriginal(scope: ArtworkSnapshotScope): Promise<ArtworkSnapshot | null> {
		assertScope(scope);
		return (
			(
				await database.select().from(artworkSnapshots).where(originalPredicate(scope)).limit(1)
			)[0] ?? null
		);
	}

	async function captureValue(input: CaptureValueSnapshotInput): Promise<ArtworkSnapshot> {
		assertScope(input);
		if (input.isOriginal) {
			const existing = await findOriginal(input);
			if (existing) return existing;
		}
		if (input.retainedUntil && !Number.isFinite(input.retainedUntil.getTime())) {
			throw new TypeError('Snapshot retention must be a valid date');
		}
		if (input.state === 'present' && input.value === undefined) {
			throw new TypeError('A present value snapshot requires a value');
		}
		const id = generateId();
		const createdAt = clock();
		if (!id || !Number.isFinite(createdAt.getTime())) {
			throw new TypeError('Snapshot identity or clock is invalid');
		}
		try {
			const [row] = await database
				.insert(artworkSnapshots)
				.values({
					id,
					serverInstanceId: input.serverInstanceId,
					mediaItemId: input.mediaItemId ?? null,
					mediaCollectionId: input.mediaCollectionId ?? null,
					destination: input.destination,
					kind: input.slot.kind,
					season: input.slot.season,
					episode: input.slot.episode,
					state: input.state,
					value: input.state === 'present' ? input.value : null,
					metadata: input.metadata ?? null,
					isOriginal: input.isOriginal ?? false,
					retainedUntil: input.retainedUntil ?? null,
					createdAt
				})
				.returning();
			return row;
		} catch (error) {
			if (input.isOriginal) {
				const winner = await findOriginal(input);
				if (winner) return winner;
			}
			throw error;
		}
	}

	async function captureServer(input: CaptureServerArtworkSnapshotInput): Promise<ArtworkSnapshot> {
		assertScope(input);
		if (input.destination !== 'server') {
			throw new TypeError('Server artwork snapshot requires the server destination');
		}
		if (input.isOriginal) {
			const existing = await findOriginal(input);
			if (existing) return existing;
		}
		if (input.artwork === undefined) {
			return captureValue({ ...input, state: 'unavailable', value: null });
		}
		if (input.artwork === null) {
			return captureValue({ ...input, state: 'absent', value: null });
		}

		const id = generateId();
		const createdAt = clock();
		if (!id || !Number.isFinite(createdAt.getTime())) {
			throw new TypeError('Snapshot identity or clock is invalid');
		}
		const stored = await store.store({
			referenceId: id,
			bytes: new Uint8Array(input.artwork.data)
		});
		try {
			const [row] = await database
				.insert(artworkSnapshots)
				.values({
					id,
					serverInstanceId: input.serverInstanceId,
					mediaItemId: input.mediaItemId ?? null,
					mediaCollectionId: input.mediaCollectionId ?? null,
					destination: 'server',
					kind: input.slot.kind,
					season: input.slot.season,
					episode: input.slot.episode,
					state: 'present',
					sha256: stored.sha256,
					storagePath: stored.storagePath,
					contentType: input.artwork.contentType,
					sizeBytes: stored.sizeBytes,
					value: null,
					metadata: {
						providerIdentity: input.artwork.identity,
						kind: input.artwork.kind
					},
					isOriginal: input.isOriginal ?? false,
					retainedUntil: input.retainedUntil ?? null,
					createdAt
				})
				.returning();
			return row;
		} catch (error) {
			await store.release(id, stored.sha256).catch(() => undefined);
			if (input.isOriginal) {
				const winner = await findOriginal(input);
				if (winner) return winner;
			}
			throw error;
		}
	}

	async function get(id: string): Promise<ArtworkSnapshot | null> {
		return (
			(
				await database.select().from(artworkSnapshots).where(eq(artworkSnapshots.id, id)).limit(1)
			)[0] ?? null
		);
	}

	async function readBytes(snapshot: ArtworkSnapshot): Promise<Buffer> {
		if (snapshot.state !== 'present' || !snapshot.sha256) {
			throw new TypeError('Snapshot does not contain restorable image bytes');
		}
		return store.read(snapshot.id, snapshot.sha256);
	}

	/** Delete only a non-original, expired row that no revision still references. */
	async function deleteIfUnreferenced(id: string, now = clock()): Promise<boolean> {
		const snapshot = await get(id);
		if (!snapshot || snapshot.isOriginal) return false;
		if (snapshot.retainedUntil && snapshot.retainedUntil.getTime() > now.getTime()) return false;
		const linked = (
			await database
				.select({ id: artworkRevisions.id })
				.from(artworkRevisions)
				.where(
					or(
						eq(artworkRevisions.beforeSnapshotId, snapshot.id),
						eq(artworkRevisions.afterSnapshotId, snapshot.id)
					)
				)
				.limit(1)
		)[0];
		if (linked) return false;
		await database.delete(artworkSnapshots).where(eq(artworkSnapshots.id, snapshot.id));
		if (snapshot.sha256) await store.release(snapshot.id, snapshot.sha256);
		return true;
	}

	return { findOriginal, captureValue, captureServer, get, readBytes, deleteIfUnreferenced };
}

export type ArtworkSnapshotRepository = ReturnType<typeof createArtworkSnapshotRepository>;
