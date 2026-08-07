import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import { createManualMatchService, type ManualMatchRemote } from './manual-match';
import { createManualMatchRepository } from './manual-match-store';

const NOW = new Date('2026-07-10T18:00:00.000Z');

let client: Client;
let database: LibSQLDatabase<typeof schema>;
let databasePath: string;

beforeEach(async () => {
	databasePath = `/tmp/posterpilot-manual-match-${randomUUID()}.db`;
	client = createClient({ url: `file:${databasePath}` });
	database = drizzle(client, { schema });
	await client.executeMultiple(`
		CREATE TABLE media_items (
			id integer PRIMARY KEY,
			server_instance_id text NOT NULL,
			type text NOT NULL,
			title text NOT NULL,
			year integer,
			tmdb_id text,
			imdb_id text,
			tvdb_id text,
			media_type text,
			resolved integer DEFAULT false NOT NULL,
			resolution_reason text,
			manual_match_pinned integer DEFAULT false NOT NULL,
			resolution_updated_at integer,
			selected_poster_url text,
			selected_background_url text,
			selected_poster_candidate_id integer,
			selected_background_candidate_id integer,
			selected_poster_provider text,
			selected_background_provider text,
			selection_updated_at integer,
			selection_revision integer DEFAULT 0 NOT NULL,
			overview text,
			tagline text,
			genres text,
			runtime integer,
			rating real,
			backdrop_url text,
			logo_url text,
			season_count integer,
			episode_count integer,
			cast text,
			tmdb_collection_id text,
			tmdb_collection_name text,
			last_synced_at integer,
			has_candidates integer DEFAULT false NOT NULL,
			has_mediux integer DEFAULT false NOT NULL,
			reviewed_at integer,
			discovery_status text DEFAULT 'not_started' NOT NULL,
			discovery_started_at integer,
			discovery_completed_at integer,
			updated_at integer NOT NULL
		);
		CREATE TABLE poster_candidates (
			id integer PRIMARY KEY,
			server_instance_id text NOT NULL,
			media_item_id integer NOT NULL,
			active integer DEFAULT true NOT NULL,
			stale integer DEFAULT false NOT NULL
		);
		CREATE TABLE child_selections (
			id integer PRIMARY KEY,
			server_instance_id text NOT NULL,
			media_item_id integer NOT NULL
		);
		CREATE TABLE resolution_audits (
			id integer PRIMARY KEY AUTOINCREMENT,
			server_instance_id text NOT NULL,
			media_item_id integer NOT NULL,
			action text NOT NULL,
			previous_tmdb_id text,
			previous_media_type text,
			resulting_tmdb_id text,
			resulting_media_type text,
			reason text NOT NULL,
			source text,
			user_confirmed integer DEFAULT false NOT NULL,
			attempted_sources text,
			details text,
			created_at integer NOT NULL
		);
		CREATE TABLE media_collections (
			id text PRIMARY KEY,
			server_instance_id text NOT NULL,
			source text NOT NULL,
			removed_at integer,
			updated_at integer NOT NULL
		);
		CREATE TABLE collection_memberships (
			id integer PRIMARY KEY,
			server_instance_id text NOT NULL,
			collection_id text NOT NULL,
			media_item_id integer,
			source text NOT NULL,
			removed_at integer
		);
	`);
	await client.execute({
		sql: `INSERT INTO media_items (
			id, server_instance_id, type, title, year, tmdb_id, imdb_id, media_type, resolved,
			resolution_reason, manual_match_pinned, selected_poster_url,
			selected_poster_candidate_id, selected_poster_provider, overview,
			tmdb_collection_id, tmdb_collection_name,
			last_synced_at, has_candidates, has_mediux,
			reviewed_at, discovery_status, updated_at
		) VALUES (1, 'server-a', 'movie', 'Original', 2001, '100', 'tt0000100', 'movie', 1,
			'imdb_id', 0, 'https://old/poster.jpg', 10, 'tmdb', 'old metadata', 'collection-900', 'Old Saga',
			1704067200, 1, 1,
			1704067200, 'succeeded', 1704067200)`,
		args: []
	});
	await client.execute({
		sql: `INSERT INTO poster_candidates (id, server_instance_id, media_item_id, active, stale)
			VALUES (10, 'server-a', 1, 1, 0)`,
		args: []
	});
	await client.execute({
		sql: `INSERT INTO child_selections (id, server_instance_id, media_item_id)
			VALUES (20, 'server-a', 1)`,
		args: []
	});
	await client.execute({
		sql: `INSERT INTO media_collections (
			id, server_instance_id, source, removed_at, updated_at
		) VALUES ('collection-900', 'server-a', 'tmdb', NULL, 1704067200)`,
		args: []
	});
	await client.execute({
		sql: `INSERT INTO collection_memberships (
			id, server_instance_id, collection_id, media_item_id, source, removed_at
		) VALUES (30, 'server-a', 'collection-900', 1, 'tmdb', NULL)`,
		args: []
	});
	await client.execute({
		sql: `INSERT INTO resolution_audits (
			server_instance_id, media_item_id, action, resulting_tmdb_id,
			resulting_media_type, reason, source, user_confirmed, created_at
		) VALUES ('server-a', 1, 'created', '100', 'movie', 'imdb_id', 'imdb_id', 0, 1704067200)`,
		args: []
	});
});

afterEach(() => {
	client.close();
	for (const suffix of ['', '-shm', '-wal']) rmSync(`${databasePath}${suffix}`, { force: true });
});

async function snapshot() {
	const tables = [
		'media_items',
		'poster_candidates',
		'child_selections',
		'resolution_audits',
		'media_collections',
		'collection_memberships'
	];
	const rows: Record<string, unknown> = {};
	for (const table of tables) {
		rows[table] = (await client.execute(`SELECT * FROM ${table} ORDER BY id`)).rows;
	}
	return rows;
}

function verifiedCandidate() {
	return {
		tmdbId: '550',
		mediaType: 'movie' as const,
		title: 'Fight Club',
		originalTitle: 'Fight Club',
		year: 1999,
		overview: null,
		posterUrl: null
	};
}

describe('manual match transactional repository', () => {
	it('leaves every table byte-equivalent when remote candidate validation fails', async () => {
		const repository = createManualMatchRepository(database);
		const remote = {
			search: vi.fn<ManualMatchRemote['search']>(async () => []),
			verify: vi.fn<ManualMatchRemote['verify']>(async () => null),
			resolve: vi.fn<ManualMatchRemote['resolve']>(async () => null)
		};
		const service = createManualMatchService(repository, remote, { clock: () => NOW });
		const before = await snapshot();

		await expect(
			service.confirm('server-a', 1, { tmdbId: '550', mediaType: 'movie' })
		).rejects.toMatchObject({ code: 'tmdb_candidate_unavailable' });

		expect(await snapshot()).toEqual(before);
	});

	it('replaces identity atomically, invalidates old candidates/selections, and appends audit', async () => {
		const repository = createManualMatchRepository(database);
		const pinned = await repository.pin('server-a', 1, verifiedCandidate(), NOW);
		expect(pinned).toMatchObject({
			tmdbId: '550',
			mediaType: 'movie',
			resolved: true,
			manualMatchPinned: true,
			resolutionReason: 'manual'
		});

		const candidate = (await client.execute('SELECT active, stale FROM poster_candidates')).rows[0];
		expect(candidate).toMatchObject({ active: 0, stale: 1 });
		expect((await client.execute('SELECT * FROM child_selections')).rows).toHaveLength(0);
		const media = (await client.execute('SELECT * FROM media_items WHERE id = 1')).rows[0];
		expect(media).toMatchObject({
			tmdb_id: '550',
			manual_match_pinned: 1,
			selected_poster_url: null,
			selected_poster_provider: null,
			selection_revision: 1,
			overview: null,
			tmdb_collection_id: null,
			tmdb_collection_name: null,
			last_synced_at: null,
			has_candidates: 0,
			has_mediux: 0,
			reviewed_at: null,
			discovery_status: 'not_started'
		});
		expect(
			(await client.execute('SELECT removed_at FROM collection_memberships WHERE id = 30')).rows[0]
		).toMatchObject({ removed_at: NOW.getTime() / 1000 });
		expect(
			(await client.execute("SELECT removed_at FROM media_collections WHERE id = 'collection-900'"))
				.rows[0]
		).toMatchObject({ removed_at: NOW.getTime() / 1000 });

		const audits = await repository.listAudits('server-a', 1);
		expect(audits).toHaveLength(2);
		expect(audits[1]).toMatchObject({
			action: 'replaced',
			previousTmdbId: '100',
			resultingTmdbId: '550',
			reason: 'manual',
			userConfirmed: true
		});
	});

	it('clears a pin append-only and never restores the invalidated candidates', async () => {
		const repository = createManualMatchRepository(database);
		await repository.pin('server-a', 1, verifiedCandidate(), NOW);
		const clearedAt = new Date('2026-07-10T18:01:00.000Z');
		const cleared = await repository.clear('server-a', 1, clearedAt);
		expect(cleared).toMatchObject({
			tmdbId: null,
			mediaType: null,
			resolved: false,
			manualMatchPinned: false,
			resolutionReason: 'manual_cleared'
		});
		expect(
			(await client.execute('SELECT active, stale FROM poster_candidates')).rows[0]
		).toMatchObject({
			active: 0,
			stale: 1
		});
		const audits = await repository.listAudits('server-a', 1);
		expect(audits.map((audit) => audit.action)).toEqual(['created', 'replaced', 'cleared']);
		expect(audits[2]).toMatchObject({
			previousTmdbId: '550',
			resultingTmdbId: null,
			userConfirmed: true
		});
	});

	it('never lets an automatic resolution overwrite a pin, including a race after clear', async () => {
		const repository = createManualMatchRepository(database);
		await repository.pin('server-a', 1, verifiedCandidate(), NOW);
		const auditCount = (await repository.listAudits('server-a', 1)).length;
		const result = await repository.applyAutomaticResolution('server-a', 1, {
			resolution: { tmdbId: '999', mediaType: 'tv' },
			reason: 'tvdb_id',
			source: 'tvdb_id',
			attemptedSources: ['tvdb_id'],
			resolvedAt: new Date('2026-07-10T18:02:00.000Z')
		});
		expect(result).toMatchObject({
			tmdbId: '550',
			mediaType: 'movie',
			manualMatchPinned: true,
			resolutionReason: 'manual'
		});
		expect(await repository.listAudits('server-a', 1)).toHaveLength(auditCount);
	});

	it('records automatic resolution reasons and prior identity append-only', async () => {
		const repository = createManualMatchRepository(database);
		await repository.applyAutomaticResolution('server-a', 1, {
			resolution: { tmdbId: '200', mediaType: 'tv' },
			reason: 'tvdb_id',
			source: 'tvdb_id',
			attemptedSources: ['tvdb_id'],
			resolvedAt: NOW
		});
		expect(
			(await client.execute('SELECT reviewed_at FROM media_items WHERE id = 1')).rows[0]
		).toMatchObject({ reviewed_at: null });
		const audits = await repository.listAudits('server-a', 1);
		expect(audits).toHaveLength(2);
		expect(audits[1]).toMatchObject({
			action: 'refreshed',
			previousTmdbId: '100',
			resultingTmdbId: '200',
			resultingMediaType: 'tv',
			reason: 'tvdb_id',
			source: 'tvdb_id',
			userConfirmed: false,
			attemptedSources: ['tvdb_id']
		});
	});

	it('invalidates review and artwork when the numeric id stays equal but its namespace changes', async () => {
		const repository = createManualMatchRepository(database);
		await repository.applyAutomaticResolution('server-a', 1, {
			resolution: { tmdbId: '100', mediaType: 'tv' },
			reason: 'tmdb_type_repair',
			source: 'imdb_id',
			attemptedSources: ['imdb_id'],
			resolvedAt: NOW
		});
		const media = (await client.execute('SELECT * FROM media_items WHERE id = 1')).rows[0];
		expect(media).toMatchObject({
			tmdb_id: '100',
			media_type: 'tv',
			selected_poster_url: null,
			reviewed_at: null,
			discovery_status: 'not_started'
		});
		expect(
			(await client.execute('SELECT active, stale FROM poster_candidates')).rows[0]
		).toMatchObject({ active: 0, stale: 1 });
		expect((await client.execute('SELECT * FROM child_selections')).rows).toHaveLength(0);
		expect((await repository.listAudits('server-a', 1)).at(-1)).toMatchObject({
			previousTmdbId: '100',
			previousMediaType: 'movie',
			resultingTmdbId: '100',
			resultingMediaType: 'tv'
		});
	});

	it('invalidates stray candidates when automatic resolution remains unresolved', async () => {
		const repository = createManualMatchRepository(database);
		await client.execute(
			'UPDATE media_items SET tmdb_id = NULL, media_type = NULL, resolved = 0 WHERE id = 1'
		);
		await repository.applyAutomaticUnresolved('server-a', 1, {
			reason: 'no_match',
			source: 'imdb_id',
			attemptedSources: ['imdb_id'],
			resolvedAt: NOW
		});
		expect(
			(await client.execute('SELECT active, stale FROM poster_candidates')).rows[0]
		).toMatchObject({
			active: 0,
			stale: 1
		});
		expect((await client.execute('SELECT * FROM child_selections')).rows).toHaveLength(0);
	});

	it('enforces server scope without revealing another server item', async () => {
		const repository = createManualMatchRepository(database);
		expect(await repository.getScopedItem('server-b', 1)).toBeNull();
		await expect(repository.pin('server-b', 1, verifiedCandidate(), NOW)).rejects.toMatchObject({
			code: 'media_item_not_found'
		});
		expect((await repository.getScopedItem('server-a', 1))?.tmdbId).toBe('100');
	});
});
