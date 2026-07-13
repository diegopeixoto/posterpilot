import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import { collectionMemberships, mediaCollections, mediaItems } from '$lib/server/db/schema';
import {
	createCollectionRepository,
	normalizeNativeCollectionSnapshot,
	summarizeCollectionMembershipSources,
	type CollectionRepository
} from './repository';

let client: Client;
let database: LibSQLDatabase<typeof schema>;
let databasePath: string;
let repository: CollectionRepository;
let now: Date;
let nextCollectionId: number;

beforeEach(async () => {
	databasePath = `/tmp/posterpilot-collections-${randomUUID()}.db`;
	client = createClient({ url: `file:${databasePath}` });
	database = drizzle(client, { schema });
	await client.executeMultiple(`
		PRAGMA foreign_keys = ON;
		CREATE TABLE server_instances (
			id text PRIMARY KEY NOT NULL
		);
		CREATE TABLE media_items (
			id integer PRIMARY KEY NOT NULL,
			server_instance_id text NOT NULL REFERENCES server_instances(id),
			rating_key text NOT NULL,
			title text NOT NULL,
			year integer,
			tmdb_id text,
			tmdb_collection_id text,
			tmdb_collection_name text,
			source_removed_at integer,
			updated_at integer NOT NULL
		);
		CREATE TABLE media_collections (
			id text PRIMARY KEY NOT NULL,
			server_instance_id text NOT NULL REFERENCES server_instances(id),
			source text NOT NULL,
			source_id text NOT NULL,
			name text NOT NULL,
			native_provider text,
			current_poster_url text,
			current_background_url text,
			capabilities text,
			metadata text,
			first_seen_at integer NOT NULL,
			last_synced_at integer,
			removed_at integer,
			updated_at integer NOT NULL
		);
		CREATE UNIQUE INDEX media_collections_server_source_unique
			ON media_collections (server_instance_id, source, source_id);
		CREATE TABLE collection_memberships (
			id integer PRIMARY KEY AUTOINCREMENT,
			server_instance_id text NOT NULL REFERENCES server_instances(id),
			collection_id text NOT NULL REFERENCES media_collections(id) ON DELETE CASCADE,
			media_item_id integer REFERENCES media_items(id) ON DELETE SET NULL,
			source text NOT NULL,
			source_member_id text NOT NULL,
			title text,
			year integer,
			available_locally integer DEFAULT 1 NOT NULL,
			provenance text,
			first_seen_at integer NOT NULL,
			last_seen_at integer NOT NULL,
			removed_at integer
		);
		CREATE UNIQUE INDEX collection_memberships_source_member_unique
			ON collection_memberships (server_instance_id, collection_id, source, source_member_id);
		INSERT INTO server_instances (id) VALUES ('server-a'), ('server-b');
		INSERT INTO media_items (
			id, server_instance_id, rating_key, title, year, tmdb_id, updated_at
		) VALUES
			(1, 'server-a', 'native-1', 'First', 2001, '101', 1700000000),
			(2, 'server-a', 'native-2', 'Second', 2002, '102', 1700000000),
			(3, 'server-b', 'native-1', 'First copy', 2001, '101', 1700000000),
			(4, 'server-a', 'ungrouped-4', 'Shared Display Name', 2004, NULL, 1700000000),
			(5, 'server-a', 'native-5', 'First duplicate', 2001, '101', 1700000000);
	`);
	now = new Date('2026-07-11T12:00:00.000Z');
	nextCollectionId = 0;
	repository = createCollectionRepository(database, {
		clock: () => now,
		generateId: () => `collection-${++nextCollectionId}`
	});
});

afterEach(() => {
	client.close();
	for (const suffix of ['', '-shm', '-wal']) rmSync(`${databasePath}${suffix}`, { force: true });
});

function nativeCollection(
	id: string,
	name: string,
	members: Array<{ id: string; title?: string; year?: number }> = []
) {
	return {
		id,
		name,
		members: members.map((member) => ({
			id: member.id,
			title: member.title ?? null,
			year: member.year ?? null
		})),
		currentPosterUrl: null,
		currentBackgroundUrl: null,
		libraryKeys: ['library-1'],
		capabilities: { posterWrite: 'supported' as const, backgroundWrite: 'supported' as const }
	};
}

describe('collection repository source-qualified reconciliation', () => {
	it('keeps equal display names isolated by server and TMDB source id', async () => {
		await repository.reconcileTmdbItemCollection({
			serverInstanceId: 'server-a',
			mediaItemId: 1,
			collection: { id: '900', name: 'Shared Name' }
		});
		await repository.reconcileTmdbItemCollection({
			serverInstanceId: 'server-b',
			mediaItemId: 3,
			collection: { id: '900', name: 'Shared Name' }
		});

		const rows = await database.select().from(mediaCollections);
		expect(rows).toHaveLength(2);
		expect(
			rows
				.map(({ serverInstanceId, source, sourceId, name }) => ({
					serverInstanceId,
					source,
					sourceId,
					name
				}))
				.sort((left, right) => left.serverInstanceId.localeCompare(right.serverInstanceId))
		).toEqual([
			{ serverInstanceId: 'server-a', source: 'tmdb', sourceId: '900', name: 'Shared Name' },
			{ serverInstanceId: 'server-b', source: 'tmdb', sourceId: '900', name: 'Shared Name' }
		]);
	});

	it('rejects an item referenced through the wrong server scope', async () => {
		await expect(
			repository.reconcileTmdbItemCollection({
				serverInstanceId: 'server-a',
				mediaItemId: 3,
				collection: { id: '900', name: 'Shared Name' }
			})
		).rejects.toMatchObject({ code: 'collection_item_scope_mismatch' });
		expect(await database.select().from(mediaCollections)).toEqual([]);
	});

	it('persists TMDB collection identity, local item identity, and provenance', async () => {
		await repository.reconcileTmdbItemCollection({
			serverInstanceId: 'server-a',
			mediaItemId: 1,
			collection: { id: '900', name: 'Saga' }
		});

		const [collection] = await database.select().from(mediaCollections);
		const [membership] = await database.select().from(collectionMemberships);
		const [item] = await database
			.select({
				id: mediaItems.id,
				collectionId: mediaItems.tmdbCollectionId,
				name: mediaItems.tmdbCollectionName
			})
			.from(mediaItems)
			.where(eq(mediaItems.id, 1));
		expect(collection).toMatchObject({
			serverInstanceId: 'server-a',
			source: 'tmdb',
			sourceId: '900',
			name: 'Saga',
			removedAt: null
		});
		expect(membership).toMatchObject({
			serverInstanceId: 'server-a',
			collectionId: collection.id,
			mediaItemId: 1,
			source: 'tmdb',
			availableLocally: true,
			provenance: {
				sources: ['tmdb'],
				tmdbCollectionId: '900',
				tmdbMemberId: '101'
			}
		});
		expect(membership.sourceMemberId).toContain('101');
		expect(item).toEqual({ id: 1, collectionId: '900', name: 'Saga' });
	});

	it('retains two local copies of the same TMDB member as distinct memberships', async () => {
		for (const mediaItemId of [1, 5]) {
			await repository.reconcileTmdbItemCollection({
				serverInstanceId: 'server-a',
				mediaItemId,
				collection: { id: '900', name: 'Saga' }
			});
		}
		const memberships = await database
			.select({
				mediaItemId: collectionMemberships.mediaItemId,
				key: collectionMemberships.sourceMemberId
			})
			.from(collectionMemberships);
		expect(memberships.map((membership) => membership.mediaItemId).sort()).toEqual([1, 5]);
		expect(new Set(memberships.map((membership) => membership.key)).size).toBe(2);
	});

	it('soft-removes the previous TMDB identity even when the collection id is unchanged', async () => {
		await repository.reconcileTmdbItemCollection({
			serverInstanceId: 'server-a',
			mediaItemId: 1,
			collection: { id: '900', name: 'Saga' }
		});
		await database.update(mediaItems).set({ tmdbId: '999' }).where(eq(mediaItems.id, 1));
		now = new Date('2026-07-12T12:00:00.000Z');

		await repository.reconcileTmdbItemCollection({
			serverInstanceId: 'server-a',
			mediaItemId: 1,
			collection: { id: '900', name: 'Saga' }
		});

		const memberships = await database
			.select()
			.from(collectionMemberships)
			.where(eq(collectionMemberships.source, 'tmdb'));
		expect(memberships).toHaveLength(2);
		expect(memberships.filter((row) => row.removedAt === null)).toHaveLength(1);
		expect(memberships.find((row) => row.sourceMemberId.includes('101'))?.removedAt).toEqual(now);
		expect(memberships.find((row) => row.sourceMemberId.includes('999'))).toMatchObject({
			mediaItemId: 1,
			removedAt: null,
			provenance: { tmdbMemberId: '999' }
		});
		expect(await database.select().from(mediaCollections)).toHaveLength(1);
	});

	it('persists native ids and derives both provenance without merging by name', async () => {
		await repository.reconcileTmdbItemCollection({
			serverInstanceId: 'server-a',
			mediaItemId: 1,
			collection: { id: '900', name: 'Shared Name' }
		});
		await repository.reconcileNativeCollections({
			serverInstanceId: 'server-a',
			provider: 'plex',
			collections: [
				nativeCollection('native-collection-77', 'Shared Name', [
					{ id: 'native-1', title: 'First', year: 2001 },
					{ id: 'not-local', title: 'Missing locally', year: 2000 }
				])
			]
		});

		const collections = await database.select().from(mediaCollections);
		expect(collections.map((row) => [row.source, row.sourceId])).toEqual([
			['tmdb', '900'],
			['native', 'native-collection-77']
		]);
		const nativeMemberships = await database
			.select()
			.from(collectionMemberships)
			.where(eq(collectionMemberships.source, 'native'));
		expect(nativeMemberships).toHaveLength(2);
		expect(nativeMemberships[0]).toMatchObject({
			mediaItemId: 1,
			sourceMemberId: 'native-1',
			availableLocally: true,
			provenance: { sources: ['native'], provider: 'plex' }
		});
		expect(nativeMemberships[1]).toMatchObject({
			mediaItemId: null,
			sourceMemberId: 'not-local',
			availableLocally: false
		});
		expect(await repository.getItemMembershipProvenance('server-a', 1)).toBe('both');
	});

	it('never persists native artwork credentials', async () => {
		await repository.reconcileNativeCollections({
			serverInstanceId: 'server-a',
			provider: 'plex',
			collections: [
				{
					...nativeCollection('native-secure', 'Secure Collection'),
					currentPosterUrl: 'https://plex.test/poster?width=300&X-Plex-Token=plex-secret',
					currentBackgroundUrl:
						'https://emby.test/background?api_key=emby-secret&tag=background-tag'
				}
			]
		});

		const [persisted] = await database.select().from(mediaCollections);
		expect(persisted.currentPosterUrl).toBe('https://plex.test/poster?width=300');
		expect(persisted.currentBackgroundUrl).toBe('https://emby.test/background?tag=background-tag');
		expect(JSON.stringify(persisted)).not.toMatch(/plex-secret|emby-secret|x-plex-token|api_key/i);
	});

	it('removes only the disappeared source association and preserves the item/history rows', async () => {
		await repository.reconcileTmdbItemCollection({
			serverInstanceId: 'server-a',
			mediaItemId: 1,
			collection: { id: '900', name: 'Saga' }
		});
		await repository.reconcileNativeCollections({
			serverInstanceId: 'server-a',
			provider: 'plex',
			collections: [nativeCollection('native-77', 'Native Saga', [{ id: 'native-1' }])]
		});

		now = new Date('2026-07-12T12:00:00.000Z');
		await repository.reconcileTmdbItemCollection({
			serverInstanceId: 'server-a',
			mediaItemId: 1,
			collection: null
		});

		expect(await repository.getItemMembershipProvenance('server-a', 1)).toBe('native');
		const [tmdbMembership] = await database
			.select()
			.from(collectionMemberships)
			.where(eq(collectionMemberships.source, 'tmdb'));
		const [nativeMembership] = await database
			.select()
			.from(collectionMemberships)
			.where(eq(collectionMemberships.source, 'native'));
		expect(tmdbMembership.removedAt).toEqual(now);
		expect(nativeMembership.removedAt).toBeNull();
		expect(
			await database.select({ id: mediaItems.id }).from(mediaItems).where(eq(mediaItems.id, 1))
		).toHaveLength(1);
		expect(await database.select().from(collectionMemberships)).toHaveLength(2);

		await repository.reconcileNativeCollections({
			serverInstanceId: 'server-a',
			provider: 'plex',
			collections: [nativeCollection('native-77', 'Native Saga', [])]
		});
		expect(await repository.getItemMembershipProvenance('server-a', 1)).toBe('none');
		expect(
			await database.select({ id: mediaItems.id }).from(mediaItems).where(eq(mediaItems.id, 1))
		).toHaveLength(1);
	});

	it('marks disappeared items unavailable without deleting source or history rows', async () => {
		await repository.reconcileTmdbItemCollection({
			serverInstanceId: 'server-a',
			mediaItemId: 1,
			collection: { id: '900', name: 'Saga' }
		});
		await repository.reconcileNativeCollections({
			serverInstanceId: 'server-a',
			provider: 'plex',
			collections: [nativeCollection('native-77', 'Native Saga', [{ id: 'native-1' }])]
		});
		now = new Date('2026-07-14T12:00:00.000Z');

		const result = await repository.reconcileUnavailableItems({
			serverInstanceId: 'server-a',
			mediaItemIds: [1, 1]
		});

		expect(result).toMatchObject({ collectionsRemoved: 1, membershipsRemoved: 1 });
		const memberships = await database
			.select()
			.from(collectionMemberships)
			.orderBy(collectionMemberships.source);
		const native = memberships.find((row) => row.source === 'native');
		const tmdb = memberships.find((row) => row.source === 'tmdb');
		expect(native).toMatchObject({ mediaItemId: 1, availableLocally: false, removedAt: null });
		expect(tmdb).toMatchObject({ mediaItemId: 1, availableLocally: false, removedAt: now });
		const [item] = await database
			.select({
				id: mediaItems.id,
				tmdbCollectionId: mediaItems.tmdbCollectionId,
				tmdbCollectionName: mediaItems.tmdbCollectionName
			})
			.from(mediaItems)
			.where(eq(mediaItems.id, 1));
		expect(item).toMatchObject({ id: 1, tmdbCollectionId: null, tmdbCollectionName: null });
		expect(await database.select({ id: mediaItems.id }).from(mediaItems)).toHaveLength(5);
		expect(await database.select().from(collectionMemberships)).toHaveLength(2);
	});

	it('leaves an item ungrouped when only a display name resembles a collection', async () => {
		await repository.reconcileTmdbItemCollection({
			serverInstanceId: 'server-a',
			mediaItemId: 4,
			collection: null
		});
		await repository.reconcileNativeCollections({
			serverInstanceId: 'server-a',
			provider: 'emby',
			collections: [
				nativeCollection('native-by-id', 'Shared Display Name', [
					{ id: 'different-native-id', title: 'Shared Display Name' }
				])
			]
		});

		expect(
			await database
				.select()
				.from(collectionMemberships)
				.where(
					and(eq(collectionMemberships.mediaItemId, 4), isNull(collectionMemberships.removedAt))
				)
		).toEqual([]);
		expect(await repository.getItemMembershipProvenance('server-a', 4)).toBe('none');
	});

	it('authoritatively soft-removes a native collection absent from the next snapshot', async () => {
		await repository.reconcileNativeCollections({
			serverInstanceId: 'server-a',
			provider: 'jellyfin',
			collections: [nativeCollection('boxset-1', 'Box', [{ id: 'native-2' }])]
		});
		now = new Date('2026-07-13T12:00:00.000Z');
		const result = await repository.reconcileNativeCollections({
			serverInstanceId: 'server-a',
			provider: 'jellyfin',
			collections: []
		});

		expect(result).toMatchObject({ collectionsRemoved: 1, membershipsRemoved: 1 });
		const [collection] = await database.select().from(mediaCollections);
		const [membership] = await database.select().from(collectionMemberships);
		expect(collection.removedAt).toEqual(now);
		expect(membership.removedAt).toEqual(now);
	});
});

describe('collection observation normalization', () => {
	it('deduplicates only equal source ids and never equal names', () => {
		const normalized = normalizeNativeCollectionSnapshot([
			nativeCollection('id-a', 'Same', [{ id: 'member-a' }]),
			nativeCollection('id-a', 'Renamed', [{ id: 'member-b' }]),
			nativeCollection('id-b', 'Same', [{ id: 'member-c' }])
		]);
		expect(normalized).toHaveLength(2);
		expect(normalized[0]).toMatchObject({ id: 'id-a', name: 'Renamed' });
		expect(normalized[0].members.map((member) => member.id)).toEqual(['member-a', 'member-b']);
		expect(normalized[1]).toMatchObject({ id: 'id-b', name: 'Same' });
	});

	it('summarizes TMDB/native/both explicitly', () => {
		expect(summarizeCollectionMembershipSources([])).toBe('none');
		expect(summarizeCollectionMembershipSources(['tmdb'])).toBe('tmdb');
		expect(summarizeCollectionMembershipSources(['native'])).toBe('native');
		expect(summarizeCollectionMembershipSources(['tmdb', 'native'])).toBe('both');
	});
});
