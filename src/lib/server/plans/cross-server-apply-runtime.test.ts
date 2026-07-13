import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('$lib/server/db', async () => {
	const { createClient } = await import('@libsql/client');
	const { drizzle } = await import('drizzle-orm/libsql');
	const schema = await import('$lib/server/db/schema');
	const client = createClient({ url: ':memory:' });
	await client.executeMultiple(`
		CREATE TABLE server_instances (
			id TEXT PRIMARY KEY NOT NULL,
			enabled INTEGER NOT NULL,
			disconnected_at INTEGER
		);
		CREATE TABLE media_items (
			id INTEGER PRIMARY KEY NOT NULL,
			server_instance_id TEXT NOT NULL,
			rating_key TEXT NOT NULL,
			section_key TEXT NOT NULL,
			type TEXT NOT NULL,
			title TEXT NOT NULL,
			tmdb_id TEXT,
			imdb_id TEXT,
			tvdb_id TEXT,
			media_type TEXT,
			selection_updated_at INTEGER,
			source_removed_at INTEGER,
			updated_at INTEGER NOT NULL
		);
	`);
	return { db: drizzle(client, { schema }), migrateDb: async () => undefined };
});

vi.mock('./apply-runtime', () => ({ previewDatabaseArtworkApply: vi.fn() }));
vi.mock('./apply-planner-db', () => ({ loadDatabaseApplyPlannerItemData: vi.fn() }));
vi.mock('./apply-server-registry', () => ({ createDatabaseApplyServerRegistry: vi.fn() }));
vi.mock('./apply-destinations', () => ({ createApplyDestinationResolver: vi.fn() }));

import { db } from '$lib/server/db';
import { databaseCrossServerMatchRepository } from './cross-server-apply-runtime';

describe('database cross-server identity matching', () => {
	beforeEach(async () => {
		await db.run(sql`DELETE FROM media_items`);
		await db.run(sql`DELETE FROM server_instances`);
		await db.run(
			sql`INSERT INTO server_instances (id, enabled, disconnected_at) VALUES
				('server-b', 1, NULL),
				('server-c', 0, NULL)`
		);
		await db.run(
			sql`INSERT INTO media_items
				(id, server_instance_id, rating_key, section_key, type, title, tmdb_id, imdb_id, tvdb_id, media_type, selection_updated_at, source_removed_at, updated_at)
			VALUES
				(2, 'server-b', 'rk-2', 'movies', 'movie', 'Same Title', '999', 'tt999', NULL, 'movie', NULL, NULL, 1),
				(3, 'server-b', 'rk-3', 'shows', 'show', 'Same Title', '777', NULL, '777', 'tv', NULL, NULL, 1),
				(4, 'server-b', 'rk-4', 'movies', 'movie', 'Different Title', '777', 'tt777', NULL, 'movie', NULL, NULL, 1),
				(5, 'server-b', 'rk-5', 'movies', 'movie', 'Removed Match', '777', 'tt777b', NULL, 'movie', NULL, 2, 1)`
		);
	});

	it('queries persisted exact ids and media type, never a same title', async () => {
		const result = await databaseCrossServerMatchRepository.findExactCandidates({
			serverInstanceId: 'server-b',
			match: { namespace: 'tmdb', value: '777' },
			sourceType: 'movie',
			sourceMediaType: 'movie'
		});

		expect(result.serverState).toBe('enabled');
		expect(result.items.map((item) => item.mediaItemId)).toEqual([4]);
		expect(result.items[0]).toMatchObject({
			tmdbId: '777',
			type: 'movie',
			mediaType: 'movie'
		});
	});

	it('returns disabled and missing servers as explicit non-match states', async () => {
		await expect(
			databaseCrossServerMatchRepository.findExactCandidates({
				serverInstanceId: 'server-c',
				match: { namespace: 'imdb', value: 'tt777' },
				sourceType: 'movie',
				sourceMediaType: 'movie'
			})
		).resolves.toEqual({ serverState: 'disabled', items: [] });
		await expect(
			databaseCrossServerMatchRepository.findExactCandidates({
				serverInstanceId: 'missing-server',
				match: { namespace: 'imdb', value: 'tt777' },
				sourceType: 'movie',
				sourceMediaType: 'movie'
			})
		).resolves.toEqual({ serverState: 'missing', items: [] });
	});
});
