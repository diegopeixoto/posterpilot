import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import {
	ARTWORK_HISTORY_MAX_LIMIT,
	ArtworkRevisionHistoryQueryError,
	createArtworkRevisionHistoryRepository,
	decodeArtworkRevisionHistoryCursor,
	parseArtworkRevisionHistoryQuery,
	type ArtworkRevisionHistoryRepository
} from './history';

const SECOND = 1_000;
const START = Date.parse('2026-07-11T12:00:00.000Z');

let client: Client;
let database: LibSQLDatabase<typeof schema>;
let history: ArtworkRevisionHistoryRepository;

beforeEach(async () => {
	client = createClient({ url: 'file::memory:?cache=shared' });
	database = drizzle(client, { schema });
	await client.executeMultiple(`
		DROP TABLE IF EXISTS artwork_slot_states;
		DROP TABLE IF EXISTS artwork_revisions;
		DROP TABLE IF EXISTS artwork_revision_groups;
		DROP TABLE IF EXISTS artwork_snapshots;
		DROP TABLE IF EXISTS media_items;
		CREATE TABLE media_items (
			id integer PRIMARY KEY,
			server_instance_id text NOT NULL,
			type text NOT NULL,
			title text NOT NULL
		);
		CREATE TABLE artwork_revision_groups (
			id text PRIMARY KEY,
			server_instance_id text NOT NULL,
			operation_plan_id text,
			job_id integer,
			kind text NOT NULL,
			initiator text NOT NULL,
			outcome text NOT NULL,
			summary text,
			created_at integer NOT NULL,
			completed_at integer
		);
		CREATE TABLE artwork_snapshots (
			id text PRIMARY KEY,
			server_instance_id text NOT NULL,
			media_item_id integer,
			media_collection_id text,
			destination text NOT NULL,
			kind text NOT NULL,
			season integer,
			episode integer,
			state text NOT NULL,
			is_original integer DEFAULT 0 NOT NULL
		);
		CREATE TABLE artwork_revisions (
			id text PRIMARY KEY,
			group_id text NOT NULL,
			server_instance_id text NOT NULL,
			media_item_id integer,
			media_collection_id text,
			operation_plan_id text,
			job_id integer,
			undo_of_revision_id text,
			before_snapshot_id text,
			after_snapshot_id text,
			candidate_id integer,
			action text NOT NULL,
			destination text NOT NULL,
			kind text NOT NULL,
			season integer,
			episode integer,
			apply_method text,
			source_provider text,
			provenance text,
			prior_fingerprint text,
			proposed_fingerprint text,
			outcome text NOT NULL,
			verification text NOT NULL,
			error_code text,
			error text,
			created_at integer NOT NULL,
			completed_at integer
		);
		CREATE TABLE artwork_slot_states (
			id integer PRIMARY KEY,
			server_instance_id text NOT NULL,
			media_item_id integer,
			media_collection_id text,
			kind text NOT NULL,
			season integer,
			episode integer,
			current_url text,
			current_fingerprint text,
			artwork_version integer NOT NULL,
			last_observed_at integer,
			last_verified_at integer,
			external_changed_at integer,
			updated_at integer NOT NULL
		);
		INSERT INTO media_items (id, server_instance_id, type, title) VALUES
			(1, 'server-a', 'show', 'Safe Show'),
			(2, 'server-b', 'movie', 'Other Movie');
		INSERT INTO artwork_snapshots (
			id, server_instance_id, media_item_id, destination, kind, state, is_original
		) VALUES
			('snapshot-before', 'server-a', 1, 'server', 'poster', 'present', 0),
			('snapshot-after', 'server-a', 1, 'server', 'poster', 'present', 0),
			('snapshot-original', 'server-a', 1, 'server', 'poster', 'present', 1);
	`);
	history = createArtworkRevisionHistoryRepository(database);
});

afterEach(() => client.close());

function seconds(milliseconds: number): number {
	return Math.floor(milliseconds / 1_000);
}

async function insertGroup(input: {
	id: string;
	server?: string;
	outcome?: 'success' | 'partial' | 'failed';
	createdAt?: number;
}): Promise<void> {
	await client.execute({
		sql: `INSERT INTO artwork_revision_groups
			(id, server_instance_id, job_id, kind, initiator, outcome, created_at, completed_at)
			VALUES (?, ?, 17, 'apply', 'user', ?, ?, ?)`,
		args: [
			input.id,
			input.server ?? 'server-a',
			input.outcome ?? 'success',
			seconds(input.createdAt ?? START),
			seconds((input.createdAt ?? START) + SECOND)
		]
	});
}

async function insertRevision(input: {
	id: string;
	groupId: string;
	server?: string;
	itemId?: number;
	destination?: 'server' | 'kometa';
	kind?: 'poster' | 'background' | 'title_card';
	season?: number | null;
	episode?: number | null;
	createdAt?: number;
	outcome?: 'success' | 'failed';
	provenance?: Record<string, unknown> | null;
}): Promise<void> {
	await client.execute({
		sql: `INSERT INTO artwork_revisions (
			id, group_id, server_instance_id, media_item_id, before_snapshot_id, after_snapshot_id,
			action, destination, kind, season, episode, apply_method, source_provider, provenance,
			prior_fingerprint, proposed_fingerprint, outcome, verification, error_code, error,
			created_at, completed_at
		) VALUES (?, ?, ?, ?, 'snapshot-before', 'snapshot-after', 'apply', ?, ?, ?, ?,
			'server_url', 'mediux', ?, 'private-before-fingerprint', 'private-after-fingerprint',
			?, 'exact', ?, 'Bearer raw-error-secret', ?, ?)`,
		args: [
			input.id,
			input.groupId,
			input.server ?? 'server-a',
			input.itemId ?? 1,
			input.destination ?? 'server',
			input.kind ?? 'poster',
			input.season ?? null,
			input.episode ?? null,
			input.provenance === undefined ? null : JSON.stringify(input.provenance),
			input.outcome ?? 'success',
			input.outcome === 'failed' ? 'provider_failed' : null,
			seconds(input.createdAt ?? START),
			seconds((input.createdAt ?? START) + SECOND)
		]
	});
}

describe('artwork revision public history', () => {
	it('returns a credential-safe allowlisted DTO with current slot version only', async () => {
		await insertGroup({ id: 'group-safe', outcome: 'partial' });
		await insertRevision({
			id: 'revision-safe',
			groupId: 'group-safe',
			outcome: 'failed',
			provenance: {
				selectionSource: 'auto',
				sourceItem: { serverInstanceId: 'server-a', mediaItemId: 1 },
				providerAssetId: 'asset-7',
				setAuthor: 'Creator',
				url: 'https://images.example/poster?token=topsecret',
				storagePath: '/data/snapshots/private',
				authorization: 'Bearer provenance-secret',
				candidate: {
					id: 8,
					provider: 'mediux',
					setId: 'set-8',
					url: 'https://candidate.example/signed?key=secret'
				}
			}
		});
		await client.execute({
			sql: `INSERT INTO artwork_slot_states (
				id, server_instance_id, media_item_id, kind, current_url, current_fingerprint,
				artwork_version, last_observed_at, last_verified_at, updated_at
			) VALUES (1, 'server-a', 1, 'poster',
				'https://server.example/poster?X-Plex-Token=slot-secret', 'private-current-fingerprint',
				4, ?, ?, ?)`,
			args: [seconds(START), seconds(START), seconds(START)]
		});

		const page = await history.listItemHistory({
			serverInstanceId: 'server-a',
			mediaItemId: 1,
			query: { limit: 50 }
		});

		expect(page).toMatchObject({
			item: { id: 1, type: 'show', title: 'Safe Show' },
			nextCursor: null,
			entries: [
				{
					group: { id: 'group-safe', outcome: 'partial', jobId: 17 },
					revision: {
						id: 'revision-safe',
						destination: 'server',
						error: { code: 'provider_failed' },
						hasPriorState: true,
						hasResultState: true,
						originalProtected: true,
						undoAvailable: true,
						provenance: {
							selectionSource: 'auto',
							sourceMediaItemId: 1,
							providerAssetId: 'asset-7',
							setAuthor: 'Creator',
							candidate: { id: 8, provider: 'mediux', setId: 'set-8' }
						},
						currentSlotState: { artworkVersion: 4 }
					}
				}
			]
		});
		const serialized = JSON.stringify(page);
		expect(serialized).not.toMatch(
			/topsecret|raw-error-secret|provenance-secret|slot-secret|storagePath|current_url|fingerprint|https?:\/\//i
		);
	});

	it('treats an item owned by another server exactly like a missing item', async () => {
		await insertGroup({ id: 'group-a' });
		await insertRevision({ id: 'revision-a', groupId: 'group-a' });

		expect(
			await history.listItemHistory({
				serverInstanceId: 'server-b',
				mediaItemId: 1,
				query: { limit: 50 }
			})
		).toBeNull();
		expect(
			await history.listItemHistory({
				serverInstanceId: 'server-a',
				mediaItemId: 2,
				query: { limit: 50 }
			})
		).toBeNull();
	});

	it('filters independently by destination, kind, child scope, and group', async () => {
		await insertGroup({ id: 'group-one' });
		await insertGroup({ id: 'group-two', createdAt: START + SECOND });
		await insertRevision({ id: 'root-server', groupId: 'group-one', createdAt: START });
		await insertRevision({
			id: 'season-kometa',
			groupId: 'group-one',
			destination: 'kometa',
			kind: 'background',
			season: 1,
			createdAt: START + SECOND
		});
		await insertRevision({
			id: 'episode-server',
			groupId: 'group-two',
			kind: 'title_card',
			season: 1,
			episode: 2,
			createdAt: START + 2 * SECOND
		});

		async function ids(search: string): Promise<string[]> {
			const page = await history.listItemHistory({
				serverInstanceId: 'server-a',
				mediaItemId: 1,
				query: parseArtworkRevisionHistoryQuery(new URLSearchParams(search))
			});
			return page!.entries.map((entry) => entry.revision.id);
		}

		expect(await ids('destination=kometa')).toEqual(['season-kometa']);
		expect(await ids('kind=title_card')).toEqual(['episode-server']);
		expect(await ids('season=root')).toEqual(['root-server']);
		expect(await ids('season=1')).toEqual(['episode-server', 'season-kometa']);
		expect(await ids('season=1&episode=2')).toEqual(['episode-server']);
		expect(await ids('group=group-one')).toEqual(['season-kometa', 'root-server']);
		expect(await ids('groupId=group-two')).toEqual(['episode-server']);
	});

	it('uses a stable created-at plus revision-id cursor without duplicates', async () => {
		await insertGroup({ id: 'group-page' });
		for (const id of ['revision-a', 'revision-b', 'revision-c', 'revision-d']) {
			await insertRevision({ id, groupId: 'group-page', createdAt: START });
		}

		const first = await history.listItemHistory({
			serverInstanceId: 'server-a',
			mediaItemId: 1,
			query: { limit: 2 }
		});
		expect(first!.entries.map((entry) => entry.revision.id)).toEqual(['revision-d', 'revision-c']);
		expect(first!.nextCursor).not.toBeNull();
		expect(decodeArtworkRevisionHistoryCursor(first!.nextCursor!)).toMatchObject({
			revisionId: 'revision-c'
		});

		await insertRevision({
			id: 'revision-newer',
			groupId: 'group-page',
			createdAt: START + 10 * SECOND
		});
		const second = await history.listItemHistory({
			serverInstanceId: 'server-a',
			mediaItemId: 1,
			query: { limit: 2, cursor: first!.nextCursor! }
		});
		expect(second!.entries.map((entry) => entry.revision.id)).toEqual(['revision-b', 'revision-a']);
		expect(second!.nextCursor).toBeNull();
	});
});

describe('artwork revision history query validation', () => {
	it('bounds limit and rejects malformed filters/cursors', () => {
		const invalid = [
			'destination=other',
			'kind=logo',
			'season=-1',
			'episode=2',
			'group=unsafe%2Fgroup',
			'group=group-one&groupId=group-two',
			'cursor=not-a-cursor',
			`limit=${ARTWORK_HISTORY_MAX_LIMIT + 1}`
		];
		for (const query of invalid) {
			expect(() => parseArtworkRevisionHistoryQuery(new URLSearchParams(query))).toThrow(
				ArtworkRevisionHistoryQueryError
			);
		}
	});

	it('supports root and exact child filters at the maximum bounded page size', () => {
		expect(
			parseArtworkRevisionHistoryQuery(
				new URLSearchParams(`season=0&episode=0&limit=${ARTWORK_HISTORY_MAX_LIMIT}`)
			)
		).toEqual({ season: 0, episode: 0, limit: ARTWORK_HISTORY_MAX_LIMIT });
		expect(parseArtworkRevisionHistoryQuery(new URLSearchParams('season=root'))).toEqual({
			season: null,
			limit: 50
		});
	});
});
