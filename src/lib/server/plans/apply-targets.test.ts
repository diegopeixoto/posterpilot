import { createClient, type Client } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from '$lib/server/db/schema';
import { mediaItems, serverInstances } from '$lib/server/db/schema';
import { resolveScopedApplyTargets } from './apply-targets';

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
		ratingKey: `apply-${index + 1}`,
		sectionKey: 'movies',
		type: 'movie' as const,
		title: `Apply ${index + 1}`
	}));
	for (let offset = 0; offset < items.length; offset += 80) {
		await database.insert(mediaItems).values(items.slice(offset, offset + 80));
	}
	await database.insert(mediaItems).values({
		serverInstanceId: 'server-b',
		ratingKey: 'cross-server',
		sectionKey: 'movies',
		type: 'movie',
		title: 'Cross server'
	});
	queries = [];
});

afterEach(async () => {
	await client.close();
});

describe('resolveScopedApplyTargets', () => {
	it('resolves a large apply scope through bounded queries in request order', async () => {
		const ids = Array.from({ length: 517 }, (_, index) => index + 1).reverse();

		const targets = await resolveScopedApplyTargets(database, ids, 'server-a');

		expect(targets.map((target) => target.mediaItemId)).toEqual(ids);
		expect(queries).toHaveLength(2);
		expect(queries.map((query) => query.params.length)).toEqual([501, 18]);
	});

	it('preserves apply errors for invalid and cross-server scopes', async () => {
		await expect(resolveScopedApplyTargets(database, [1, 1], 'server-a')).rejects.toMatchObject({
			code: 'invalid_request'
		});
		await expect(resolveScopedApplyTargets(database, [1, 518], 'server-a')).rejects.toMatchObject({
			code: 'scope_mismatch'
		});
		await expect(resolveScopedApplyTargets(database, [999], 'server-a')).rejects.toMatchObject({
			code: 'scope_mismatch'
		});
	});
});
