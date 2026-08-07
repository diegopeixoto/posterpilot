import { createClient, type Client } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from '$lib/server/db/schema';
import { mediaItems, serverInstances } from '$lib/server/db/schema';
import { requireScopedDiscoverItemsById } from './discover-scope';

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
	const items = Array.from({ length: 517 }, (_, index) => ({
		serverInstanceId: 'server-a',
		ratingKey: `discover-${index + 1}`,
		sectionKey: 'movies',
		type: 'movie' as const,
		title: `Discover ${index + 1}`
	}));
	for (let offset = 0; offset < items.length; offset += 80) {
		await database.insert(mediaItems).values(items.slice(offset, offset + 80));
	}
	await database.insert(mediaItems).values([
		{
			serverInstanceId: 'server-b',
			ratingKey: 'cross-server',
			sectionKey: 'movies',
			type: 'movie',
			title: 'Cross server'
		},
		{
			serverInstanceId: 'server-a',
			ratingKey: 'removed',
			sectionKey: 'movies',
			type: 'movie',
			title: 'Removed',
			sourceRemovedAt: new Date('2026-08-01T00:00:00.000Z')
		},
		{
			serverInstanceId: 'server-a',
			ratingKey: 'wrong-library',
			sectionKey: 'shows',
			type: 'show',
			title: 'Wrong library'
		}
	]);
	queries = [];
});

afterEach(async () => {
	await client.close();
});

describe('requireScopedDiscoverItemsById', () => {
	it('loads a large retry scope through bounded queries', async () => {
		const ids = Array.from({ length: 517 }, (_, index) => index + 1);

		const items = await requireScopedDiscoverItemsById(database, 'server-a', ids, ['movies']);

		expect(items.map((item) => item.id)).toEqual(ids);
		expect(queries).toHaveLength(2);
		expect(queries.map((query) => query.params.length)).toEqual([501, 18]);
	});

	it('rejects cross-server, removed, and out-of-library retry ids', async () => {
		await expect(
			requireScopedDiscoverItemsById(database, 'server-a', [1, 518], ['movies'])
		).rejects.toThrow('job_item_scope_mismatch');
		await expect(
			requireScopedDiscoverItemsById(database, 'server-a', [519], ['movies'])
		).rejects.toThrow('job_item_scope_mismatch');
		await expect(
			requireScopedDiscoverItemsById(database, 'server-a', [520], ['movies'])
		).rejects.toThrow('job_item_scope_mismatch');
	});
});
