import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/db', async () => {
	const { drizzle } = await import('drizzle-orm/libsql');
	const { createClient } = await import('@libsql/client');
	const { migrate } = await import('drizzle-orm/libsql/migrator');
	const schema = await import('./db/schema');
	const client = createClient({ url: ':memory:' });
	const db = drizzle(client, { schema });
	await migrate(db, { migrationsFolder: './drizzle' });
	return { db, migrateDb: async () => {} };
});

import { db } from '$lib/server/db';
import { eq } from 'drizzle-orm';
import {
	appliedPosters,
	events,
	jobItemOutcomes,
	jobs,
	mediaItems,
	posterCandidates,
	serverInstances
} from '$lib/server/db/schema';
import {
	activeJobCount,
	clearEvents,
	countFunEligible,
	getJob,
	getItemDetail,
	getMediaItem,
	getMontagePosters,
	getSpotlightItem,
	getStats,
	listFunEligibleItems,
	listFunItemsByIds,
	listFunLibraries,
	listEvents,
	listActiveJobs,
	listJobs,
	listLibrary,
	listPosterMatchEligibleItems
} from './queries';

let itemA = 0;
let terminalJobA = 0;

describe('server-scoped queries', () => {
	beforeAll(async () => {
		await db.insert(serverInstances).values([
			{ id: 'server-a', name: 'A', normalizedName: 'a', type: 'plex' },
			{ id: 'server-b', name: 'B', normalizedName: 'b', type: 'jellyfin' }
		]);
		const inserted = await db
			.insert(mediaItems)
			.values([
				{
					serverInstanceId: 'server-a',
					ratingKey: 'same-native-id',
					sectionKey: 'movies',
					type: 'movie',
					title: 'A title',
					runtime: 120,
					currentPosterUrl: 'https://server.invalid/poster?token=private',
					currentBackgroundUrl: 'https://server.invalid/background?token=private',
					currentPosterFingerprint: 'poster-v1',
					selectedPosterUrl: 'https://provider.invalid/staged?secret=value',
					backdropUrl: 'https://images.example.test/backdrop.jpg'
				},
				{
					serverInstanceId: 'server-b',
					ratingKey: 'same-native-id',
					sectionKey: 'movies',
					type: 'movie',
					title: 'B title'
				}
			])
			.returning({ id: mediaItems.id });
		itemA = inserted[0].id;
		await db.insert(posterCandidates).values([
			{
				serverInstanceId: 'server-a',
				mediaItemId: itemA,
				setId: 'set-a',
				provider: 'tmdb',
				url: 'https://images.example.test/a.jpg',
				kind: 'poster'
			},
			{
				serverInstanceId: 'server-a',
				mediaItemId: itemA,
				setId: 'set-b',
				provider: 'fanarttv',
				url: 'https://images.example.test/b.jpg',
				kind: 'poster'
			}
		]);
		await db.insert(appliedPosters).values({
			serverInstanceId: 'server-a',
			mediaItemId: itemA,
			url: 'https://provider.invalid/applied.jpg',
			method: 'server',
			status: 'success'
		});
		const insertedJobs = await db
			.insert(jobs)
			.values([
				{ serverInstanceId: 'server-a', type: 'sync', status: 'running' },
				{
					serverInstanceId: 'server-a',
					type: 'discover',
					status: 'partial_failed',
					result: { summary: { succeeded: 2, failed: 1 }, privateUrl: 'https://secret' },
					errorCode: 'item_failures',
					error: 'request failed?token=secret'
				},
				{ serverInstanceId: 'server-b', type: 'discover', status: 'running' }
			])
			.returning({ id: jobs.id, status: jobs.status });
		terminalJobA = insertedJobs.find((job) => job.status === 'partial_failed')!.id;
		await db.insert(jobItemOutcomes).values({
			jobId: terminalJobA,
			serverInstanceId: 'server-a',
			mediaItemId: itemA,
			status: 'failed',
			retryable: true,
			result: { url: 'https://example.test/image?token=secret' },
			errorCode: 'provider_timeout',
			error: 'Bearer secret'
		});
		await db.insert(events).values([
			{
				serverInstanceId: 'server-a',
				level: 'info',
				type: 'sync',
				message: 'A event',
				context: JSON.stringify({ url: 'https://server.invalid?token=secret' })
			},
			{ serverInstanceId: 'server-b', level: 'warn', type: 'sync', message: 'B event' }
		]);
	});

	it('never returns an item through another server scope', async () => {
		expect((await getMediaItem(itemA, 'server-a'))?.title).toBe('A title');
		expect(await getMediaItem(itemA, 'server-b')).toBeNull();
		expect(await getItemDetail(itemA, 'server-b')).toBeNull();
		const detail = await getItemDetail(itemA, 'server-a');
		expect(detail?.item).toMatchObject({ hasCurrentPoster: true, hasCurrentBackground: true });
		expect(detail?.item).not.toHaveProperty('currentPosterUrl');
		expect(detail?.item).not.toHaveProperty('currentBackgroundUrl');
	});

	it('isolates dashboard, job, and event reads and scoped deletion', async () => {
		expect(await getStats('server-a')).toMatchObject({ total: 1, movies: 1 });
		expect(await getStats('server-b')).toMatchObject({ total: 1, movies: 1 });
		expect(await activeJobCount('server-a')).toBe(1);
		expect(
			(await listJobs(10, 'server-a')).every((job) => job.serverInstanceId === 'server-a')
		).toBe(true);
		const publicEvents = await listEvents({ serverInstanceId: 'server-a' });
		expect(publicEvents.map((event) => event.message)).toEqual(['A event']);
		expect(publicEvents[0]).not.toHaveProperty('context');
		expect(JSON.stringify(publicEvents)).not.toContain('token=secret');

		await clearEvents('server-a');
		expect(await listEvents({ serverInstanceId: 'server-a' })).toEqual([]);
		expect(
			(await listEvents({ serverInstanceId: 'server-b' })).map((event) => event.message)
		).toEqual(['B event']);
	});

	it('authorizes one cross-server job from both its frozen source and destinations', async () => {
		const [crossServerJob] = await db
			.insert(jobs)
			.values({
				serverInstanceId: null,
				type: 'cross_server_apply',
				status: 'running',
				payload: {
					kind: 'apply',
					planId: 'cross-plan',
					digest: 'a'.repeat(64),
					plan: {
						context: {
							source: 'cross_server',
							sourceItem: { serverInstanceId: 'server-a' }
						},
						scope: { serverInstanceIds: ['server-b'] }
					}
				}
			})
			.returning({ id: jobs.id });
		try {
			expect(await getJob(crossServerJob.id, 'server-a')).toMatchObject({
				id: crossServerJob.id,
				serverInstanceId: null
			});
			expect(await getJob(crossServerJob.id, 'server-b')).toMatchObject({
				id: crossServerJob.id,
				serverInstanceId: null
			});
			expect(await getJob(crossServerJob.id, 'server-c')).toBeNull();
			expect((await listJobs(20, 'server-a')).map((job) => job.id)).toContain(crossServerJob.id);
			expect((await listJobs(20, 'server-b')).map((job) => job.id)).toContain(crossServerJob.id);
			expect((await listActiveJobs('server-a')).map((job) => job.id)).toContain(crossServerJob.id);
			expect(await activeJobCount('server-a')).toBe(2);
			expect(await activeJobCount('server-b')).toBe(2);
		} finally {
			await db.delete(jobs).where(eq(jobs.id, crossServerJob.id));
		}
	});

	it('projects library rows without serializing media-server or provider URLs', async () => {
		const [item] = await listLibrary({ serverInstanceId: 'server-a' });
		expect(item).toMatchObject({
			id: itemA,
			title: 'A title',
			hasPoster: true,
			hasStagedPoster: true,
			posterVersion: 'poster-v1'
		});
		expect(item).not.toHaveProperty('currentPosterUrl');
		expect(item).not.toHaveProperty('selectedPosterUrl');
		expect(JSON.stringify(item)).not.toMatch(/server\.invalid|provider\.invalid|token|secret/i);
		expect(await getMontagePosters(10, 'server-a')).toEqual([{ id: itemA, version: 'poster-v1' }]);
		const spotlight = await getSpotlightItem('server-a');
		expect(spotlight).toMatchObject({ id: itemA, title: 'A title' });
		expect(spotlight).not.toHaveProperty('currentPosterUrl');
		expect(spotlight).not.toHaveProperty('currentBackgroundUrl');
	});

	it('projects FUN and Poster Match rows without media-server URLs or secrets', async () => {
		const filter = {
			serverInstanceId: 'server-a',
			excludeWatched: false,
			count: 3 as const,
			excludeItemIds: [],
			mode: 'standard' as const
		};
		const [choice] = await listFunEligibleItems(filter);
		expect(choice).toMatchObject({
			id: itemA,
			title: 'A title',
			hasPoster: true,
			posterVersion: 'poster-v1'
		});
		expect(choice).not.toHaveProperty('currentPosterUrl');
		expect(choice).not.toHaveProperty('currentBackgroundUrl');
		expect(JSON.stringify(choice)).not.toMatch(/server\.invalid|provider\.invalid|token|secret/i);

		const [matchItem] = await listPosterMatchEligibleItems('server-a');
		expect(matchItem).toEqual({ id: itemA, title: 'A title', year: null });
		expect(JSON.stringify(matchItem)).not.toMatch(
			/server\.invalid|provider\.invalid|token|secret/i
		);
		expect((await listFunItemsByIds([999_999, itemA], 'server-a')).map((item) => item.id)).toEqual([
			itemA
		]);
		expect(await listFunItemsByIds([itemA], 'server-b')).toEqual([]);
		expect(await listFunLibraries('server-a')).toEqual([{ key: 'movies', type: 'movie' }]);
		expect(await listFunLibraries('server-b')).toEqual([{ key: 'movies', type: 'movie' }]);
		expect(await countFunEligible(filter, new Date(), { requireRuntime: true })).toBe(1);
		expect(
			await countFunEligible({ ...filter, serverInstanceId: '__no_active_server__' }, new Date(), {
				requireRuntime: true
			})
		).toBe(0);
	});

	it('hides source-removed items from active counts while retaining scoped history access', async () => {
		await db
			.update(mediaItems)
			.set({ sourceRemovedAt: new Date('2026-07-11T00:00:00.000Z') })
			.where(eq(mediaItems.id, itemA));

		expect(await getStats('server-a')).toMatchObject({ total: 0, movies: 0 });
		expect((await getMediaItem(itemA, 'server-a'))?.title).toBe('A title');
		expect(await getStats('server-b')).toMatchObject({ total: 1, movies: 1 });
	});

	it('hydrates only sanitized terminal summaries and retryable failures', async () => {
		const terminal = (await listJobs(10, 'server-a')).find((job) => job.id === terminalJobA)!;
		expect(terminal).toMatchObject({
			status: 'partial_failed',
			resultSummary: { succeeded: 2, failed: 1, skipped: 0, interrupted: 0 },
			failureCount: 1,
			retryableFailedCount: 1
		});
		expect(terminal.failures[0]).toMatchObject({
			mediaItemId: itemA,
			errorCode: 'provider_timeout',
			errorMessage: 'Bearer [redacted]'
		});
		expect(JSON.stringify(terminal)).not.toContain('privateUrl');
		expect(JSON.stringify(terminal)).not.toContain('token=secret');
	});
});
