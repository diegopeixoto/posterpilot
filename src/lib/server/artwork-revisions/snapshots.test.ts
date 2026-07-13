import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import { artworkSnapshots } from '$lib/server/db/schema';
import type { ServerArtwork } from '$lib/server/media-server';
import { ArtworkSnapshotStore } from './snapshot-store';
import { createArtworkSnapshotRepository, type ArtworkSnapshotRepository } from './snapshots';

const CAPTURED_AT = new Date('2026-07-11T12:00:00.000Z');
const ROOT_POSTER = {
	serverInstanceId: 'server-a',
	mediaItemId: 1,
	destination: 'server' as const,
	slot: { kind: 'poster' as const, season: null, episode: null }
};

let directory: string;
let client: Client;
let database: LibSQLDatabase<typeof schema>;
let store: ArtworkSnapshotStore;
let repository: ArtworkSnapshotRepository;
let snapshotNumber: number;

function serverArtwork(contents: string, kind: 'poster' | 'background' = 'poster'): ServerArtwork {
	return {
		kind,
		url: `https://media.invalid/${kind}`,
		identity: `etag:${contents}`,
		data: new TextEncoder().encode(contents).buffer,
		contentType: 'image/jpeg'
	};
}

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'posterpilot-snapshot-repository-'));
	client = createClient({ url: `file:${join(directory, 'snapshots.db')}` });
	database = drizzle(client, { schema });
	await client.executeMultiple(`
		PRAGMA foreign_keys = ON;
		CREATE TABLE server_instances (
			id text PRIMARY KEY NOT NULL
		);
		CREATE TABLE media_items (
			id integer PRIMARY KEY NOT NULL,
			server_instance_id text NOT NULL REFERENCES server_instances(id)
		);
		CREATE TABLE media_collections (
			id text PRIMARY KEY NOT NULL,
			server_instance_id text NOT NULL REFERENCES server_instances(id)
		);
		CREATE TABLE artwork_snapshots (
			id text PRIMARY KEY NOT NULL,
			server_instance_id text NOT NULL REFERENCES server_instances(id),
			media_item_id integer REFERENCES media_items(id),
			media_collection_id text REFERENCES media_collections(id),
			destination text NOT NULL,
			kind text NOT NULL,
			season integer,
			episode integer,
			state text NOT NULL,
			sha256 text,
			storage_path text,
			content_type text,
			size_bytes integer,
			value text,
			metadata text,
			is_original integer DEFAULT 0 NOT NULL,
			retained_until integer,
			created_at integer NOT NULL
		);
		CREATE UNIQUE INDEX artwork_snapshots_original_item_root_unique
			ON artwork_snapshots (server_instance_id, media_item_id, destination, kind)
			WHERE is_original = 1 AND media_item_id IS NOT NULL
				AND media_collection_id IS NULL AND season IS NULL AND episode IS NULL;
		CREATE UNIQUE INDEX artwork_snapshots_original_item_season_unique
			ON artwork_snapshots (server_instance_id, media_item_id, destination, kind, season)
			WHERE is_original = 1 AND media_item_id IS NOT NULL
				AND media_collection_id IS NULL AND season IS NOT NULL AND episode IS NULL;
		CREATE UNIQUE INDEX artwork_snapshots_original_item_episode_unique
			ON artwork_snapshots (
				server_instance_id, media_item_id, destination, kind, season, episode
			)
			WHERE is_original = 1 AND media_item_id IS NOT NULL
				AND media_collection_id IS NULL AND episode IS NOT NULL;
		CREATE UNIQUE INDEX artwork_snapshots_original_collection_unique
			ON artwork_snapshots (server_instance_id, media_collection_id, destination, kind)
			WHERE is_original = 1 AND media_item_id IS NULL
				AND media_collection_id IS NOT NULL;
		CREATE TABLE artwork_revisions (
			id text PRIMARY KEY NOT NULL,
			before_snapshot_id text REFERENCES artwork_snapshots(id),
			after_snapshot_id text REFERENCES artwork_snapshots(id)
		);
		INSERT INTO server_instances (id) VALUES ('server-a');
		INSERT INTO media_items (id, server_instance_id) VALUES (1, 'server-a');
		INSERT INTO media_collections (id, server_instance_id) VALUES ('collection-a', 'server-a');
	`);

	snapshotNumber = 0;
	store = new ArtworkSnapshotStore(join(directory, 'artwork-snapshots'));
	repository = createArtworkSnapshotRepository(database, store, {
		clock: () => CAPTURED_AT,
		generateId: () => `snapshot-${++snapshotNumber}`
	});
});

afterEach(async () => {
	client.close();
	await rm(directory, { recursive: true, force: true });
});

describe('ArtworkSnapshotRepository', () => {
	it('captures and retains an original for an exact native collection slot', async () => {
		const scope = {
			serverInstanceId: 'server-a',
			mediaCollectionId: 'collection-a',
			destination: 'server' as const,
			slot: { kind: 'poster' as const, season: null, episode: null }
		};
		const original = await repository.captureServer({
			...scope,
			artwork: serverArtwork('native original'),
			isOriginal: true
		});
		const repeated = await repository.captureServer({
			...scope,
			artwork: serverArtwork('native replacement'),
			isOriginal: true
		});

		expect(repeated.id).toBe(original.id);
		expect(original).toMatchObject({
			mediaItemId: null,
			mediaCollectionId: 'collection-a',
			state: 'present'
		});
		expect(await repository.readBytes(repeated)).toEqual(Buffer.from('native original'));
	});

	it('captures present, absent, and unavailable server artwork states', async () => {
		const present = await repository.captureServer({
			...ROOT_POSTER,
			artwork: serverArtwork('present poster')
		});
		const absent = await repository.captureServer({
			...ROOT_POSTER,
			slot: { kind: 'background', season: null, episode: null },
			artwork: null
		});
		const unavailable = await repository.captureServer({
			...ROOT_POSTER,
			slot: { kind: 'title_card', season: 1, episode: 2 },
			artwork: undefined
		});

		expect(present).toMatchObject({
			state: 'present',
			contentType: 'image/jpeg',
			sizeBytes: Buffer.byteLength('present poster'),
			metadata: { providerIdentity: 'etag:present poster', kind: 'poster' }
		});
		expect(present.sha256).toMatch(/^[a-f0-9]{64}$/);
		expect(present.storagePath).toContain(join('artwork-snapshots', 'blobs'));
		expect(absent).toMatchObject({ state: 'absent', sha256: null, storagePath: null });
		expect(unavailable).toMatchObject({
			state: 'unavailable',
			sha256: null,
			storagePath: null
		});
		expect(await repository.readBytes(present)).toEqual(Buffer.from('present poster'));
		await expect(repository.readBytes(absent)).rejects.toThrow(
			'Snapshot does not contain restorable image bytes'
		);
		await expect(repository.readBytes(unavailable)).rejects.toThrow(
			'Snapshot does not contain restorable image bytes'
		);
	});

	it('captures exact structured Kometa values, including absence and unavailable reads', async () => {
		const present = await repository.captureValue({
			...ROOT_POSTER,
			destination: 'kometa',
			state: 'present',
			value: { poster: 'https://images.invalid/poster.jpg' },
			metadata: { source: 'posterpilot.yml' }
		});
		const absent = await repository.captureValue({
			...ROOT_POSTER,
			destination: 'kometa',
			slot: { kind: 'background', season: null, episode: null },
			state: 'absent'
		});
		const unavailable = await repository.captureValue({
			...ROOT_POSTER,
			destination: 'kometa',
			slot: { kind: 'title_card', season: 1, episode: 3 },
			state: 'unavailable'
		});

		expect(present).toMatchObject({
			state: 'present',
			value: { poster: 'https://images.invalid/poster.jpg' },
			metadata: { source: 'posterpilot.yml' }
		});
		expect(absent).toMatchObject({ state: 'absent', value: null });
		expect(unavailable).toMatchObject({ state: 'unavailable', value: null });
	});

	it('keeps the first original immutable for a slot', async () => {
		const original = await repository.captureServer({
			...ROOT_POSTER,
			artwork: serverArtwork('first original'),
			isOriginal: true
		});
		const attemptedReplacement = await repository.captureServer({
			...ROOT_POSTER,
			artwork: serverArtwork('replacement'),
			isOriginal: true
		});

		expect(attemptedReplacement.id).toBe(original.id);
		expect(attemptedReplacement.sha256).toBe(original.sha256);
		expect(await repository.readBytes(attemptedReplacement)).toEqual(Buffer.from('first original'));
		expect(
			(await database.select().from(artworkSnapshots)).filter((row) => row.isOriginal)
		).toHaveLength(1);
		expect(await repository.deleteIfUnreferenced(original.id)).toBe(false);
	});

	it('converges concurrent original captures on the unique database winner', async () => {
		const scope = {
			...ROOT_POSTER,
			destination: 'kometa' as const,
			slot: { kind: 'background' as const, season: null, episode: null }
		};
		const [first, second] = await Promise.all([
			repository.captureValue({ ...scope, state: 'present', value: 'first', isOriginal: true }),
			repository.captureValue({ ...scope, state: 'present', value: 'second', isOriginal: true })
		]);

		expect(second.id).toBe(first.id);
		expect(second.value).toBe(first.value);
		const originals = (await database.select().from(artworkSnapshots)).filter(
			(row) =>
				row.isOriginal &&
				row.destination === 'kometa' &&
				row.kind === 'background' &&
				row.season === null &&
				row.episode === null
		);
		expect(originals).toHaveLength(1);
		expect(['first', 'second']).toContain(originals[0]?.value);
	});

	it('deduplicates equal server bytes while retaining independently restorable snapshots', async () => {
		const first = await repository.captureServer({
			...ROOT_POSTER,
			artwork: serverArtwork('shared bytes')
		});
		const second = await repository.captureServer({
			...ROOT_POSTER,
			artwork: serverArtwork('shared bytes')
		});

		expect(first.id).not.toBe(second.id);
		expect(first.sha256).toBe(second.sha256);
		expect(first.storagePath).toBe(second.storagePath);
		expect((await store.get(second.id, second.sha256!)).referenceCount).toBe(2);
		expect(await repository.readBytes(first)).toEqual(Buffer.from('shared bytes'));
		expect(await repository.readBytes(second)).toEqual(Buffer.from('shared bytes'));
	});

	it('protects before and after snapshots from cleanup while a revision references them', async () => {
		const before = await repository.captureServer({
			...ROOT_POSTER,
			artwork: serverArtwork('revision bytes')
		});
		const after = await repository.captureServer({
			...ROOT_POSTER,
			artwork: serverArtwork('revision bytes')
		});
		await client.execute({
			sql: `INSERT INTO artwork_revisions (id, before_snapshot_id, after_snapshot_id)
				VALUES (?, ?, ?)`,
			args: ['revision-1', before.id, after.id]
		});

		expect(await repository.deleteIfUnreferenced(before.id)).toBe(false);
		expect(await repository.deleteIfUnreferenced(after.id)).toBe(false);
		expect(await repository.get(before.id)).not.toBeNull();
		expect(await repository.get(after.id)).not.toBeNull();

		await client.execute({
			sql: 'DELETE FROM artwork_revisions WHERE id = ?',
			args: ['revision-1']
		});
		expect(await repository.deleteIfUnreferenced(before.id)).toBe(true);
		expect(await repository.deleteIfUnreferenced(after.id)).toBe(true);
		expect(await repository.get(before.id)).toBeNull();
		expect(await repository.get(after.id)).toBeNull();

		const cleanup = await store.cleanup({
			minimumAgeMs: 0,
			now: new Date(Date.now() + 60_000)
		});
		expect(cleanup.deleted).toContain(before.sha256);
	});
});
