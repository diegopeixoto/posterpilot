import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import { createReviewActionService, parseReviewAction } from './actions';

let client: Client;
let database: LibSQLDatabase<typeof schema>;
let path: string;

beforeEach(async () => {
	path = `/tmp/posterpilot-review-${randomUUID()}.db`;
	client = createClient({ url: `file:${path}` });
	database = drizzle(client, { schema });
	await client.executeMultiple(`
		CREATE TABLE media_items (
			id integer PRIMARY KEY,
			server_instance_id text NOT NULL,
			ignored integer NOT NULL DEFAULT 0,
			external_artwork_changed_at integer,
			last_verified_at integer,
			selected_poster_url text,
			selected_background_url text,
			resolved integer NOT NULL DEFAULT 1,
			reviewed_at integer,
			has_candidates integer NOT NULL DEFAULT 0,
			discovery_status text NOT NULL DEFAULT 'not_started'
		);
		CREATE TABLE child_selections (media_item_id integer, server_instance_id text);
		CREATE TABLE job_item_outcomes (
			job_id integer, media_item_id integer, server_instance_id text, status text
		);
		CREATE TABLE review_events (
			id integer PRIMARY KEY AUTOINCREMENT,
			server_instance_id text NOT NULL,
			media_item_id integer NOT NULL,
			action text NOT NULL,
			from_state text,
			to_state text,
			context text,
			created_at integer NOT NULL
		);
		INSERT INTO media_items (id, server_instance_id) VALUES (1, 'server-a');
	`);
});

afterEach(() => {
	client.close();
	for (const suffix of ['', '-shm', '-wal']) rmSync(`${path}${suffix}`, { force: true });
});

describe('review actions', () => {
	it('records state transitions without erasing prior intent', async () => {
		const perform = createReviewActionService(database, () => new Date('2026-07-10T12:00:00Z'));
		expect(await perform('server-a', 1, 'ignored')).toMatchObject({ state: 'ignored' });
		expect(await perform('server-a', 1, 'unignored')).toMatchObject({ state: 'new' });
		const rows = await client.execute(
			'select action, from_state, to_state from review_events order by id'
		);
		expect(rows.rows).toEqual([
			{ action: 'ignored', from_state: 'new', to_state: 'ignored' },
			{ action: 'unignored', from_state: 'ignored', to_state: 'new' }
		]);
	});

	it('rejects wrong scope and unknown actions', async () => {
		expect(() => parseReviewAction('delete')).toThrowError('invalid_request');
		const perform = createReviewActionService(database);
		await expect(perform('server-b', 1, 'reviewed')).rejects.toMatchObject({
			code: 'item_not_found'
		});
	});
});
