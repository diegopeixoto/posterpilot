import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/posters/service', () => ({ autoSelectArtwork: vi.fn() }));
vi.mock('$lib/server/posters/score-weights', () => ({
	getProviderPriority: async () => ['mediux', 'tmdb'],
	getScoreWeights: async () => ({
		providerWeights: { mediux: 1, tmdb: 0.5 },
		resolutionWeight: 0.5,
		aspectWeight: 0.3
	})
}));
vi.mock('$lib/server/config', () => ({
	resolveConfig: async () => ({ defaultApplyMethod: 'plex' })
}));
vi.mock('$lib/server/db', async () => {
	const { createClient } = await import('@libsql/client');
	const { drizzle } = await import('drizzle-orm/libsql');
	const { migrate } = await import('drizzle-orm/libsql/migrator');
	const schema = await import('$lib/server/db/schema');
	const client = createClient({ url: ':memory:' });
	const db = drizzle(client, { schema });
	await migrate(db, { migrationsFolder: './drizzle' });
	return { db, migrateDb: async () => undefined };
});

import { db } from '$lib/server/db';
import {
	artworkSlotStates,
	childSelections,
	mediaItems,
	posterCandidates,
	providerDiscoveryRuns,
	serverInstances
} from '$lib/server/db/schema';
import { loadDatabaseApplyPlannerItemData } from './apply-planner-db';

beforeEach(async () => {
	await db.delete(childSelections);
	await db.delete(artworkSlotStates);
	await db.delete(posterCandidates);
	await db.delete(providerDiscoveryRuns);
	await db.delete(mediaItems);
	await db.delete(serverInstances);
});

describe('database apply-planner snapshot', () => {
	it('loads persisted root/child selections, candidates, discovery, and current state', async () => {
		await db.insert(serverInstances).values({
			id: 'server-a',
			name: 'Cinema',
			normalizedName: 'cinema',
			type: 'plex'
		});
		const [item] = await db
			.insert(mediaItems)
			.values({
				serverInstanceId: 'server-a',
				ratingKey: 'plex-42',
				sectionKey: 'movies',
				type: 'show',
				title: 'Example',
				tmdbId: '42',
				mediaType: 'tv',
				currentPosterUrl: 'https://server.example/current.jpg',
				currentPosterFingerprint: 'poster-before',
				artworkVersion: 7,
				selectedPosterUrl: 'https://images.example/poster.jpg',
				selectedPosterCandidateId: 1,
				selectedBackgroundUrl: 'https://custom.example/background.jpg',
				selectionUpdatedAt: new Date('2026-07-10T11:00:00Z'),
				discoveryStatus: 'succeeded',
				discoveryCompletedAt: new Date('2026-07-10T10:59:00Z'),
				lastSyncedAt: new Date('2026-07-10T10:00:00Z')
			})
			.returning();
		const insertedCandidates = await db
			.insert(posterCandidates)
			.values([
				{
					serverInstanceId: 'server-a',
					mediaItemId: item.id,
					discoveryRunId: 'run-1',
					provider: 'mediux',
					providerAssetId: 'asset-poster',
					setId: 'set-1',
					setAuthor: 'artist',
					url: 'https://images.example/poster.jpg',
					kind: 'poster',
					resolvedTmdbId: '42',
					resolvedMediaType: 'tv',
					active: true,
					stale: false
				},
				{
					serverInstanceId: 'server-a',
					mediaItemId: item.id,
					discoveryRunId: 'run-1',
					provider: 'tmdb',
					setId: 'season-set',
					url: 'https://images.example/s01e02.jpg',
					kind: 'title_card',
					season: 1,
					episode: 2,
					resolvedTmdbId: '42',
					resolvedMediaType: 'tv',
					active: true,
					stale: true
				}
			])
			.returning();
		await db
			.update(mediaItems)
			.set({ selectedPosterCandidateId: insertedCandidates[0].id })
			.where(eq(mediaItems.id, item.id));
		await db.insert(childSelections).values({
			serverInstanceId: 'server-a',
			mediaItemId: item.id,
			kind: 'title_card',
			season: 1,
			episode: 2,
			url: 'https://images.example/s01e02.jpg',
			candidateId: insertedCandidates[1].id,
			provider: 'tmdb',
			setId: 'season-set'
		});
		await db.insert(artworkSlotStates).values({
			serverInstanceId: 'server-a',
			mediaItemId: item.id,
			kind: 'title_card',
			season: 1,
			episode: 2,
			currentUrl: 'https://server.example/old-s01e02.jpg',
			currentFingerprint: 'title-card-before',
			artworkVersion: 2,
			lastObservedAt: new Date('2026-07-10T10:30:00Z')
		});
		await db.insert(providerDiscoveryRuns).values({
			id: 'run-1',
			serverInstanceId: 'server-a',
			mediaItemId: item.id,
			tmdbId: '42',
			mediaType: 'tv',
			status: 'succeeded',
			startedAt: new Date('2026-07-10T10:58:00Z'),
			completedAt: new Date('2026-07-10T10:59:00Z')
		});

		const snapshot = await loadDatabaseApplyPlannerItemData({
			serverInstanceId: 'server-a',
			mediaItemId: item.id
		});

		expect(snapshot?.item.identity).toMatchObject({
			serverInstanceId: 'server-a',
			mediaItemId: item.id,
			sourceId: 'plex-42',
			tmdbId: '42',
			mediaType: 'tv'
		});
		expect(snapshot?.item.discovery).toEqual({
			status: 'succeeded',
			runId: 'run-1',
			completedAt: '2026-07-10T10:59:00.000Z'
		});
		expect(snapshot?.candidates).toHaveLength(2);
		expect(snapshot?.candidates[1]).toMatchObject({
			candidateId: insertedCandidates[1].id,
			stale: true,
			slot: { kind: 'title_card', season: 1, episode: 2 }
		});
		expect(snapshot?.storedSelections).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					candidateId: insertedCandidates[0].id,
					provider: 'mediux',
					slot: { kind: 'poster', season: null, episode: null }
				}),
				expect.objectContaining({
					candidateId: null,
					url: 'https://custom.example/background.jpg',
					slot: { kind: 'background', season: null, episode: null }
				}),
				expect.objectContaining({
					candidateId: insertedCandidates[1].id,
					provider: 'tmdb',
					slot: { kind: 'title_card', season: 1, episode: 2 }
				})
			])
		);
		expect(snapshot?.item.currentSlots).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					slot: { kind: 'poster', season: null, episode: null },
					fingerprint: 'poster-before',
					artworkVersion: 7
				}),
				expect.objectContaining({
					slot: { kind: 'title_card', season: 1, episode: 2 },
					fingerprint: 'title-card-before',
					artworkVersion: 2
				})
			])
		);
	});
});
