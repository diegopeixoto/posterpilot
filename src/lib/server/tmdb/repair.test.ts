import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { and, eq, inArray } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema';
import { jobs, mediaItems, serverInstances } from '$lib/server/db/schema';
import { createManualMatchRepository } from './manual-match-store';
import { createTmdbRepairRepository } from './repair-store';

let client: Client;
let database: LibSQLDatabase<typeof schema>;
let databasePath: string;

beforeEach(async () => {
	databasePath = `/tmp/posterpilot-tmdb-repair-${randomUUID()}.db`;
	client = createClient({ url: `file:${databasePath}` });
	database = drizzle(client, { schema });
	await migrate(database, { migrationsFolder: './drizzle' });
	await database.insert(serverInstances).values([
		{ id: 'server-a', name: 'A', normalizedName: 'a', type: 'plex' },
		{ id: 'server-b', name: 'B', normalizedName: 'b', type: 'jellyfin' }
	]);
	await database.insert(mediaItems).values([
		{
			serverInstanceId: 'server-a',
			ratingKey: 'a-show',
			sectionKey: 'shows',
			type: 'show',
			title: 'A show',
			mediaType: 'movie'
		},
		{
			serverInstanceId: 'server-a',
			ratingKey: 'a-movie',
			sectionKey: 'movies',
			type: 'movie',
			title: 'A movie',
			mediaType: 'tv'
		},
		{
			serverInstanceId: 'server-a',
			ratingKey: 'a-pinned',
			sectionKey: 'shows',
			type: 'show',
			title: 'Pinned',
			mediaType: 'movie',
			manualMatchPinned: true
		},
		{
			serverInstanceId: 'server-b',
			ratingKey: 'b-show',
			sectionKey: 'shows',
			type: 'show',
			title: 'B show',
			mediaType: 'movie'
		}
	]);
});

afterEach(() => {
	client.close();
	for (const suffix of ['', '-shm', '-wal']) rmSync(`${databasePath}${suffix}`, { force: true });
});

describe('durable TMDB repair state', () => {
	it('counts and lists only active unpinned mismatches for one server', async () => {
		const repository = createTmdbRepairRepository(database);
		expect(await repository.countPending('server-a')).toBe(2);
		expect(await repository.countPending('server-b')).toBe(1);
		expect(await repository.listPendingItemIds('server-a')).toHaveLength(2);
	});

	it('survives a database reopen without an upgrade flag', async () => {
		client.close();
		client = createClient({ url: `file:${databasePath}` });
		database = drizzle(client, { schema });
		const repository = createTmdbRepairRepository(database);
		expect(await repository.countPending('server-a')).toBe(2);
	});

	it('reaches zero as units are corrected or manually pinned', async () => {
		const ids = await createTmdbRepairRepository(database).listPendingItemIds('server-a');
		await database.update(mediaItems).set({ mediaType: 'tv' }).where(eq(mediaItems.id, ids[0]));
		await database
			.update(mediaItems)
			.set({ manualMatchPinned: true })
			.where(eq(mediaItems.id, ids[1]));
		expect(await createTmdbRepairRepository(database).countPending('server-a')).toBe(0);
	});

	it('does not let stale enrichment or its watermark overwrite a pin that wins the repair race', async () => {
		const repository = createTmdbRepairRepository(database);
		const [itemId] = await repository.listPendingItemIds('server-a');
		const oldWatermark = new Date('2026-07-01T00:00:00.000Z');
		const automaticAt = new Date('2026-07-10T17:59:00.000Z');
		const pinnedAt = new Date('2026-07-10T18:00:00.000Z');
		await database
			.update(mediaItems)
			.set({
				tmdbId: '100',
				mediaType: 'tv',
				manualMatchPinned: false,
				resolutionUpdatedAt: automaticAt,
				overview: 'automatic metadata',
				lastSyncedAt: oldWatermark
			})
			.where(eq(mediaItems.id, itemId));
		const expected = {
			tmdbId: '100',
			mediaType: 'tv' as const,
			manualMatchPinned: false,
			resolutionUpdatedAt: automaticAt
		};

		// The user confirms a different identity while the worker is fetching metadata.
		await database
			.update(mediaItems)
			.set({
				tmdbId: '200',
				mediaType: 'tv',
				manualMatchPinned: true,
				resolutionUpdatedAt: pinnedAt,
				overview: 'manual metadata'
			})
			.where(eq(mediaItems.id, itemId));

		expect(
			await repository.writeMetadataIfCurrent({
				serverInstanceId: 'server-a',
				itemId,
				expected,
				metadata: {
					overview: 'stale automatic metadata',
					tagline: null,
					genres: [],
					runtime: null,
					rating: null,
					backdropUrl: null,
					logoUrl: null,
					seasonCount: 4,
					episodeCount: 40,
					cast: [],
					collection: { id: '900', name: 'Stale saga' }
				},
				existingLogoUrl: null,
				updatedAt: new Date('2026-07-10T18:00:00.000Z')
			})
		).toBe(false);
		expect(
			await repository.clearSyncWatermarkIfCurrent({
				serverInstanceId: 'server-a',
				itemId,
				expected
			})
		).toBe(false);
		expect(
			await repository.markSyncedIfCurrent({
				serverInstanceId: 'server-a',
				itemId,
				expected,
				syncedAt: new Date('2026-07-10T18:01:00.000Z')
			})
		).toBe(false);

		const [current] = await database
			.select({
				tmdbId: mediaItems.tmdbId,
				mediaType: mediaItems.mediaType,
				manualMatchPinned: mediaItems.manualMatchPinned,
				resolutionUpdatedAt: mediaItems.resolutionUpdatedAt,
				overview: mediaItems.overview,
				lastSyncedAt: mediaItems.lastSyncedAt
			})
			.from(mediaItems)
			.where(eq(mediaItems.id, itemId));
		expect(current).toEqual({
			tmdbId: '200',
			mediaType: 'tv',
			manualMatchPinned: true,
			resolutionUpdatedAt: pinnedAt,
			overview: 'manual metadata',
			lastSyncedAt: oldWatermark
		});
	});

	it('rejects stale enrichment after an automatic A to manual B to automatic A cycle', async () => {
		const repairRepository = createTmdbRepairRepository(database);
		const manualRepository = createManualMatchRepository(database);
		const [itemId] = await repairRepository.listPendingItemIds('server-a');
		const requestedAt = new Date('2026-07-10T18:00:00.000Z');
		const firstA = await manualRepository.applyAutomaticResolution('server-a', itemId, {
			resolution: { tmdbId: '100', mediaType: 'tv' },
			reason: 'tvdb_id',
			source: 'tvdb_id',
			attemptedSources: ['tvdb_id'],
			resolvedAt: requestedAt
		});

		await manualRepository.pin(
			'server-a',
			itemId,
			{
				tmdbId: '200',
				mediaType: 'tv',
				title: 'Manual B',
				originalTitle: 'Manual B',
				year: 2026,
				overview: null,
				posterUrl: null
			},
			requestedAt
		);
		await manualRepository.clear('server-a', itemId, requestedAt);
		const secondA = await manualRepository.applyAutomaticResolution('server-a', itemId, {
			resolution: { tmdbId: '100', mediaType: 'tv' },
			reason: 'tvdb_id',
			source: 'tvdb_id',
			attemptedSources: ['tvdb_id'],
			resolvedAt: requestedAt
		});
		await database
			.update(mediaItems)
			.set({ overview: 'new automatic metadata' })
			.where(eq(mediaItems.id, itemId));

		expect(secondA).toMatchObject({
			tmdbId: firstA.tmdbId,
			mediaType: firstA.mediaType,
			manualMatchPinned: firstA.manualMatchPinned
		});
		expect(secondA.resolutionUpdatedAt!.getTime()).toBeGreaterThan(
			firstA.resolutionUpdatedAt!.getTime()
		);
		expect(
			await repairRepository.writeMetadataIfCurrent({
				serverInstanceId: 'server-a',
				itemId,
				expected: {
					tmdbId: firstA.tmdbId,
					mediaType: firstA.mediaType,
					manualMatchPinned: firstA.manualMatchPinned,
					resolutionUpdatedAt: firstA.resolutionUpdatedAt
				},
				metadata: {
					overview: 'stale automatic metadata',
					tagline: null,
					genres: [],
					runtime: null,
					rating: null,
					backdropUrl: null,
					logoUrl: null,
					seasonCount: 1,
					episodeCount: 1,
					cast: [],
					collection: null
				},
				existingLogoUrl: null,
				updatedAt: new Date('2026-07-10T18:10:00.000Z')
			})
		).toBe(false);

		const [current] = await database
			.select({ overview: mediaItems.overview })
			.from(mediaItems)
			.where(eq(mediaItems.id, itemId));
		expect(current.overview).toBe('new automatic metadata');
	});

	it('keeps only a failed unit pending after a partial repair', async () => {
		const repository = createTmdbRepairRepository(database);
		const [succeededId, failedId] = await repository.listPendingItemIds('server-a');
		await database
			.update(mediaItems)
			.set({ mediaType: 'tv' })
			.where(eq(mediaItems.id, succeededId));
		const [job] = await database
			.insert(jobs)
			.values({
				serverInstanceId: 'server-a',
				type: 'tmdb_repair',
				status: 'partial_failed',
				processed: 2,
				total: 2,
				payload: { kind: 'tmdb_repair', serverInstanceId: 'server-a' }
			})
			.returning();

		expect(await repository.listPendingItemIds('server-a')).toEqual([failedId]);
		expect(await repository.getState('server-a')).toMatchObject({
			pendingCount: 1,
			job: { id: job.id, status: 'partial_failed', processed: 2, total: 2 }
		});
	});

	it('retains unprocessed units after a cancelled repair', async () => {
		const repository = createTmdbRepairRepository(database);
		const [completedId, pendingId] = await repository.listPendingItemIds('server-a');
		await database
			.update(mediaItems)
			.set({ mediaType: 'tv' })
			.where(eq(mediaItems.id, completedId));
		const [job] = await database
			.insert(jobs)
			.values({
				serverInstanceId: 'server-a',
				type: 'tmdb_repair',
				status: 'cancelled',
				processed: 1,
				total: 2,
				payload: { kind: 'tmdb_repair', serverInstanceId: 'server-a' }
			})
			.returning();

		expect(await repository.listPendingItemIds('server-a')).toEqual([pendingId]);
		expect(await repository.getState('server-a')).toMatchObject({
			pendingCount: 1,
			job: { id: job.id, status: 'cancelled', processed: 1, total: 2 }
		});
	});

	it('returns the latest matching retry job without leaking another server', async () => {
		const [parent] = await database
			.insert(jobs)
			.values({
				serverInstanceId: 'server-a',
				type: 'tmdb_repair',
				status: 'partial_failed',
				payload: { kind: 'tmdb_repair', serverInstanceId: 'server-a' }
			})
			.returning();
		const [retry] = await database
			.insert(jobs)
			.values({
				serverInstanceId: 'server-a',
				parentJobId: parent.id,
				type: 'retry',
				status: 'running',
				payload: { kind: 'tmdb_repair', serverInstanceId: 'server-a', itemIds: [1] }
			})
			.returning();
		await database.insert(jobs).values({
			serverInstanceId: 'server-b',
			type: 'tmdb_repair',
			status: 'running',
			payload: { kind: 'tmdb_repair', serverInstanceId: 'server-b' }
		});

		const state = await createTmdbRepairRepository(database).getState('server-a');
		expect(state.pendingCount).toBe(2);
		expect(state.job).toMatchObject({ id: retry.id, status: 'running' });
		expect(
			await database
				.select({ id: jobs.id })
				.from(jobs)
				.where(and(eq(jobs.serverInstanceId, 'server-a'), inArray(jobs.id, [parent.id, retry.id])))
		).toHaveLength(2);
	});
});
