import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as schema from '$lib/server/db/schema';
import { mediaItems } from '$lib/server/db/schema';
import { pendingTmdbTypeMismatchCondition } from '$lib/server/tmdb/repair-predicate';

const MIGRATIONS = [
	'0000_nostalgic_carmella_unuscione.sql',
	'0001_tidy_big_bertha.sql',
	'0002_thin_maverick.sql',
	'0003_clear_namor.sql',
	'0004_natural_banshee.sql',
	'0005_pretty_overlord.sql',
	'0006_breezy_sinister_six.sql',
	'0007_first_puff_adder.sql',
	'0008_melodic_purifiers.sql',
	'0009_silent_zaran.sql',
	'0010_canonical_artwork_assets.sql',
	'0011_provider_discovery_truncation.sql',
	'0012_artwork_coverage_projection.sql'
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

describe('0009 TMDB repair query index migration', () => {
	it('adds a sparse server-scoped index used by the durable mismatch count', async () => {
		const client = memoryClient();
		await applyThrough(client, 9);

		const columns = await client.execute("pragma index_info('media_items_tmdb_repair_idx')");
		expect(columns.rows.map((row) => row.name)).toEqual(['server_instance_id']);

		const indexes = await client.execute("pragma index_list('media_items')");
		expect(indexes.rows.find((row) => row.name === 'media_items_tmdb_repair_idx')).toMatchObject({
			partial: 1
		});

		const database = drizzle(client, { schema });
		const countQuery = database
			.select({ count: sql<number>`count(*)` })
			.from(mediaItems)
			.where(pendingTmdbTypeMismatchCondition('server-a'))
			.toSQL();
		expect(countQuery.params).toEqual(['server-a']);

		const plan = await client.execute({
			sql: `explain query plan ${countQuery.sql}`,
			args: countQuery.params as string[]
		});
		expect(plan.rows.map((row) => String(row.detail)).join('\n')).toContain(
			'USING INDEX media_items_tmdb_repair_idx (server_instance_id=?)'
		);
	});
});

describe('0010 canonical artwork assets migration', () => {
	it('adds preview metadata and conservatively backfills staged provenance', async () => {
		const client = memoryClient();
		await applyThrough(client, 9);
		const now = 1_700_000_000;
		await client.execute({
			sql: `insert into server_instances
				(id, name, normalized_name, type, enabled, protected, connection_status, created_at, updated_at)
				values ('server-a', 'Server A', 'server a', 'plex', 1, 0, 'unknown', ?, ?)`,
			args: [now, now]
		});
		await client.execute({
			sql: `insert into media_items
				(id, server_instance_id, rating_key, section_key, type, title, resolved, ignored,
				 has_candidates, has_mediux, watched, artwork_version, manual_match_pinned,
				 discovery_status, selected_poster_url, selected_background_url,
				 selected_poster_candidate_id, selected_background_candidate_id, updated_at)
				values
				 (41, 'server-a', 'movie-a', 'movies', 'movie', 'Movie A', 1, 0, 1, 0, 0, 0, 0,
				  'succeeded', ?, 'https://custom.example/background.jpg', 71, 999, ?),
				 (42, 'server-a', 'movie-b', 'movies', 'movie', 'Movie B', 1, 0, 1, 0, 0, 0, 0,
				  'succeeded', 'https://shared.example/poster.jpg', null, null, null, ?),
				 (43, 'server-a', 'movie-c', 'movies', 'movie', 'Movie C', 1, 0, 1, 0, 0, 0, 0,
				  'succeeded', 'https://images.example/fallback.jpg', null, 999, null, ?)`,
			args: ['https://image.tmdb.org/t/p/w500/legacy-root.jpg', now, now, now]
		});
		await client.execute(`insert into poster_candidates
			(id, server_instance_id, media_item_id, set_id, provider, url, kind, season, episode, created_at)
			values
			 (71, 'server-a', 41, 'tmdb-root', 'tmdb',
			  'https://image.tmdb.org/t/p/original/legacy-root.jpg', 'poster', null, null, ${now}),
			 (72, 'server-a', 41, 'tmdb-season', 'tmdb',
			  'https://image.tmdb.org/t/p/original/legacy-season.jpg', 'season', 1, null, ${now}),
			 (73, 'server-a', 42, 'shared-a', 'mediux',
			  'https://shared.example/poster.jpg', 'poster', null, null, ${now}),
			 (74, 'server-a', 42, 'shared-b', 'fanarttv',
			  'https://shared.example/poster.jpg', 'poster', null, null, ${now}),
			 (75, 'server-a', 43, 'fallback-root', 'mediux',
			  'https://images.example/fallback.jpg', 'poster', null, null, ${now}),
			 (76, 'server-a', 41, 'fallback-child', 'mediux',
			  'https://images.example/season-background.jpg', 'background', 1, null, ${now})`);
		await client.execute(`insert into child_selections
			(id, server_instance_id, media_item_id, kind, season, episode, url, candidate_id,
			 provider, set_id, updated_at)
			values
			 (81, 'server-a', 41, 'poster', 1, null,
			  'https://image.tmdb.org/t/p/w500/legacy-season.jpg', 72, null, null, ${now}),
			 (82, 'server-a', 41, 'background', 1, null,
			  'https://images.example/season-background.jpg', 73, null, 'stale-set', ${now})`);

		await applyMigration(client, MIGRATIONS[10]);

		const candidates = await client.execute(
			`select id, preview_url, language_provenance from poster_candidates order by id`
		);
		expect(candidates.rows).toEqual(
			expect.arrayContaining([
				{ id: 71, preview_url: null, language_provenance: 'unknown' },
				{ id: 72, preview_url: null, language_provenance: 'unknown' }
			])
		);
		const items = await client.execute(`select id, selected_poster_candidate_id,
			selected_poster_provider, selected_background_candidate_id,
			selected_background_provider, selection_revision
			from media_items where id in (41, 42, 43) order by id`);
		expect(items.rows).toEqual([
			{
				id: 41,
				selected_poster_candidate_id: 71,
				selected_poster_provider: 'tmdb',
				selected_background_candidate_id: null,
				selected_background_provider: 'custom',
				selection_revision: 0
			},
			{
				id: 42,
				selected_poster_candidate_id: null,
				selected_poster_provider: 'custom',
				selected_background_candidate_id: null,
				selected_background_provider: null,
				selection_revision: 0
			},
			{
				id: 43,
				selected_poster_candidate_id: null,
				selected_poster_provider: 'mediux',
				selected_background_candidate_id: null,
				selected_background_provider: null,
				selection_revision: 0
			}
		]);
		const child = await client.execute(
			`select id, candidate_id, provider, set_id from child_selections where id in (81, 82) order by id`
		);
		expect(child.rows).toEqual([
			{ id: 81, candidate_id: 72, provider: 'tmdb', set_id: 'tmdb-season' },
			{ id: 82, candidate_id: null, provider: 'mediux', set_id: null }
		]);
		const violations = await client.execute('pragma foreign_key_check');
		expect(violations.rows).toHaveLength(0);
	});
});

describe('0011 provider discovery truncation migration', () => {
	it('reads outcomes recorded before the guard existed as "nothing was truncated"', async () => {
		const client = memoryClient();
		await applyThrough(client, 10);
		const now = 1_700_000_000;
		await client.execute({
			sql: `insert into server_instances
				(id, name, normalized_name, type, enabled, protected, connection_status, created_at, updated_at)
				values ('server-a', 'Server A', 'server a', 'plex', 1, 0, 'unknown', ?, ?)`,
			args: [now, now]
		});
		await client.execute({
			sql: `insert into media_items
				(id, server_instance_id, rating_key, section_key, type, title, resolved, ignored,
				 has_candidates, has_mediux, watched, artwork_version, manual_match_pinned,
				 discovery_status, updated_at)
				values (51, 'server-a', 'movie-a', 'movies', 'movie', 'Movie A', 1, 0, 1, 0, 0, 0, 0,
				 'succeeded', ?)`,
			args: [now]
		});
		await client.execute({
			sql: `insert into provider_discovery_runs
				(id, server_instance_id, media_item_id, status, started_at, completed_at)
				values ('run-a', 'server-a', 51, 'succeeded', ?, ?)`,
			args: [now, now]
		});
		await client.execute({
			sql: `insert into provider_discovery_outcomes
				(id, run_id, server_instance_id, media_item_id, provider, status, candidate_count,
				 started_at, completed_at)
				values (61, 'run-a', 'server-a', 51, 'tmdb', 'succeeded', 20, ?, ?)`,
			args: [now, now]
		});

		await applyMigration(client, MIGRATIONS[11]);

		// A legacy row predates the signal entirely; backfilling '[]' says "nothing was
		// dropped", which is the only reading that does not invent a truncated pane.
		const outcomes = await client.execute(
			'select id, truncated_kinds from provider_discovery_outcomes order by id'
		);
		expect(outcomes.rows).toEqual([{ id: 61, truncated_kinds: '[]' }]);

		// New rows carry the kinds; the column is NOT NULL, so nothing can write "unknown".
		await client.execute({
			sql: `insert into provider_discovery_outcomes
				(id, run_id, server_instance_id, media_item_id, provider, status, candidate_count,
				 truncated_kinds, started_at, completed_at)
				values (62, 'run-a', 'server-a', 51, 'fanarttv', 'succeeded', 200, '["poster"]', ?, ?)`,
			args: [now, now]
		});
		const truncated = await client.execute(
			'select truncated_kinds from provider_discovery_outcomes where id = 62'
		);
		expect(truncated.rows[0]?.truncated_kinds).toBe('["poster"]');
		await expect(
			client.execute('update provider_discovery_outcomes set truncated_kinds = null where id = 61')
		).rejects.toThrow();
	});
});

describe('0012 artwork coverage projection migration', () => {
	const now = 1_700_000_000;

	/** A server, a resolved movie, a legacy application record, and one immutable revision. */
	async function seedLegacyEvidence(client: Client): Promise<void> {
		await client.execute({
			sql: `insert into server_instances
				(id, name, normalized_name, type, enabled, protected, connection_status, created_at, updated_at)
				values ('server-a', 'Server A', 'server a', 'plex', 1, 0, 'unknown', ?, ?),
				       ('server-b', 'Server B', 'server b', 'jellyfin', 1, 0, 'unknown', ?, ?)`,
			args: [now, now, now, now]
		});
		await client.execute({
			sql: `insert into media_items
				(id, server_instance_id, rating_key, section_key, type, title, media_type, tmdb_id,
				 resolved, ignored, has_candidates, has_mediux, watched, artwork_version,
				 manual_match_pinned, discovery_status, updated_at)
				values
				 (91, 'server-a', 'movie-a', 'movies', 'movie', 'Movie A', 'movie', '105', 1, 0, 1, 0, 0,
				  0, 0, 'succeeded', ?),
				 (92, 'server-a', 'movie-b', 'movies', 'movie', 'Movie B', 'movie', '106', 1, 0, 1, 0, 0,
				  0, 0, 'succeeded', ?)`,
			args: [now, now]
		});
		// A pre-projection application record whose destination was never typed.
		await client.execute({
			sql: `insert into applied_posters
				(id, server_instance_id, media_item_id, url, method, status, applied_at)
				values (95, 'server-a', 91, 'https://images.example.test/a.jpg', 'both', 'success', ?)`,
			args: [now]
		});
		await client.execute({
			sql: `insert into artwork_revision_groups
				(id, server_instance_id, kind, initiator, outcome, created_at)
				values ('group-1', 'server-a', 'apply', 'user', 'success', ?)`,
			args: [now]
		});
		await client.execute({
			sql: `insert into artwork_revisions
				(id, group_id, server_instance_id, media_item_id, action, destination, kind, outcome,
				 verification, created_at)
				values ('revision-1', 'group-1', 'server-a', 91, 'apply', 'server', 'poster', 'success',
				 'exact', ?)`,
			args: [now]
		});
	}

	async function insertCoverage(
		client: Client,
		overrides: Partial<Record<string, unknown>> = {}
	): Promise<void> {
		const row = {
			server_instance_id: 'server-a',
			media_item_id: 91,
			library_section_key: 'movies',
			canonical_key: 'movie:105',
			destination: 'server',
			kind: 'poster',
			season: null,
			episode: null,
			status: 'applied_on_server',
			evidence_source: 'revision',
			evidence_revision_id: 'revision-1',
			evidence_fingerprint: 'sha256:a',
			observed_at: now,
			updated_at: now,
			...overrides
		};
		const columns = Object.keys(row);
		await client.execute({
			sql: `insert into artwork_coverage (${columns.join(', ')})
				values (${columns.map(() => '?').join(', ')})`,
			args: columns.map((column) => row[column] as never)
		});
	}

	it('adds an empty projection beside legacy history instead of guessing coverage from it', async () => {
		const client = memoryClient();
		await applyThrough(client, 11);
		await seedLegacyEvidence(client);

		await applyMigration(client, MIGRATIONS[12]);

		// Nothing is backfilled in SQL, and that is the point. A legacy `applied_posters` row
		// with method 'both' cannot say which destination it reached, and no statement can know
		// whether the artwork a server serves today still matches — that needs a live read.
		// Coverage arrives only from a rebuild, where an unprovable entry becomes `unknown`
		// rather than a fabricated `applied_on_server`.
		const coverage = await client.execute('select count(*) as count from artwork_coverage');
		expect(coverage.rows[0]?.count).toBe(0);
		const legacy = await client.execute('select id, method, status from applied_posters');
		expect(legacy.rows).toEqual([{ id: 95, method: 'both', status: 'success' }]);
		const revisions = await client.execute('select id, destination from artwork_revisions');
		expect(revisions.rows).toEqual([{ id: 'revision-1', destination: 'server' }]);
		const violations = await client.execute('pragma foreign_key_check');
		expect(violations.rows).toHaveLength(0);
	});

	it('refuses every destination/status pairing the shared contract forbids', async () => {
		const client = memoryClient();
		await applyThrough(client, 12);
		await seedLegacyEvidence(client);

		for (const [destination, status] of [
			['server', 'exported_to_kometa'],
			['kometa', 'applied_on_server'],
			['kometa', 'recorded_unverified'],
			['kometa', 'externally_changed']
		] as const) {
			await expect(
				insertCoverage(client, { destination, status, evidence_revision_id: null })
			).rejects.toThrow(/CHECK constraint failed/);
		}

		// The valid pairings still go in, each on its own slot.
		await insertCoverage(client);
		await insertCoverage(client, {
			destination: 'kometa',
			status: 'exported_to_kometa',
			evidence_source: 'kometa_file',
			evidence_revision_id: null
		});
		const rows = await client.execute(
			'select destination, status from artwork_coverage order by destination'
		);
		expect(rows.rows).toEqual([
			{ destination: 'kometa', status: 'exported_to_kometa' },
			{ destination: 'server', status: 'applied_on_server' }
		]);
	});

	it('holds exactly one row per occurrence, destination, and slot', async () => {
		const client = memoryClient();
		await applyThrough(client, 12);
		await seedLegacyEvidence(client);

		await insertCoverage(client);
		await expect(insertCoverage(client, { status: 'missing' })).rejects.toThrow(/UNIQUE/);

		// Neither the other destination, the other artwork kind, nor a child slot is blocked by
		// the root row: coverage of one never stands in for another.
		await insertCoverage(client, {
			destination: 'kometa',
			status: 'exported_to_kometa',
			evidence_source: 'kometa_file',
			evidence_revision_id: null
		});
		await insertCoverage(client, { kind: 'background' });
		await insertCoverage(client, { season: 1 });
		await insertCoverage(client, { season: 1, episode: 2, kind: 'title_card' });
		await expect(insertCoverage(client, { season: 1, status: 'missing' })).rejects.toThrow(
			/UNIQUE/
		);
		await expect(
			insertCoverage(client, { season: 1, episode: 2, kind: 'title_card', status: 'missing' })
		).rejects.toThrow(/UNIQUE/);

		const count = await client.execute('select count(*) as count from artwork_coverage');
		expect(count.rows[0]?.count).toBe(5);
	});

	it('keeps a row inside the server that owns its occurrence', async () => {
		const client = memoryClient();
		await applyThrough(client, 12);
		await seedLegacyEvidence(client);

		await expect(
			insertCoverage(client, { server_instance_id: 'server-b', evidence_revision_id: null })
		).rejects.toThrow('scope_mismatch:artwork_coverage.media_item_id');
		await insertCoverage(client);
		await expect(
			client.execute(
				"update artwork_coverage set server_instance_id = 'server-b' where media_item_id = 91"
			)
		).rejects.toThrow('scope_mismatch:artwork_coverage.media_item_id');
	});

	it('drops with its occurrence and survives the loss of the revision it cites', async () => {
		const client = memoryClient();
		await applyThrough(client, 12);
		await seedLegacyEvidence(client);
		await client.execute('pragma foreign_keys = on');
		await insertCoverage(client);
		await insertCoverage(client, { media_item_id: 92, canonical_key: 'movie:106' });

		// The projection is a cache of the revision, not its owner: losing the citation costs
		// the row its link, not the observation.
		await client.execute("delete from artwork_revisions where id = 'revision-1'");
		const orphaned = await client.execute(
			'select media_item_id, evidence_revision_id, evidence_fingerprint, status from artwork_coverage where media_item_id = 91'
		);
		expect(orphaned.rows).toEqual([
			{
				media_item_id: 91,
				evidence_revision_id: null,
				evidence_fingerprint: 'sha256:a',
				status: 'applied_on_server'
			}
		]);

		await client.execute('delete from media_items where id = 92');
		const remaining = await client.execute(
			'select media_item_id from artwork_coverage order by media_item_id'
		);
		expect(remaining.rows).toEqual([{ media_item_id: 91 }]);
	});

	it('serves the library rollup and the needs-artwork anti-join from its indexes', async () => {
		const client = memoryClient();
		await applyThrough(client, 12);
		await seedLegacyEvidence(client);
		await insertCoverage(client);

		const rollup = await client.execute({
			sql: `explain query plan
				select status, count(*) as count from artwork_coverage
				where server_instance_id = ? and library_section_key = ? and destination = ?
				group by status`,
			args: ['server-a', 'movies', 'server']
		});
		expect(rollup.rows.map((row) => String(row.detail)).join('\n')).toContain(
			'COVERING INDEX artwork_coverage_library_status_idx'
		);

		const uncovered = await client.execute({
			sql: `explain query plan
				select item.id from media_items as item
				where item.server_instance_id = ? and item.section_key = ?
					and not exists (
						select 1 from artwork_coverage as coverage
						where coverage.server_instance_id = item.server_instance_id
							and coverage.media_item_id = item.id
							and coverage.destination = 'server'
							and coverage.kind = 'poster'
							and coverage.season is null
							and coverage.episode is null
							and coverage.status = 'applied_on_server'
					)`,
			args: ['server-a', 'movies']
		});
		// The partial root-slot index is the one that matters here: the anti-join carries the
		// `season is null and episode is null` predicate the index was made partial for.
		expect(uncovered.rows.map((row) => String(row.detail)).join('\n')).toContain(
			'artwork_coverage_root_slot_unique'
		);

		const identity = await client.execute({
			sql: `explain query plan
				select server_instance_id, media_item_id from artwork_coverage
				where canonical_key = ? and destination = ? and kind = ?`,
			args: ['movie:105', 'server', 'poster']
		});
		expect(identity.rows.map((row) => String(row.detail)).join('\n')).toContain(
			'artwork_coverage_canonical_idx'
		);
	});
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
