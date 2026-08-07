import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import { jobs, mediaItems } from '$lib/server/db/schema';
import type { TmdbMediaType, TmdbMetadata } from '$lib/server/types';
import { pendingTmdbTypeMismatchCondition } from './repair-predicate';

type Database = LibSQLDatabase<typeof schema>;

export interface TmdbRepairJobState {
	id: number;
	status: string;
	phase: string | null;
	processed: number;
	total: number;
	attempt: number;
	maxAttempts: number;
	errorCode: string | null;
	updatedAt: Date;
}

export interface TmdbRepairState {
	pendingCount: number;
	job: TmdbRepairJobState | null;
}

export interface TmdbIdentityGuard {
	tmdbId: string | null;
	mediaType: TmdbMediaType | null;
	manualMatchPinned: boolean;
	resolutionUpdatedAt: Date | null;
}

function currentIdentityCondition(
	serverInstanceId: string,
	itemId: number,
	expected: TmdbIdentityGuard
) {
	return and(
		eq(mediaItems.serverInstanceId, serverInstanceId),
		eq(mediaItems.id, itemId),
		expected.tmdbId === null ? isNull(mediaItems.tmdbId) : eq(mediaItems.tmdbId, expected.tmdbId),
		expected.mediaType === null
			? isNull(mediaItems.mediaType)
			: eq(mediaItems.mediaType, expected.mediaType),
		eq(mediaItems.manualMatchPinned, expected.manualMatchPinned),
		expected.resolutionUpdatedAt === null
			? isNull(mediaItems.resolutionUpdatedAt)
			: eq(mediaItems.resolutionUpdatedAt, expected.resolutionUpdatedAt)
	);
}

export function createTmdbRepairRepository(database: Database) {
	/** IDs are queried at execution time so restored backups and manual edits need no flag repair. */
	async function listPendingItemIds(serverInstanceId: string): Promise<number[]> {
		const rows = await database
			.select({ id: mediaItems.id })
			.from(mediaItems)
			.where(pendingTmdbTypeMismatchCondition(serverInstanceId))
			.orderBy(mediaItems.id);
		return rows.map((row) => row.id);
	}

	async function countPending(serverInstanceId: string): Promise<number> {
		const [row] = await database
			.select({ count: sql<number>`count(*)` })
			.from(mediaItems)
			.where(pendingTmdbTypeMismatchCondition(serverInstanceId));
		return row?.count ?? 0;
	}

	/** Credentials-safe shell projection for the active server only. */
	async function getState(serverInstanceId: string): Promise<TmdbRepairState> {
		const [pendingCount, latestJobs] = await Promise.all([
			countPending(serverInstanceId),
			database
				.select({
					id: jobs.id,
					status: jobs.status,
					phase: jobs.phase,
					processed: jobs.processed,
					total: jobs.total,
					attempt: jobs.attempt,
					maxAttempts: jobs.maxAttempts,
					errorCode: jobs.errorCode,
					updatedAt: jobs.updatedAt
				})
				.from(jobs)
				.where(
					and(
						eq(jobs.serverInstanceId, serverInstanceId),
						or(
							eq(jobs.type, 'tmdb_repair'),
							sql`json_extract(${jobs.payload}, '$.kind') = 'tmdb_repair'`
						)
					)
				)
				.orderBy(desc(jobs.id))
				.limit(1)
		]);
		return { pendingCount, job: latestJobs[0] ?? null };
	}

	/** Compare-and-set enrichment so a manual pin that wins the race stays authoritative. */
	async function writeMetadataIfCurrent(input: {
		serverInstanceId: string;
		itemId: number;
		expected: TmdbIdentityGuard;
		metadata: TmdbMetadata;
		existingLogoUrl: string | null;
		updatedAt: Date;
	}): Promise<boolean> {
		if (input.expected.tmdbId === null || input.expected.mediaType === null) return false;
		const [updated] = await database
			.update(mediaItems)
			.set({
				overview: input.metadata.overview,
				tagline: input.metadata.tagline,
				genres: input.metadata.genres,
				runtime: input.metadata.runtime,
				rating: input.metadata.rating,
				backdropUrl: input.metadata.backdropUrl,
				logoUrl: input.metadata.logoUrl ?? input.existingLogoUrl,
				seasonCount: input.metadata.seasonCount,
				episodeCount: input.metadata.episodeCount,
				cast: input.metadata.cast,
				updatedAt: input.updatedAt
			})
			.where(currentIdentityCondition(input.serverInstanceId, input.itemId, input.expected))
			.returning({ id: mediaItems.id });
		return updated !== undefined;
	}

	/** Advance the watermark only for the exact identity enriched by this execution. */
	async function markSyncedIfCurrent(input: {
		serverInstanceId: string;
		itemId: number;
		expected: TmdbIdentityGuard;
		syncedAt: Date;
	}): Promise<boolean> {
		const [updated] = await database
			.update(mediaItems)
			.set({ lastSyncedAt: input.syncedAt })
			.where(currentIdentityCondition(input.serverInstanceId, input.itemId, input.expected))
			.returning({ id: mediaItems.id });
		return updated !== undefined;
	}

	/** Keep enrichment retryable when identity repair succeeded but metadata did not. */
	async function clearSyncWatermarkIfCurrent(input: {
		serverInstanceId: string;
		itemId: number;
		expected: TmdbIdentityGuard;
	}): Promise<boolean> {
		const [updated] = await database
			.update(mediaItems)
			.set({ lastSyncedAt: null })
			.where(currentIdentityCondition(input.serverInstanceId, input.itemId, input.expected))
			.returning({ id: mediaItems.id });
		return updated !== undefined;
	}

	return {
		listPendingItemIds,
		countPending,
		getState,
		writeMetadataIfCurrent,
		markSyncedIfCurrent,
		clearSyncWatermarkIfCurrent
	};
}
