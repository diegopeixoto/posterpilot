import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import { loadNativeCollectionArtworkContext } from './native-artwork-context';

let client: Client;
let database: LibSQLDatabase<typeof schema>;
let path: string;

beforeEach(async () => {
	path = `/tmp/posterpilot-native-collection-context-${randomUUID()}.db`;
	client = createClient({ url: `file:${path}` });
	database = drizzle(client, { schema });
	await client.executeMultiple(`
		CREATE TABLE media_collections (
			id text PRIMARY KEY, server_instance_id text NOT NULL, name text NOT NULL,
			source text NOT NULL, source_id text NOT NULL, native_provider text,
			current_poster_url text, current_background_url text, capabilities text,
			last_synced_at integer, updated_at integer NOT NULL, removed_at integer
		);
		CREATE TABLE collection_memberships (
			id integer PRIMARY KEY, server_instance_id text NOT NULL, collection_id text NOT NULL,
			media_item_id integer, source text NOT NULL, source_member_id text NOT NULL,
			available_locally integer NOT NULL, removed_at integer
		);
		CREATE TABLE media_items (
			id integer PRIMARY KEY, server_instance_id text NOT NULL, tmdb_collection_id text,
			source_removed_at integer
		);
		CREATE TABLE artwork_slot_states (
			id integer PRIMARY KEY, server_instance_id text NOT NULL, media_item_id integer,
			media_collection_id text, kind text NOT NULL, season integer, episode integer,
			artwork_version integer NOT NULL
		);
		INSERT INTO media_collections VALUES (
			'collection-a', 'server-a', 'Saga', 'native', 'native-77', 'plex',
			'https://safe.test/poster', NULL,
			'{"posterWrite":"supported","backgroundWrite":"unsupported"}',
			1700000000, 1700000000, NULL
		);
		INSERT INTO media_items VALUES
			(1, 'server-a', '900', NULL),
			(2, 'server-a', '900', NULL),
			(3, 'server-b', '900', NULL);
		INSERT INTO collection_memberships VALUES
			(1, 'server-a', 'collection-a', 1, 'native', 'one', 1, NULL),
			(2, 'server-a', 'collection-a', 2, 'native', 'two', 1, NULL);
		INSERT INTO artwork_slot_states VALUES
			(1, 'server-a', NULL, 'collection-a', 'poster', NULL, NULL, 3);
	`);
});

afterEach(() => {
	client.close();
	for (const suffix of ['', '-shm', '-wal']) rmSync(`${path}${suffix}`, { force: true });
});

describe('native collection artwork context', () => {
	it('derives an exact TMDB candidate link only from every local member identity', async () => {
		const context = await loadNativeCollectionArtworkContext(database, 'server-a', 'collection-a');
		expect(context).toMatchObject({
			source: 'native',
			sourceId: 'native-77',
			nativeProvider: 'plex',
			linkedTmdbCollectionId: '900',
			localMemberCount: 2,
			capabilities: { posterWrite: 'supported', backgroundWrite: 'unsupported' },
			artworkVersions: { poster: 3, background: 0 }
		});
		expect(context.entityFingerprint).toMatch(/^[a-f0-9]{64}$/);
	});

	it('does not infer a candidate source from mixed or incomplete member identities', async () => {
		await client.execute('UPDATE media_items SET tmdb_collection_id = NULL WHERE id = 2');
		await expect(
			loadNativeCollectionArtworkContext(database, 'server-a', 'collection-a')
		).resolves.toMatchObject({ linkedTmdbCollectionId: null });
	});

	it('never resolves a native entity through another server scope', async () => {
		await expect(
			loadNativeCollectionArtworkContext(database, 'server-b', 'collection-a')
		).rejects.toMatchObject({ code: 'collection_not_found' });
	});
});
