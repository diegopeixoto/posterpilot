import { createClient, type Client } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import { requireScopedMediaItemsById } from './scoped-item-query';

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
	await client.executeMultiple(`
		create table media_items (
			id integer primary key not null,
			server_instance_id text not null,
			section_key text not null,
			rating_key text not null
		);
		with recursive item_ids(id) as (
			values (1)
			union all select id + 1 from item_ids where id < 517
		)
		insert into media_items (id, server_instance_id, section_key, rating_key)
		select id, 'server-a', 'movies', 'item-' || id from item_ids;
		insert into media_items (id, server_instance_id, section_key, rating_key)
		values (600, 'server-b', 'movies', 'other-server');
	`);
});

afterEach(async () => {
	await client.close();
});

describe('requireScopedMediaItemsById', () => {
	it('queries a large caller scope in bounded batches', async () => {
		const ids = Array.from({ length: 517 }, (_, index) => index + 1);

		const rows = await requireScopedMediaItemsById(database, 'server-a', ids);

		expect(rows.map((row) => row.id).sort((left, right) => left - right)).toEqual(ids);
		expect(queries).toHaveLength(2);
		expect(queries.map((query) => query.params.length)).toEqual([501, 18]);
	});

	it('rejects cross-server and absent ids without widening the scope', async () => {
		await expect(requireScopedMediaItemsById(database, 'server-a', [1, 600])).rejects.toThrow(
			'job_item_scope_mismatch'
		);
		await expect(requireScopedMediaItemsById(database, 'server-a', [999])).rejects.toThrow(
			'job_item_scope_mismatch'
		);
	});

	it('returns an empty scope without issuing a query', async () => {
		await expect(requireScopedMediaItemsById(database, 'server-a', [])).resolves.toEqual([]);
		expect(queries).toEqual([]);
	});
});
