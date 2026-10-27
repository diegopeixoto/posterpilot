import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '$lib/server/config';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/db', async () => {
	const { createClient } = await import('@libsql/client');
	const { drizzle } = await import('drizzle-orm/libsql');
	const { migrate } = await import('drizzle-orm/libsql/migrator');
	const schema = await import('$lib/server/db/schema');
	const client = createClient({ url: 'file::memory:?cache=shared' });
	const db = drizzle(client, { schema });
	await migrate(db, { migrationsFolder: './drizzle' });
	return { db, databaseClient: client, migrateDb: async () => undefined };
});
vi.mock('$lib/server/events', () => ({ logEvent: vi.fn(async () => undefined) }));
vi.mock('$lib/server/http', () => ({ fetchText: vi.fn(), fetchJson: vi.fn() }));
vi.mock('./score-weights', () => ({
	getScoreWeights: vi.fn(async () => ({
		providerWeights: { theposterdb: 0.8 },
		resolutionWeight: 0.5,
		aspectWeight: 0.3
	}))
}));

import { db } from '$lib/server/db';
import {
	mediaItems,
	posterCandidates,
	providerDiscoveryOutcomes,
	providerDiscoveryRuns,
	serverInstances
} from '$lib/server/db/schema';
import { fetchText } from '$lib/server/http';
import { discoverForItem } from './service';

const config = {
	providerMediux: true,
	providerThePosterDb: true,
	thePosterDbUsername: null,
	thePosterDbPassword: null,
	httpCacheTtlDays: 0
} as AppConfig;
let item: typeof mediaItems.$inferSelect;
const search =
	'<a href="https://theposterdb.com/posters/123"><strong>Test Movie</strong> (2001)</a>';
const challenge = '<form id="challenge-form" action="/cdn-cgi/challenge-platform/x"></form>';

beforeEach(async () => {
	vi.mocked(fetchText).mockReset();
	await db.delete(posterCandidates);
	await db.delete(providerDiscoveryOutcomes);
	await db.delete(providerDiscoveryRuns);
	await db.delete(mediaItems);
	await db.delete(serverInstances);
	await db
		.insert(serverInstances)
		.values({ id: 'server-a', name: 'A', normalizedName: 'a', type: 'plex' });
	[item] = await db
		.insert(mediaItems)
		.values({
			serverInstanceId: 'server-a',
			ratingKey: '1',
			sectionKey: 'movies',
			type: 'movie',
			title: 'Test Movie',
			year: 2001,
			mediaType: 'movie',
			tmdbId: '584'
		})
		.returning();
});

describe('discovery outcome persistence', () => {
	it('retains stale candidates on blocked MediUX while ThePosterDB succeeds independently', async () => {
		await db
			.insert(posterCandidates)
			.values({
				serverInstanceId: 'server-a',
				mediaItemId: item.id,
				provider: 'mediux',
				setId: 'old',
				url: 'https://example.com/old.jpg',
				kind: 'poster',
				score: 0
			});
		vi.mocked(fetchText).mockImplementation(async (url) =>
			url.includes('mediux.pro')
				? challenge
				: url.includes('/search?')
					? search
					: '<img src="https://theposterdb.com/api/assets/111">'
		);
		expect(await discoverForItem(item, config, { providers: ['mediux', 'theposterdb'] })).toBe(2);
		const outcomes = await db.select().from(providerDiscoveryOutcomes);
		expect(outcomes.find((row) => row.provider === 'mediux')).toMatchObject({
			status: 'failed',
			errorCode: 'mediux_blocked',
			candidateCount: 1,
			retainedStaleCandidates: true
		});
		expect(outcomes.find((row) => row.provider === 'theposterdb')).toMatchObject({
			status: 'succeeded',
			candidateCount: 1
		});
		const candidates = await db.select().from(posterCandidates);
		expect(candidates.find((row) => row.provider === 'mediux')).toMatchObject({
			active: true,
			stale: true
		});
		expect(candidates.find((row) => row.provider === 'theposterdb')).toMatchObject({
			active: true,
			stale: false
		});
		expect((await db.select().from(providerDiscoveryRuns))[0].status).toBe('partial');
		expect((await db.select().from(mediaItems))[0].discoveryStatus).toBe('partial');
	});

	it('records a placeholder-only ThePosterDB page as failed instead of empty', async () => {
		vi.mocked(fetchText)
			.mockResolvedValueOnce(search)
			.mockResolvedValueOnce(
				'<picture><img class="tpdb-poster" src="/images/defaults/missing_poster.jpg"></picture><div data-poster-id="123"></div>'
			);
		await discoverForItem(item, config, { providers: ['theposterdb'] });
		expect((await db.select().from(providerDiscoveryOutcomes))[0]).toMatchObject({
			status: 'failed',
			candidateCount: 0,
			errorCode: 'theposterdb_placeholder_only'
		});
		expect((await db.select().from(mediaItems))[0].discoveryStatus).toBe('failed');
	});

	it('stores an actual no-match as empty, with no error', async () => {
		vi.mocked(fetchText).mockResolvedValue('<html>no matching titles</html>');
		await discoverForItem(item, config, { providers: ['theposterdb'] });
		expect((await db.select().from(providerDiscoveryOutcomes))[0]).toMatchObject({
			status: 'empty',
			candidateCount: 0,
			errorCode: null
		});
	});
});
