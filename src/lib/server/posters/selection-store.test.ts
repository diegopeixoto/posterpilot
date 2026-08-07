import { createClient, type Client } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import * as schema from '$lib/server/db/schema';
import { childSelections, mediaItems } from '$lib/server/db/schema';
import {
	ArtworkSelectionStoreError,
	createArtworkSelectionStore,
	type ArtworkSelectionStore
} from './selection-store';

const NOW = new Date('2026-08-07T12:00:00.000Z');

let client: Client;
let database: LibSQLDatabase<typeof schema>;
let store: ArtworkSelectionStore;
let databasePath: string;

beforeEach(async () => {
	databasePath = `/tmp/posterpilot-selection-store-${randomUUID()}.db`;
	client = createClient({ url: `file:${databasePath}` });
	database = drizzle(client, { schema });
	await client.executeMultiple(`
		CREATE TABLE media_items (
			id integer PRIMARY KEY NOT NULL,
			server_instance_id text NOT NULL,
			selected_poster_url text,
			selected_background_url text,
			selected_poster_candidate_id integer,
			selected_background_candidate_id integer,
			selected_poster_provider text,
			selected_background_provider text,
			selection_updated_at integer,
			selection_revision integer DEFAULT 0 NOT NULL,
			updated_at integer NOT NULL
		);
		CREATE TABLE poster_candidates (
			id integer PRIMARY KEY NOT NULL,
			server_instance_id text NOT NULL,
			media_item_id integer NOT NULL,
			provider text NOT NULL,
			set_id text NOT NULL,
			url text NOT NULL,
			kind text NOT NULL,
			season integer,
			episode integer,
			active integer DEFAULT 1 NOT NULL
		);
		CREATE TABLE child_selections (
			id integer PRIMARY KEY AUTOINCREMENT,
			server_instance_id text NOT NULL,
			media_item_id integer NOT NULL,
			kind text NOT NULL,
			season integer NOT NULL,
			episode integer,
			url text NOT NULL,
			candidate_id integer,
			provider text,
			set_id text,
			updated_at integer NOT NULL
		);
		INSERT INTO media_items (id, server_instance_id, selection_revision, updated_at) VALUES
			(1, 'server-a', 0, 1),
			(2, 'server-a', 0, 1),
			(3, 'server-b', 0, 1);
		INSERT INTO poster_candidates
			(id, server_instance_id, media_item_id, provider, set_id, url, kind, season, episode, active)
		VALUES
			(10, 'server-a', 1, 'tmdb', 'tmdb-root',
			 'https://image.tmdb.org/t/p/original/root.jpg', 'poster', NULL, NULL, 1),
			(11, 'server-a', 1, 'mediux', 'mediux-root',
			 'https://images.example/background.jpg', 'background', NULL, NULL, 1),
			(12, 'server-a', 2, 'mediux', 'other-item',
			 'https://images.example/other.jpg', 'poster', NULL, NULL, 1),
			(13, 'server-a', 1, 'tmdb', 'tmdb-season',
			 'https://image.tmdb.org/t/p/original/season-1.jpg', 'season', 1, NULL, 1),
			(14, 'server-a', 1, 'mediux', 'episode-set',
			 'https://images.example/s01e01.jpg', 'title_card', 1, 1, 1),
			(15, 'server-b', 3, 'mediux', 'other-server',
			 'https://images.example/server-b.jpg', 'poster', NULL, NULL, 1),
			(16, 'server-a', 1, 'tmdb', 'inactive',
			 'https://image.tmdb.org/t/p/original/inactive.jpg', 'poster', NULL, NULL, 0);
	`);
	store = createArtworkSelectionStore(database, { clock: () => NOW });
});

afterEach(async () => {
	await client.close();
	for (const suffix of ['', '-shm', '-wal']) rmSync(`${databasePath}${suffix}`, { force: true });
});

async function rootSelection() {
	const [row] = await database
		.select({
			posterUrl: mediaItems.selectedPosterUrl,
			posterCandidateId: mediaItems.selectedPosterCandidateId,
			posterProvider: mediaItems.selectedPosterProvider,
			backgroundUrl: mediaItems.selectedBackgroundUrl,
			backgroundCandidateId: mediaItems.selectedBackgroundCandidateId,
			backgroundProvider: mediaItems.selectedBackgroundProvider,
			selectionUpdatedAt: mediaItems.selectionUpdatedAt,
			selectionRevision: mediaItems.selectionRevision
		})
		.from(mediaItems)
		.where(eq(mediaItems.id, 1));
	return row;
}

describe('artwork selection store', () => {
	it('records candidate/custom/clear provenance and preserves an omitted root slot', async () => {
		await store.stageRoot('server-a', 1, {
			background: { url: 'https://images.example/background.jpg', candidateId: 11 }
		});
		await store.stageRoot('server-a', 1, {
			poster: { url: 'https://image.tmdb.org/t/p/original/root.jpg', candidateId: 10 }
		});
		expect(await rootSelection()).toMatchObject({
			posterCandidateId: 10,
			posterProvider: 'tmdb',
			backgroundCandidateId: 11,
			backgroundProvider: 'mediux',
			selectionRevision: 2
		});

		// An explicitly custom URL never inherits the coincident candidate's provenance.
		await store.stageRoot('server-a', 1, {
			poster: { url: 'https://image.tmdb.org/t/p/original/root.jpg', candidateId: null }
		});
		expect(await rootSelection()).toMatchObject({
			posterCandidateId: null,
			posterProvider: 'custom',
			backgroundCandidateId: 11,
			backgroundProvider: 'mediux',
			selectionRevision: 3
		});

		await store.stageRoot('server-a', 1, {
			poster: { url: null, candidateId: null }
		});
		expect(await rootSelection()).toMatchObject({
			posterUrl: null,
			posterCandidateId: null,
			posterProvider: null,
			backgroundCandidateId: 11,
			selectionRevision: 4
		});
	});

	it('rejects candidate URL, item, server, slot, and active-state mismatches without writing', async () => {
		const attempts = [
			{ poster: { url: 'https://wrong.example/root.jpg', candidateId: 10 } },
			{ background: { url: 'https://image.tmdb.org/t/p/original/root.jpg', candidateId: 10 } },
			{ poster: { url: 'https://images.example/other.jpg', candidateId: 12 } },
			{ poster: { url: 'https://images.example/server-b.jpg', candidateId: 15 } },
			{
				poster: {
					url: 'https://image.tmdb.org/t/p/original/inactive.jpg',
					candidateId: 16
				}
			}
		] as const;
		for (const selection of attempts) {
			await expect(store.stageRoot('server-a', 1, selection)).rejects.toMatchObject({
				code: 'artwork_candidate_scope_mismatch'
			});
		}
		expect(await rootSelection()).toMatchObject({
			posterUrl: null,
			backgroundUrl: null,
			selectionRevision: 0
		});
	});

	it('persists child candidate/custom provenance and rejects duplicate bulk slots atomically', async () => {
		await store.stageChild('server-a', 1, {
			kind: 'poster',
			season: 1,
			episode: null,
			url: 'https://image.tmdb.org/t/p/original/season-1.jpg',
			candidateId: 13
		});
		await store.stageChildren('server-a', 1, [
			{
				kind: 'title_card',
				season: 1,
				episode: 1,
				url: 'https://images.example/s01e01.jpg',
				candidateId: 14
			},
			{
				kind: 'background',
				season: 1,
				episode: null,
				url: 'https://custom.example/season-background.jpg',
				candidateId: null
			}
		]);
		let rows = await database.select().from(childSelections);
		expect(rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: 'poster',
					candidateId: 13,
					provider: 'tmdb',
					setId: 'tmdb-season'
				}),
				expect.objectContaining({
					kind: 'title_card',
					candidateId: 14,
					provider: 'mediux'
				}),
				expect.objectContaining({
					kind: 'background',
					candidateId: null,
					provider: 'custom'
				})
			])
		);

		const before = rows;
		await expect(
			store.stageChildren('server-a', 1, [
				{
					kind: 'title_card',
					season: 1,
					episode: 1,
					url: 'https://images.example/s01e01.jpg',
					candidateId: 14
				},
				{
					kind: 'title_card',
					season: 1,
					episode: 1,
					url: 'https://custom.example/duplicate.jpg',
					candidateId: null
				}
			])
		).rejects.toBeInstanceOf(ArtworkSelectionStoreError);
		expect(await database.select().from(childSelections)).toEqual(before);
		expect((await rootSelection()).selectionRevision).toBe(2);

		await store.stageChild('server-a', 1, {
			kind: 'poster',
			season: 1,
			episode: null,
			url: null,
			candidateId: null
		});
		rows = await database.select().from(childSelections);
		expect(rows.some((row) => row.kind === 'poster')).toBe(false);
		expect((await rootSelection()).selectionRevision).toBe(3);
	});

	it('increments the revision for two writes persisted at the same timestamp', async () => {
		await store.stageRoot('server-a', 1, {
			poster: { url: 'https://custom.example/one.jpg', candidateId: null }
		});
		const first = await rootSelection();
		await store.stageRoot('server-a', 1, {
			poster: { url: 'https://custom.example/two.jpg', candidateId: null }
		});
		const second = await rootSelection();

		expect(first.selectionUpdatedAt?.getTime()).toBe(NOW.getTime());
		expect(second.selectionUpdatedAt?.getTime()).toBe(NOW.getTime());
		expect([first.selectionRevision, second.selectionRevision]).toEqual([1, 2]);
	});
});
