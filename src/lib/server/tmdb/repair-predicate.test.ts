import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { asc } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema';
import { mediaItems, serverInstances } from '$lib/server/db/schema';
import {
	CROSS_NAMESPACE_RESOLUTION_REASON,
	isPendingTmdbTypeMismatch,
	pendingTmdbTypeMismatchCondition,
	type TmdbTypeMismatchItem
} from './repair-predicate';

let client: Client;
let database: LibSQLDatabase<typeof schema>;

function mismatchItem(overrides: Partial<TmdbTypeMismatchItem> = {}): TmdbTypeMismatchItem {
	return {
		serverInstanceId: 'server-a',
		type: 'show',
		mediaType: 'movie',
		manualMatchPinned: false,
		sourceRemovedAt: null,
		...overrides
	};
}

describe('pending TMDB type mismatch predicate', () => {
	beforeAll(async () => {
		client = createClient({ url: ':memory:' });
		database = drizzle(client, { schema });
		await migrate(database, { migrationsFolder: './drizzle' });

		await database.insert(serverInstances).values([
			{ id: 'server-a', name: 'A', normalizedName: 'a', type: 'plex' },
			{ id: 'server-b', name: 'B', normalizedName: 'b', type: 'jellyfin' }
		]);

		await database.insert(mediaItems).values([
			{
				serverInstanceId: 'server-a',
				ratingKey: 'show-as-movie',
				sectionKey: 'shows',
				type: 'show',
				title: 'Show stored as movie',
				mediaType: 'movie'
			},
			{
				serverInstanceId: 'server-a',
				ratingKey: 'movie-as-tv',
				sectionKey: 'movies',
				type: 'movie',
				title: 'Movie stored as TV',
				mediaType: 'tv'
			},
			{
				serverInstanceId: 'server-a',
				ratingKey: 'correct-show',
				sectionKey: 'shows',
				type: 'show',
				title: 'Correct show',
				mediaType: 'tv'
			},
			{
				serverInstanceId: 'server-a',
				ratingKey: 'correct-movie',
				sectionKey: 'movies',
				type: 'movie',
				title: 'Correct movie',
				mediaType: 'movie'
			},
			{
				serverInstanceId: 'server-a',
				ratingKey: 'unresolved',
				sectionKey: 'shows',
				type: 'show',
				title: 'Unresolved show',
				mediaType: null
			},
			{
				serverInstanceId: 'server-a',
				ratingKey: 'pinned-mismatch',
				sectionKey: 'shows',
				type: 'show',
				title: 'Pinned mismatch',
				mediaType: 'movie',
				manualMatchPinned: true
			},
			{
				serverInstanceId: 'server-a',
				ratingKey: 'removed-mismatch',
				sectionKey: 'movies',
				type: 'movie',
				title: 'Removed mismatch',
				mediaType: 'tv',
				sourceRemovedAt: new Date('2026-08-01T00:00:00.000Z')
			},
			{
				serverInstanceId: 'server-b',
				ratingKey: 'other-server-mismatch',
				sectionKey: 'shows',
				type: 'show',
				title: 'Other server mismatch',
				mediaType: 'movie'
			},
			{
				serverInstanceId: 'server-a',
				ratingKey: 'verified-cross-namespace',
				sectionKey: 'movies',
				type: 'movie',
				title: 'Miniseries filed in a movie library',
				mediaType: 'tv',
				resolutionReason: CROSS_NAMESPACE_RESOLUTION_REASON
			}
		]);
	});

	afterAll(async () => {
		client.close();
	});

	it('matches both cross-type directions and nothing else in the requested server', async () => {
		const rows = await database
			.select({ ratingKey: mediaItems.ratingKey })
			.from(mediaItems)
			.where(pendingTmdbTypeMismatchCondition('server-a'))
			.orderBy(asc(mediaItems.ratingKey));

		expect(rows.map((row) => row.ratingKey)).toEqual(['movie-as-tv', 'show-as-movie']);
	});

	it('keeps identical native ids isolated by server scope', async () => {
		const serverARows = await database
			.select({ ratingKey: mediaItems.ratingKey })
			.from(mediaItems)
			.where(pendingTmdbTypeMismatchCondition('server-a'));
		const serverBRows = await database
			.select({ ratingKey: mediaItems.ratingKey })
			.from(mediaItems)
			.where(pendingTmdbTypeMismatchCondition('server-b'));

		expect(serverARows.map((row) => row.ratingKey).sort()).toEqual([
			'movie-as-tv',
			'show-as-movie'
		]);
		expect(serverBRows.map((row) => row.ratingKey)).toEqual(['other-server-mismatch']);
	});

	it.each([
		['active unpinned show stored as movie', mismatchItem(), true],
		['active unpinned movie stored as TV', mismatchItem({ type: 'movie', mediaType: 'tv' }), true],
		['correct show', mismatchItem({ mediaType: 'tv' }), false],
		['correct movie', mismatchItem({ type: 'movie', mediaType: 'movie' }), false],
		['unresolved item', mismatchItem({ mediaType: null }), false],
		['manual pin', mismatchItem({ manualMatchPinned: true }), false],
		['removed source', mismatchItem({ sourceRemovedAt: new Date('2026-08-01') }), false],
		['different server', mismatchItem({ serverInstanceId: 'server-b' }), false],
		// Verified in the opposite namespace: cross-typed by construction, and
		// re-resolving it would return the same answer forever.
		[
			'verified cross-namespace resolution',
			mismatchItem({
				type: 'movie',
				mediaType: 'tv',
				resolutionReason: CROSS_NAMESPACE_RESOLUTION_REASON
			}),
			false
		]
	] as const)('%s => %s', (_label, item, expected) => {
		expect(isPendingTmdbTypeMismatch(item, 'server-a')).toBe(expected);
	});
});
