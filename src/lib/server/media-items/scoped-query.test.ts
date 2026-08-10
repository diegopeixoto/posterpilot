import { createClient, type Client } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from '$lib/server/db/schema';
import { mediaItems, serverInstances } from '$lib/server/db/schema';
import {
	loadScopedMediaItemsById,
	MediaItemScopeMismatchError,
	requireScopedMediaItemsById
} from './scoped-query';

let client: Client;
let database: LibSQLDatabase<typeof schema>;
let queries: Array<{ sql: string; params: unknown[] }>;

beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	queries = [];
	database = drizzle(client, {
		schema,
		logger: {
			logQuery(sql, params) {
				queries.push({ sql, params });
			}
		}
	});
	await migrate(database, { migrationsFolder: './drizzle' });
	await database.insert(serverInstances).values([
		{
			id: 'server-a',
			name: 'Server A',
			normalizedName: 'server a',
			type: 'plex'
		},
		{
			id: 'server-b',
			name: 'Server B',
			normalizedName: 'server b',
			type: 'jellyfin'
		}
	]);
	const items = Array.from({ length: 1_100 }, (_, index) => ({
		serverInstanceId: 'server-a',
		ratingKey: `item-${index + 1}`,
		sectionKey: 'movies',
		type: 'movie' as const,
		title: `Item ${index + 1}`
	}));
	for (let offset = 0; offset < items.length; offset += 80) {
		await database.insert(mediaItems).values(items.slice(offset, offset + 80));
	}
	await database.insert(mediaItems).values({
		serverInstanceId: 'server-b',
		ratingKey: 'other-server',
		sectionKey: 'movies',
		type: 'movie',
		title: 'Other server'
	});
	queries = [];
});

afterEach(async () => {
	await client.close();
});

describe('requireScopedMediaItemsById', () => {
	it('queries a large caller scope in bounded batches and preserves first-seen order', async () => {
		const ids = Array.from({ length: 1_100 }, (_, index) => index + 1);
		const requested = [ids[1_099], ...ids.slice(0, 1_099), ids[1_099]];

		const rows = await requireScopedMediaItemsById(database, 'server-a', requested);

		expect(rows.map((row) => row.id)).toEqual([1_100, ...ids.slice(0, 1_099)]);
		expect(queries).toHaveLength(3);
		expect(queries.map((query) => query.params.length)).toEqual([501, 501, 101]);
	});

	it('rejects cross-server, absent, and invalid ids without widening the scope', async () => {
		await expect(
			requireScopedMediaItemsById(database, 'server-a', [1, 1_101])
		).rejects.toBeInstanceOf(MediaItemScopeMismatchError);
		await expect(requireScopedMediaItemsById(database, 'server-a', [9_999])).rejects.toBeInstanceOf(
			MediaItemScopeMismatchError
		);
		await expect(requireScopedMediaItemsById(database, 'server-a', [0])).rejects.toBeInstanceOf(
			MediaItemScopeMismatchError
		);
	});

	it('returns an empty scope without issuing a query', async () => {
		await expect(requireScopedMediaItemsById(database, 'server-a', [])).resolves.toEqual([]);
		expect(queries).toEqual([]);
	});
});

describe('loadScopedMediaItemsById', () => {
	it('skips absent and cross-server ids for a server-derived scope', async () => {
		// Collection membership is read moments before the load, so an id that
		// vanished in between is a skip, not a violated boundary.
		const rows = await loadScopedMediaItemsById(database, 'server-a', [2, 9_999, 1, 1_101]);
		expect(rows.map((row) => row.id)).toEqual([2, 1]);
	});

	it('still rejects ids that were never valid at all', async () => {
		await expect(loadScopedMediaItemsById(database, 'server-a', [0])).rejects.toBeInstanceOf(
			MediaItemScopeMismatchError
		);
	});
});
