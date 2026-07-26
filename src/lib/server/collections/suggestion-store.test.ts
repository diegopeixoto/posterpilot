import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import { mediaItems, posterCandidates } from '$lib/server/db/schema';
import { DEFAULT_PROVIDER_PRIORITY, DEFAULT_SCORE_WEIGHTS } from '$lib/server/posters/score';
import {
	CollectionSuggestionStoreError,
	createCollectionSuggestionStore,
	type CollectionSuggestionStore
} from './suggestion-store';

let client: Client;
let database: LibSQLDatabase<typeof schema>;
let databasePath: string;
let store: CollectionSuggestionStore;

beforeEach(async () => {
	databasePath = `/tmp/posterpilot-collection-suggestions-${randomUUID()}.db`;
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
			source_removed_at integer,
			updated_at integer NOT NULL
		);
		CREATE TABLE poster_candidates (
			id integer PRIMARY KEY NOT NULL,
			server_instance_id text NOT NULL,
			media_item_id integer NOT NULL,
			provider text NOT NULL,
			set_id text NOT NULL,
			set_author text,
			design_family text,
			language text,
			url text NOT NULL,
			kind text NOT NULL,
			season integer,
			episode integer,
			width integer,
			height integer,
			active integer NOT NULL,
			stale integer NOT NULL
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
			(id, server_instance_id, source, source_id, name, first_seen_at, last_synced_at, removed_at)
		VALUES
			('collection-a', 'server-a', 'tmdb', '900', 'Saga', 1700000000, 1700100000, NULL),
			('collection-b', 'server-b', 'tmdb', '900', 'Saga', 1700000000, 1700100000, NULL);
		INSERT INTO media_items
			(id, server_instance_id, section_key, type, title, year, current_poster_url,
			 current_background_url, selected_poster_url, selected_background_url,
			 selected_poster_candidate_id, selected_background_candidate_id,
			 selection_updated_at, artwork_version, source_removed_at, updated_at)
		VALUES
			(1, 'server-a', 'movies', 'movie', 'First', 2001, NULL, NULL,
			 NULL, NULL, NULL, NULL, NULL, 0, NULL, 1700000000),
			(2, 'server-a', 'movies', 'movie', 'Second', 2003, NULL, NULL,
			 NULL, 'https://api.mediux.pro/assets/existing-background', NULL, NULL,
			 1700100000, 0, NULL, 1700000000),
			(3, 'server-b', 'movies', 'movie', 'Other server', 2001, NULL, NULL,
			 NULL, NULL, NULL, NULL, NULL, 0, NULL, 1700000000);
		INSERT INTO collection_memberships
			(id, server_instance_id, collection_id, media_item_id, source, source_member_id,
			 title, year, available_locally, removed_at)
		VALUES
			(1, 'server-a', 'collection-a', 1, 'tmdb', '101:local:1', 'First', 2001, 1, NULL),
			(2, 'server-a', 'collection-a', 2, 'tmdb', '102:local:2', 'Second', 2003, 1, NULL),
			(3, 'server-b', 'collection-b', 3, 'tmdb', '101:local:3', 'Other server', 2001, 1, NULL);
		INSERT INTO poster_candidates
			(id, server_instance_id, media_item_id, provider, set_id, set_author, design_family,
			 language, url, kind, season, episode, width, height, active, stale)
		VALUES
			(101, 'server-a', 1, 'mediux', 'set-first', 'curator', NULL, 'en',
			 'https://api.mediux.pro/assets/101', 'poster', NULL, NULL, 2000, 3000, 1, 0),
			(102, 'server-a', 1, 'mediux', 'set-first', 'curator', NULL, 'en',
			 'https://api.mediux.pro/assets/102', 'background', NULL, NULL, 3840, 2160, 1, 0),
			(103, 'server-a', 1, 'mediux', 'set-alt', 'other-curator', NULL, 'en',
			 'https://api.mediux.pro/assets/103', 'poster', NULL, NULL, 2000, 3000, 1, 0),
			(201, 'server-a', 2, 'mediux', 'set-second', 'curator', NULL, 'en',
			 'https://api.mediux.pro/assets/201', 'poster', NULL, NULL, 2000, 3000, 1, 0),
			(202, 'server-a', 2, 'tmdb', 'tmdb', NULL, NULL, NULL,
			 'https://image.tmdb.org/t/p/w1280/background', 'background', NULL, NULL, 1920, 1080, 1, 0),
			(301, 'server-b', 3, 'mediux', 'set-other', 'curator', NULL, 'en',
			 'https://api.mediux.pro/assets/301', 'poster', NULL, NULL, 2000, 3000, 1, 0);
	`);
	store = createCollectionSuggestionStore(database, async () => ({
		weights: DEFAULT_SCORE_WEIGHTS,
		providerPriority: DEFAULT_PROVIDER_PRIORITY
	}));
});

afterEach(() => {
	client.close();
	for (const suffix of ['', '-shm', '-wal']) rmSync(`${databasePath}${suffix}`, { force: true });
});

describe('collection suggestion store', () => {
	it('returns exact public coverage without leaking candidate URLs', async () => {
		const workspace = await store.getWorkspace('server-a', 'collection-a');

		expect(workspace?.families).toHaveLength(1);
		expect(workspace?.families[0]).toMatchObject({
			evidence: 'author',
			setAuthor: 'curator',
			coveredMemberIds: [1, 2],
			posterCoveredMemberIds: [1, 2],
			backgroundCoveredMemberIds: [1],
			backgroundUncoveredMemberIds: [2],
			coveredSlots: 3,
			coveragePercentage: 100
		});
		expect(workspace?.hasCandidates).toBe(true);
		expect(JSON.stringify(workspace)).not.toContain('https://');
	});

	it('stages only covered slots and preserves uncovered selections', async () => {
		const workspace = await store.getWorkspace('server-a', 'collection-a');
		const result = await store.stageFamily('server-a', 'collection-a', workspace!.families[0].id);

		expect(result).toEqual({ stagedSlots: 3, coveredMembers: 2, mediaItemIds: [1, 2] });
		const rows = await database
			.select({
				id: mediaItems.id,
				currentPoster: mediaItems.currentPosterUrl,
				currentBackground: mediaItems.currentBackgroundUrl,
				poster: mediaItems.selectedPosterCandidateId,
				background: mediaItems.selectedBackgroundCandidateId,
				backgroundUrl: mediaItems.selectedBackgroundUrl
			})
			.from(mediaItems);
		expect(rows.find((row) => row.id === 1)).toMatchObject({ poster: 101, background: 102 });
		expect(rows.find((row) => row.id === 2)).toMatchObject({
			poster: 201,
			background: null,
			backgroundUrl: 'https://api.mediux.pro/assets/existing-background'
		});
		expect(rows.find((row) => row.id === 3)).toMatchObject({ poster: null, background: null });
		expect(rows.every((row) => row.currentPoster === null && row.currentBackground === null)).toBe(
			true
		);
		const revisions = await client.execute('SELECT COUNT(*) AS count FROM artwork_revisions');
		expect(Number(revisions.rows[0].count)).toBe(0);
	});

	it('allows an independent member override and clear without changing sibling slots', async () => {
		const workspace = await store.getWorkspace('server-a', 'collection-a');
		await store.stageFamily('server-a', 'collection-a', workspace!.families[0].id);
		await store.stageMemberCandidate({
			serverInstanceId: 'server-a',
			collectionId: 'collection-a',
			mediaItemId: 1,
			candidateId: 103,
			kind: 'poster'
		});
		const selection = {
			selectedPosterUrl: mediaItems.selectedPosterUrl,
			selectedPosterCandidateId: mediaItems.selectedPosterCandidateId,
			selectedBackgroundCandidateId: mediaItems.selectedBackgroundCandidateId
		};
		let [item] = await database.select(selection).from(mediaItems).where(eq(mediaItems.id, 1));
		expect(item).toMatchObject({
			selectedPosterCandidateId: 103,
			selectedBackgroundCandidateId: 102
		});

		await store.clearMemberSelection({
			serverInstanceId: 'server-a',
			collectionId: 'collection-a',
			mediaItemId: 1,
			kind: 'poster'
		});
		[item] = await database.select(selection).from(mediaItems).where(eq(mediaItems.id, 1));
		expect(item).toMatchObject({
			selectedPosterUrl: null,
			selectedPosterCandidateId: null,
			selectedBackgroundCandidateId: 102
		});
	});

	it('rejects cross-server, non-member, and stale family inputs', async () => {
		const workspace = await store.getWorkspace('server-a', 'collection-a');
		await expect(
			store.stageMemberCandidate({
				serverInstanceId: 'server-a',
				collectionId: 'collection-a',
				mediaItemId: 1,
				candidateId: 301,
				kind: 'poster'
			})
		).rejects.toMatchObject({ code: 'collection_candidate_scope_mismatch' });
		await expect(
			store.clearMemberSelection({
				serverInstanceId: 'server-a',
				collectionId: 'collection-a',
				mediaItemId: 3,
				kind: 'poster'
			})
		).rejects.toMatchObject({ code: 'collection_member_scope_mismatch' });
		await expect(store.getWorkspace('server-b', 'collection-a')).resolves.toBeNull();

		await database
			.update(posterCandidates)
			.set({ active: false })
			.where(eq(posterCandidates.id, 201));
		await expect(
			store.stageFamily('server-a', 'collection-a', workspace!.families[0].id)
		).rejects.toBeInstanceOf(CollectionSuggestionStoreError);
		await expect(
			store.stageFamily('server-a', 'collection-a', workspace!.families[0].id)
		).rejects.toMatchObject({ code: 'collection_suggestion_stale' });
	});

	it('reserves per-provider slots so a lower-scoring provider is not crowded out', async () => {
		const extraMediux = Array.from(
			{ length: 10 },
			(_, index) =>
				`(${500 + index}, 'server-a', 1, 'mediux', 'set-extra-${index}', 'mediux-uploader', NULL, 'en', 'https://api.mediux.pro/assets/extra-${index}', 'poster', NULL, NULL, 2000, 3000, 1, 0)`
		).join(',\n');
		await client.executeMultiple(`
			INSERT INTO poster_candidates
				(id, server_instance_id, media_item_id, provider, set_id, set_author, design_family,
				 language, url, kind, season, episode, width, height, active, stale)
			VALUES
				${extraMediux},
				(600, 'server-a', 1, 'theposterdb', 'theposterdb-9001', 'tpdb-creator', NULL, NULL,
				 'https://theposterdb.com/assets/600', 'poster', NULL, NULL, 2000, 3000, 1, 0);
		`);

		const workspace = await store.getWorkspace('server-a', 'collection-a');
		const memberOne = workspace?.members.find((member) => member.mediaItemId === 1);
		expect(memberOne?.poster).toHaveLength(8);
		expect(memberOne?.poster.some((candidate) => candidate.provider === 'theposterdb')).toBe(true);
		expect(memberOne?.poster.filter((candidate) => candidate.provider === 'mediux')).toHaveLength(
			7
		);
	});

	it('serves candidate preview sources only inside the selected collection scope', async () => {
		await expect(store.getCandidatePreviewSource('server-a', 'collection-a', 101)).resolves.toBe(
			'https://api.mediux.pro/assets/101'
		);
		await expect(
			store.getCandidatePreviewSource('server-a', 'collection-a', 301)
		).resolves.toBeNull();
	});
});
