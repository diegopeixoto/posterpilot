import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import { createCollectionQueries, type CollectionQueries } from './queries';

let client: Client;
let database: LibSQLDatabase<typeof schema>;
let databasePath: string;
let queries: CollectionQueries;

beforeEach(async () => {
	databasePath = `/tmp/posterpilot-collection-queries-${randomUUID()}.db`;
	client = createClient({ url: `file:${databasePath}` });
	database = drizzle(client, { schema });
	await client.executeMultiple(`
		CREATE TABLE media_collections (
			id text PRIMARY KEY NOT NULL,
			server_instance_id text NOT NULL,
			source text NOT NULL,
			source_id text NOT NULL,
			name text NOT NULL,
			native_provider text,
			first_seen_at integer NOT NULL,
			last_synced_at integer,
			removed_at integer
		);
		CREATE TABLE collection_memberships (
			id integer PRIMARY KEY NOT NULL,
			server_instance_id text NOT NULL,
			collection_id text NOT NULL,
			media_item_id integer,
			source text NOT NULL,
			source_member_id text NOT NULL,
			title text,
			year integer,
			available_locally integer NOT NULL,
			removed_at integer
		);
		CREATE TABLE media_items (
			id integer PRIMARY KEY NOT NULL,
			server_instance_id text NOT NULL,
			section_key text NOT NULL,
			type text NOT NULL,
			title text NOT NULL,
			year integer,
			current_poster_url text,
			current_background_url text,
			selected_poster_url text,
			selected_background_url text,
			selected_poster_candidate_id integer,
			selected_background_candidate_id integer,
			selection_updated_at integer,
			artwork_version integer NOT NULL,
			source_removed_at integer
		);
		CREATE TABLE poster_candidates (
			id integer PRIMARY KEY NOT NULL,
			server_instance_id text NOT NULL,
			media_item_id integer NOT NULL,
			provider text NOT NULL,
			set_id text NOT NULL,
			set_author text,
			design_family text,
			language text
		);
		CREATE TABLE artwork_revisions (
			id text PRIMARY KEY NOT NULL,
			server_instance_id text NOT NULL,
			media_item_id integer,
			action text NOT NULL,
			destination text NOT NULL,
			kind text NOT NULL,
			season integer,
			episode integer,
			source_provider text,
			provenance text,
			outcome text NOT NULL,
			created_at integer NOT NULL
		);

		INSERT INTO media_collections
			(id, server_instance_id, source, source_id, name, native_provider, first_seen_at, last_synced_at, removed_at)
		VALUES
			('collection-a', 'server-a', 'tmdb', '900', 'Shared Saga', NULL, 1700000000, 1700100000, NULL),
			('collection-a-single', 'server-a', 'native', 'native-one', 'Single', 'plex', 1700000000, 1700100000, NULL),
			('collection-b', 'server-b', 'tmdb', '900', 'Shared Saga', NULL, 1700000000, 1700100000, NULL);

		INSERT INTO media_items
			(id, server_instance_id, section_key, type, title, year, current_poster_url, current_background_url,
			 selected_poster_url, selected_background_url, selected_poster_candidate_id,
			 selected_background_candidate_id, selection_updated_at, artwork_version, source_removed_at)
		VALUES
			(1, 'server-a', 'movies', 'movie', 'First', 2001,
			 'https://plex.test/first?X-Plex-Token=current-secret', 'https://plex.test/first-bg?X-Plex-Token=background-secret',
			 NULL, NULL, NULL, NULL, NULL, 4, NULL),
			(2, 'server-a', 'movies', 'movie', 'Second', 2003,
			 NULL, NULL, 'https://api.mediux.pro/poster/staged-secretless', 'https://api.mediux.pro/background/staged-secretless',
			 101, 102, 1700200000, 2, NULL),
			(3, 'server-b', 'movies', 'movie', 'Other server', 2001,
			 'https://other.test/poster', NULL, NULL, NULL, NULL, NULL, NULL, 1, NULL);

		INSERT INTO collection_memberships
			(id, server_instance_id, collection_id, media_item_id, source, source_member_id, title, year, available_locally, removed_at)
		VALUES
			(1, 'server-a', 'collection-a', 1, 'tmdb', '101:local:1', 'First', 2001, 1, NULL),
			(2, 'server-a', 'collection-a', 2, 'tmdb', '102:local:2', 'Second', 2003, 1, NULL),
			(3, 'server-a', 'collection-a', NULL, 'tmdb', '103', 'Missing chapter', 2005, 0, NULL),
			(4, 'server-a', 'collection-a-single', 1, 'native', 'native-1', 'First', 2001, 1, NULL),
			(5, 'server-b', 'collection-b', 3, 'tmdb', '101:local:3', 'Other server', 2001, 1, NULL);

		INSERT INTO poster_candidates
			(id, server_instance_id, media_item_id, provider, set_id, set_author, design_family, language)
		VALUES
			(101, 'server-a', 2, 'mediux', 'set-second', 'Curator', 'minimal-saga', 'en'),
			(102, 'server-a', 2, 'mediux', 'set-second-bg', 'Curator', 'wide-saga', 'en');

		INSERT INTO artwork_revisions
			(id, server_instance_id, media_item_id, action, destination, kind, season, episode,
			 source_provider, provenance, outcome, created_at)
		VALUES
			('rev-poster', 'server-a', 1, 'apply', 'server', 'poster', NULL, NULL, 'mediux',
			 '{"setId":"set-first","setAuthor":"Curator","designFamily":"minimal-saga","language":"en"}', 'success', 1700150000),
			('rev-background', 'server-a', 1, 'apply', 'server', 'background', NULL, NULL, 'mediux',
			 '{"setId":"set-first-bg","setAuthor":"Curator","designFamily":"wide-saga","language":"en"}', 'success', 1700150000);
	`);
	queries = createCollectionQueries(database);
});

afterEach(() => {
	client.close();
	for (const suffix of ['', '-shm', '-wal']) rmSync(`${databasePath}${suffix}`, { force: true });
});

describe('server-scoped collection reads', () => {
	it('lists only active collections with at least two local members in the requested server', async () => {
		const result = await queries.listCollections('server-a');

		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			id: 'collection-a',
			name: 'Shared Saga',
			source: 'tmdb',
			localMemberCount: 2,
			unavailableMemberCount: 1,
			posterArtworkCount: 2,
			backgroundArtworkCount: 2,
			stagedMemberCount: 1
		});
		expect(result[0].previewMembers.map((member) => member.id)).toEqual([1, 2]);
		expect(JSON.stringify(result)).not.toContain('current-secret');
	});

	it('rejects a collection id from another server without revealing its detail', async () => {
		await expect(queries.getCollection('server-b', 'collection-a')).resolves.toBeNull();
		await expect(queries.getCollection('server-a', 'collection-b')).resolves.toBeNull();
	});

	it('returns local and unavailable members while excluding unavailable context from coverage', async () => {
		const detail = await queries.getCollection('server-a', 'collection-a');

		expect(detail).not.toBeNull();
		expect(detail?.localMembers.map((member) => member.title)).toEqual(['First', 'Second']);
		expect(detail?.unavailableMembers).toEqual([
			{
				id: 3,
				title: 'Missing chapter',
				year: 2005,
				source: 'tmdb',
				sourceMemberId: '103'
			}
		]);
		expect(detail?.consistency.poster).toMatchObject({
			status: 'consistent',
			localMembers: 2,
			coveredMembers: 2,
			percentage: 100
		});
		expect(detail?.consistency.background).toMatchObject({
			status: 'consistent',
			localMembers: 2,
			coveredMembers: 2,
			percentage: 100
		});
		expect(detail?.localMembers[1].poster.staged).toMatchObject({
			available: true,
			provenance: { provider: 'mediux', designFamily: 'minimal-saga' }
		});
		const serialized = JSON.stringify(detail);
		expect(serialized).not.toMatch(/current-secret|background-secret|staged-secretless/);
	});
});
