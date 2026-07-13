import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import { createReviewViewStore, normalizeReviewViewDefinition } from './views';

let client: Client;
let database: LibSQLDatabase<typeof schema>;
let path: string;

beforeEach(async () => {
	path = `/tmp/posterpilot-review-views-${randomUUID()}.db`;
	client = createClient({ url: `file:${path}` });
	database = drizzle(client, { schema });
	await client.executeMultiple(`
		CREATE TABLE review_views (
			id text PRIMARY KEY,
			server_instance_id text NOT NULL,
			name text NOT NULL,
			normalized_name text NOT NULL,
			library_section_key text,
			filters text NOT NULL,
			sort text NOT NULL,
			created_at integer NOT NULL,
			updated_at integer NOT NULL
		);
		CREATE UNIQUE INDEX review_views_server_name_unique
			ON review_views(server_instance_id, normalized_name);
	`);
});

afterEach(() => {
	client.close();
	for (const suffix of ['', '-shm', '-wal']) rmSync(`${path}${suffix}`, { force: true });
});

describe('saved review views', () => {
	it('normalizes and validates only supported filters and deterministic sorts', () => {
		expect(
			normalizeReviewViewDefinition({
				name: '  Needs   work ',
				filters: { state: 'unresolved', q: ' Matrix ' },
				sort: { by: 'title' }
			})
		).toMatchObject({
			name: 'Needs work',
			normalizedName: 'needs work',
			filters: { state: 'unresolved', q: 'Matrix' },
			sort: { by: 'title' }
		});
		expect(() =>
			normalizeReviewViewDefinition({ name: 'Bad', filters: { state: 'secret' }, sort: {} })
		).toThrowError('invalid_request');
	});

	it('creates, updates, lists, scopes, and deletes named views', async () => {
		let id = 0;
		const store = createReviewViewStore(database, { generateId: () => `view-${++id}` });
		const created = await store.create('server-a', {
			name: 'Unresolved',
			filters: { state: 'unresolved' },
			sort: { by: 'priority' }
		});
		expect((await store.list('server-a')).map((view) => view.id)).toEqual(['view-1']);
		await expect(store.get('server-b', created.id)).rejects.toMatchObject({
			code: 'view_not_found'
		});
		const updated = await store.update('server-a', created.id, {
			name: 'Ready',
			filters: { state: 'suggestion_ready' },
			sort: { by: 'updated' }
		});
		expect(updated).toMatchObject({ name: 'Ready', filters: { state: 'suggestion_ready' } });
		await store.remove('server-a', created.id);
		expect(await store.list('server-a')).toEqual([]);
	});
});
