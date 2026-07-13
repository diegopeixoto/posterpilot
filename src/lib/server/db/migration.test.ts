import { createClient, type Client } from '@libsql/client';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const MIGRATIONS = [
	'0000_nostalgic_carmella_unuscione.sql',
	'0001_tidy_big_bertha.sql',
	'0002_thin_maverick.sql',
	'0003_clear_namor.sql',
	'0004_natural_banshee.sql',
	'0005_pretty_overlord.sql',
	'0006_breezy_sinister_six.sql',
	'0007_first_puff_adder.sql',
	'0008_melodic_purifiers.sql'
] as const;

const clients: Client[] = [];

function memoryClient(): Client {
	const client = createClient({ url: ':memory:' });
	clients.push(client);
	return client;
}

async function applyMigration(client: Client, name: (typeof MIGRATIONS)[number]): Promise<void> {
	for (const statement of migrationStatements(name)) await client.execute(statement);
}

function migrationStatements(name: (typeof MIGRATIONS)[number]): string[] {
	const sql = readFileSync(new URL(`../../../../drizzle/${name}`, import.meta.url), 'utf8');
	return sql
		.split('--> statement-breakpoint')
		.map((statement) => statement.trim())
		.filter(Boolean);
}

async function applyThrough(client: Client, lastIndex: number): Promise<void> {
	for (const name of MIGRATIONS.slice(0, lastIndex + 1)) await applyMigration(client, name);
}

afterEach(async () => {
	await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe('0008 multi-server foundation migration', () => {
	it('does not invent a server for an empty fresh database', async () => {
		const client = memoryClient();
		await applyThrough(client, 8);

		const servers = await client.execute('select id from server_instances');
		expect(servers.rows).toHaveLength(0);
		const violations = await client.execute('pragma foreign_key_check');
		expect(violations.rows).toHaveLength(0);
	});

	it('preserves legacy media, candidates, selections, jobs, and application history', async () => {
		const client = memoryClient();
		await applyThrough(client, 7);
		const now = 1_700_000_000;
		await client.execute({
			sql: `insert into media_items
				(id, rating_key, section_key, type, title, year, current_poster_url,
				 has_mediux, resolved, ignored, watched, updated_at)
				values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [
				42,
				'shared-source-id',
				'movies',
				'movie',
				'Legacy title',
				1999,
				'poster',
				1,
				1,
				0,
				0,
				now
			]
		});
		await client.execute({
			sql: `insert into poster_candidates
				(id, media_item_id, set_id, provider, url, kind, created_at)
				values (?, ?, ?, ?, ?, ?, ?)`,
			args: [77, 42, 'set-a', 'mediux', 'https://mediux.pro/a.jpg', 'poster', now]
		});
		await client.execute({
			sql: `insert into child_selections
				(id, media_item_id, kind, season, episode, url, updated_at)
				values (?, ?, ?, ?, ?, ?, ?)`,
			args: [88, 42, 'poster', 1, null, 'https://mediux.pro/s1.jpg', now]
		});
		await client.execute({
			sql: `insert into applied_posters
				(id, media_item_id, url, method, status, applied_at)
				values (?, ?, ?, ?, ?, ?)`,
			args: [99, 42, 'https://mediux.pro/applied.jpg', 'plex', 'success', now]
		});
		await client.execute({
			sql: `insert into jobs
				(id, type, status, processed, total, started_at, finished_at)
				values (?, ?, ?, ?, ?, ?, ?)`,
			args: [7, 'sync', 'completed', 1, 1, now, now]
		});

		await applyMigration(client, MIGRATIONS[8]);

		const server = await client.execute({
			sql: 'select id, protected from server_instances where id = ?',
			args: ['legacy-default']
		});
		expect(server.rows).toEqual([{ id: 'legacy-default', protected: 1 }]);
		const active = await client.execute({
			sql: 'select value from settings where key = ?',
			args: ['activeServerInstanceId']
		});
		expect(active.rows[0]?.value).toBe('legacy-default');

		const media = await client.execute({
			sql: `select id, server_instance_id, rating_key, has_candidates, has_mediux
				from media_items where id = ?`,
			args: [42]
		});
		expect(media.rows).toEqual([
			{
				id: 42,
				server_instance_id: 'legacy-default',
				rating_key: 'shared-source-id',
				has_candidates: 1,
				has_mediux: 1
			}
		]);

		for (const [table, id] of [
			['poster_candidates', 77],
			['child_selections', 88],
			['applied_posters', 99]
		] as const) {
			const row = await client.execute({
				sql: `select id, server_instance_id, media_item_id from ${table} where id = ?`,
				args: [id]
			});
			expect(row.rows).toEqual([{ id, server_instance_id: 'legacy-default', media_item_id: 42 }]);
		}
		const job = await client.execute(
			'select id, server_instance_id, status from jobs where id = 7'
		);
		expect(job.rows).toEqual([
			{ id: 7, server_instance_id: 'legacy-default', status: 'completed' }
		]);
		const violations = await client.execute('pragma foreign_key_check');
		expect(violations.rows).toHaveLength(0);
	});

	it('allows the same source id on different servers but rejects it within one server', async () => {
		const client = memoryClient();
		await applyThrough(client, 8);
		const now = 1_700_000_000;
		for (const id of ['server-a', 'server-b']) {
			await client.execute({
				sql: `insert into server_instances
					(id, name, normalized_name, type, enabled, protected, connection_status, created_at, updated_at)
					values (?, ?, ?, 'plex', 1, 0, 'unknown', ?, ?)`,
				args: [id, id, id, now, now]
			});
		}
		const insert = async (server: string, title: string) =>
			client.execute({
				sql: `insert into media_items
					(server_instance_id, rating_key, section_key, type, title, resolved, ignored,
					 has_candidates, has_mediux, watched, artwork_version, manual_match_pinned,
					 discovery_status, updated_at)
					values (?, 'same-id', 'movies', 'movie', ?, 0, 0, 0, 0, 0, 0, 0, 'not_started', ?)`,
				args: [server, title, now]
			});

		await insert('server-a', 'A');
		await insert('server-b', 'B');
		await expect(insert('server-a', 'Duplicate A')).rejects.toThrow();
		const rows = await client.execute(
			"select server_instance_id from media_items where rating_key = 'same-id' order by server_instance_id"
		);
		expect(rows.rows.map((row) => row.server_instance_id)).toEqual(['server-a', 'server-b']);
	});

	it('rejects mixed-server item and collection relationships on insert and update', async () => {
		const client = memoryClient();
		await applyThrough(client, 8);
		const now = 1_700_000_000;
		for (const id of ['server-a', 'server-b']) {
			await client.execute({
				sql: `insert into server_instances
					(id, name, normalized_name, type, enabled, protected, connection_status, created_at, updated_at)
					values (?, ?, ?, 'plex', 1, 0, 'unknown', ?, ?)`,
				args: [id, id, id, now, now]
			});
		}
		const media = await client.execute({
			sql: `insert into media_items
				(server_instance_id, rating_key, section_key, type, title, resolved, ignored,
				 has_candidates, has_mediux, watched, artwork_version, manual_match_pinned,
				 discovery_status, updated_at)
				values ('server-b', 'item-b', 'movies', 'movie', 'B', 0, 0, 0, 0, 0, 0, 0,
				 'not_started', ?)`,
			args: [now]
		});
		const mediaItemId = Number(media.lastInsertRowid);

		const insertCandidate = (server: string) =>
			client.execute({
				sql: `insert into poster_candidates
					(server_instance_id, media_item_id, set_id, provider, url, kind, created_at)
					values (?, ?, 'set-b', 'mediux', 'https://example.test/poster.jpg', 'poster', ?)`,
				args: [server, mediaItemId, now]
			});
		await expect(insertCandidate('server-a')).rejects.toThrow(
			'scope_mismatch:poster_candidates.media_item_id'
		);
		const validCandidate = await insertCandidate('server-b');
		const validCandidateId = Number(validCandidate.lastInsertRowid);
		await expect(
			client.execute({
				sql: 'update poster_candidates set server_instance_id = ? where id = ?',
				args: ['server-a', validCandidateId]
			})
		).rejects.toThrow('scope_mismatch:poster_candidates.media_item_id');
		await expect(
			client.execute({
				sql: 'update media_items set server_instance_id = ? where id = ?',
				args: ['server-a', mediaItemId]
			})
		).rejects.toThrow('scope_mismatch:media_items.server_instance_id');

		await client.execute({
			sql: `insert into media_collections
				(id, server_instance_id, source, source_id, name, first_seen_at, updated_at)
				values ('collection-a', 'server-a', 'plex', 'collection-a', 'A', ?, ?)`,
			args: [now, now]
		});
		await expect(
			client.execute({
				sql: `insert into collection_memberships
					(server_instance_id, collection_id, media_item_id, source, source_member_id,
					 first_seen_at, last_seen_at)
					values ('server-a', 'collection-a', ?, 'plex', 'item-b', ?, ?)`,
				args: [mediaItemId, now, now]
			})
		).rejects.toThrow('scope_mismatch:collection_memberships.media_item_id');
		await expect(
			client.execute({
				sql: `insert into artwork_slot_states
					(server_instance_id, media_item_id, kind, updated_at)
					values ('server-a', ?, 'poster', ?)`,
				args: [mediaItemId, now]
			})
		).rejects.toThrow('scope_mismatch:artwork_slot_states.media_item_id');

		const triggers = await client.execute(
			"select name from sqlite_master where type = 'trigger' and name glob '*_scope_*' order by name"
		);
		expect(triggers.rows.map((row) => row.name)).toEqual([
			'applied_posters_scope_insert',
			'applied_posters_scope_update',
			'artwork_revisions_scope_insert',
			'artwork_revisions_scope_update',
			'artwork_slot_states_scope_insert',
			'artwork_slot_states_scope_update',
			'artwork_snapshots_scope_insert',
			'artwork_snapshots_scope_update',
			'child_selections_scope_insert',
			'child_selections_scope_update',
			'collection_memberships_scope_insert',
			'collection_memberships_scope_update',
			'events_scope_insert',
			'events_scope_update',
			'job_item_outcomes_scope_insert',
			'job_item_outcomes_scope_update',
			'media_collections_scope_update',
			'media_items_scope_update',
			'poster_candidates_scope_insert',
			'poster_candidates_scope_update',
			'provider_discovery_outcomes_scope_insert',
			'provider_discovery_outcomes_scope_update',
			'provider_discovery_runs_scope_insert',
			'provider_discovery_runs_scope_update',
			'resolution_audits_scope_insert',
			'resolution_audits_scope_update',
			'review_events_scope_insert',
			'review_events_scope_update'
		]);
	});

	it('purges disposable URL payloads and clears credential-bearing current artwork URLs', async () => {
		const client = memoryClient();
		await applyThrough(client, 7);
		const now = 1_700_000_000;
		await client.execute({
			sql: `insert into media_items
				(id, rating_key, section_key, type, title, current_poster_url,
				 has_mediux, resolved, ignored, watched, updated_at)
				values (42, 'unsafe', 'movies', 'movie', 'Unsafe',
				 'https://plex.test/poster?X-Plex-Token=secret', 0, 0, 0, 0, ?)`,
			args: [now]
		});
		await client.execute({
			sql: `insert into media_items
				(id, rating_key, section_key, type, title, current_poster_url,
				 has_mediux, resolved, ignored, watched, updated_at)
				values (43, 'safe', 'movies', 'movie', 'Safe',
				 'https://images.example.test/poster.jpg', 0, 0, 0, 0, ?)`,
			args: [now]
		});
		await client.execute(
			"insert into http_cache (url, body, fetched_at) values ('https://api.test?api_key=secret', '{}', 1)"
		);
		await client.execute(
			"insert into thumbnail_cache (url_hash, url, content_type, size_bytes, fetched_at, accessed_at) values ('hash', 'https://plex.test/thumb?token=secret', 'image/jpeg', 1, 1, 1)"
		);

		const statements = migrationStatements(MIGRATIONS[8]);
		const containmentIndex = statements.findIndex((statement) =>
			statement.includes('DELETE FROM `http_cache`')
		);
		expect(containmentIndex).toBeGreaterThan(0);
		for (const statement of statements.slice(0, containmentIndex)) await client.execute(statement);

		await client.execute({
			sql: `insert into media_collections
				(id, server_instance_id, source, source_id, name, current_poster_url,
				 current_background_url, first_seen_at, updated_at)
				values ('collection-1', 'legacy-default', 'plex', 'collection-1', 'Collection',
				 'https://plex.test/poster?token%3Dsecret',
				 'https://images.example.test/background.jpg', ?, ?)`,
			args: [now, now]
		});
		await client.execute({
			sql: `insert into artwork_slot_states
				(server_instance_id, media_item_id, kind, current_url, updated_at)
				values ('legacy-default', 42, 'poster',
				 'https://user:password@plex.test/poster.jpg', ?)`,
			args: [now]
		});
		await client.execute({
			sql: `insert into operation_plans
				(id, kind, server_instance_id, payload, digest, created_at, expires_at)
				values ('plan-1', 'apply', 'legacy-default', '{"token":"secret"}', 'digest', ?, ?)`,
			args: [now, now + 60]
		});
		await client.execute({
			sql: `insert into jobs (server_instance_id, plan_id, type, created_at, updated_at)
				values ('legacy-default', 'plan-1', 'apply', ?, ?)`,
			args: [now, now]
		});

		for (const statement of statements.slice(containmentIndex)) await client.execute(statement);

		const media = await client.execute(
			'select id, current_poster_url from media_items where id in (42, 43) order by id'
		);
		expect(media.rows).toEqual([
			{ id: 42, current_poster_url: null },
			{ id: 43, current_poster_url: 'https://images.example.test/poster.jpg' }
		]);
		const collection = await client.execute(
			"select current_poster_url, current_background_url from media_collections where id = 'collection-1'"
		);
		expect(collection.rows).toEqual([
			{
				current_poster_url: null,
				current_background_url: 'https://images.example.test/background.jpg'
			}
		]);
		const slot = await client.execute('select current_url from artwork_slot_states');
		expect(slot.rows).toEqual([{ current_url: null }]);
		for (const table of ['http_cache', 'thumbnail_cache', 'operation_plans'] as const) {
			const count = await client.execute(`select count(*) as count from ${table}`);
			expect(count.rows[0]?.count).toBe(0);
		}
		const job = await client.execute("select plan_id from jobs where type = 'apply'");
		expect(job.rows).toEqual([{ plan_id: null }]);
	});
});
