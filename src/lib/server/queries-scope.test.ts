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

// getItemDetail resolves the config to hide candidates from disabled providers.
// The real config module loads $env at import time, so stub it with a mutable
// provider toggle the availability test below can flip.
const providerConfig = vi.hoisted(() => ({
	current: {
		providerMediux: true,
		providerTmdb: true,
		providerFanart: true,
		providerThePosterDb: true,
		tmdbKey: 'tmdb-key',
		fanartKey: 'fanart-key'
	}
}));
vi.mock('$lib/server/config', () => ({
	resolveConfig: async () => providerConfig.current
}));

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
	listPosterMatchCandidates,
	listPosterMatchEligibleItems
} from './queries';
import { queryReviewInbox } from './review/query';

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
				url: 'https://images.example.test/original/a.jpg',
				previewUrl: 'https://images.example.test/w500/a.jpg',
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

	it('hides stored candidates from providers the user has since disabled', async () => {
		try {
			let detail = await getItemDetail(itemA, 'server-a');
			expect(detail?.candidates.map((candidate) => candidate.provider).sort()).toEqual([
				'fanarttv',
				'tmdb'
			]);
			const tmdbCandidate = detail?.candidates.find((candidate) => candidate.provider === 'tmdb');
			await db
				.update(mediaItems)
				.set({
					selectedPosterUrl: tmdbCandidate!.url,
					selectedPosterCandidateId: tmdbCandidate!.id
				})
				.where(eq(mediaItems.id, itemA));

			providerConfig.current.providerFanart = false;
			detail = await getItemDetail(itemA, 'server-a');
			expect(detail?.candidates.map((candidate) => candidate.provider)).toEqual(['tmdb']);

			providerConfig.current.providerMediux = false;
			providerConfig.current.providerTmdb = false;
			providerConfig.current.providerThePosterDb = false;
			detail = await getItemDetail(itemA, 'server-a');
			expect(detail?.candidates).toEqual([]);
			expect(detail?.providerGroups).toEqual([]);
			expect(detail?.selectedRootPreviews.poster).toBe(tmdbCandidate!.previewUrl);
		} finally {
			providerConfig.current.providerMediux = true;
			providerConfig.current.providerTmdb = true;
			providerConfig.current.providerFanart = true;
			providerConfig.current.providerThePosterDb = true;
			await db
				.update(mediaItems)
				.set({
					selectedPosterUrl: 'https://provider.invalid/staged?secret=value',
					selectedPosterCandidateId: null
				})
				.where(eq(mediaItems.id, itemA));
		}
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
		const matchCandidates = await listPosterMatchCandidates(itemA, 'server-a');
		expect(matchCandidates.find((candidate) => candidate.provider === 'tmdb')).toMatchObject({
			url: 'https://images.example.test/original/a.jpg',
			previewUrl: 'https://images.example.test/w500/a.jpg'
		});
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

	it('resolves staged previews only from the same item, kind, and canonical URL', async () => {
		const ownCandidates = await db
			.select()
			.from(posterCandidates)
			.where(eq(posterCandidates.mediaItemId, itemA));
		const ownTmdb = ownCandidates.find((candidate) => candidate.provider === 'tmdb')!;
		const staleSameItem = ownCandidates.find((candidate) => candidate.provider === 'fanarttv')!;
		const [otherItem] = await db
			.insert(mediaItems)
			.values({
				serverInstanceId: 'server-a',
				ratingKey: 'other-native-id',
				sectionKey: 'movies',
				type: 'movie',
				title: 'Other title'
			})
			.returning({ id: mediaItems.id });
		const [otherCandidate] = await db
			.insert(posterCandidates)
			.values({
				serverInstanceId: 'server-a',
				mediaItemId: otherItem.id,
				setId: 'other-set',
				provider: 'tmdb',
				url: ownTmdb.url,
				previewUrl: 'https://images.example.test/w500/wrong-item.jpg',
				kind: 'poster'
			})
			.returning({ id: posterCandidates.id });
		const [wrongKindCandidate] = await db
			.insert(posterCandidates)
			.values({
				serverInstanceId: 'server-a',
				mediaItemId: itemA,
				setId: 'wrong-kind',
				provider: 'tmdb',
				url: ownTmdb.url,
				previewUrl: 'https://images.example.test/w1280/wrong-kind.jpg',
				kind: 'background'
			})
			.returning({ id: posterCandidates.id });
		const reviewItem = async () =>
			(
				await queryReviewInbox({ serverInstanceId: 'server-a' }, { limit: 100, offset: 0 })
			).items.find((entry) => entry.item.id === itemA)!.item;

		try {
			await db
				.update(mediaItems)
				.set({ selectedPosterUrl: ownTmdb.url, selectedPosterCandidateId: otherCandidate.id })
				.where(eq(mediaItems.id, itemA));
			await expect(reviewItem()).resolves.toMatchObject({
				selectedPosterUrl: ownTmdb.url,
				selectedPosterPreviewUrl: ownTmdb.previewUrl
			});

			await db
				.update(mediaItems)
				.set({ selectedPosterCandidateId: staleSameItem.id })
				.where(eq(mediaItems.id, itemA));
			await expect(reviewItem()).resolves.toMatchObject({
				selectedPosterPreviewUrl: ownTmdb.previewUrl
			});

			await db
				.update(mediaItems)
				.set({ selectedPosterCandidateId: wrongKindCandidate.id })
				.where(eq(mediaItems.id, itemA));
			await expect(reviewItem()).resolves.toMatchObject({
				selectedPosterPreviewUrl: ownTmdb.previewUrl
			});

			await db
				.update(mediaItems)
				.set({ selectedPosterCandidateId: null })
				.where(eq(mediaItems.id, itemA));
			await expect(reviewItem()).resolves.toMatchObject({
				selectedPosterPreviewUrl: ownTmdb.previewUrl
			});
		} finally {
			await db.delete(posterCandidates).where(eq(posterCandidates.id, otherCandidate.id));
			await db.delete(posterCandidates).where(eq(posterCandidates.id, wrongKindCandidate.id));
			await db.delete(mediaItems).where(eq(mediaItems.id, otherItem.id));
			await db
				.update(mediaItems)
				.set({
					selectedPosterUrl: 'https://provider.invalid/staged?secret=value',
					selectedPosterCandidateId: null
				})
				.where(eq(mediaItems.id, itemA));
		}
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
