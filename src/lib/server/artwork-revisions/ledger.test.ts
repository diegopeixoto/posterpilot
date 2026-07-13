import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { asc, eq } from 'drizzle-orm';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import { artworkRevisionGroups, artworkRevisions, artworkSlotStates } from '$lib/server/db/schema';
import {
	createArtworkRevisionLedger,
	type ArtworkRevisionLedger,
	type ArtworkRevisionLedgerErrorCode
} from './ledger';

const START = Date.parse('2026-07-11T12:00:00.000Z');

let client: Client;
let database: LibSQLDatabase<typeof schema>;
let ledger: ArtworkRevisionLedger;
let nowMs: number;
let groupNumber: number;
let revisionNumber: number;

beforeEach(async () => {
	// Shared-cache memory is required because libsql transactions may use a second
	// connection; plain `:memory:` would create an empty database per connection.
	client = createClient({ url: 'file::memory:?cache=shared' });
	database = drizzle(client, { schema });
	await client.executeMultiple(`
		PRAGMA foreign_keys = ON;
		DROP TABLE IF EXISTS artwork_slot_states;
		DROP TABLE IF EXISTS artwork_revisions;
		DROP TABLE IF EXISTS artwork_revision_groups;
		DROP TABLE IF EXISTS artwork_snapshots;
		DROP TABLE IF EXISTS poster_candidates;
		DROP TABLE IF EXISTS media_collections;
		DROP TABLE IF EXISTS media_items;
		DROP TABLE IF EXISTS jobs;
		DROP TABLE IF EXISTS operation_plans;
		DROP TABLE IF EXISTS server_instances;
		CREATE TABLE server_instances (
			id text PRIMARY KEY NOT NULL
		);
		CREATE TABLE operation_plans (
			id text PRIMARY KEY NOT NULL,
			server_instance_id text REFERENCES server_instances(id)
		);
		CREATE TABLE jobs (
			id integer PRIMARY KEY AUTOINCREMENT,
			server_instance_id text REFERENCES server_instances(id)
		);
		CREATE TABLE media_items (
			id integer PRIMARY KEY AUTOINCREMENT,
			server_instance_id text NOT NULL REFERENCES server_instances(id),
			current_poster_url text,
			current_background_url text,
			current_poster_fingerprint text,
			current_background_fingerprint text,
			artwork_version integer DEFAULT 0 NOT NULL,
			last_verified_at integer,
			external_artwork_changed_at integer,
			updated_at integer NOT NULL DEFAULT 0
		);
		CREATE TABLE media_collections (
			id text PRIMARY KEY NOT NULL,
			server_instance_id text NOT NULL REFERENCES server_instances(id)
		);
		CREATE TABLE poster_candidates (
			id integer PRIMARY KEY AUTOINCREMENT,
			server_instance_id text NOT NULL REFERENCES server_instances(id),
			media_item_id integer NOT NULL REFERENCES media_items(id),
			provider text DEFAULT 'mediux' NOT NULL,
			provider_asset_id text,
			set_id text NOT NULL,
			set_author text,
			design_family text,
			language text,
			width integer,
			height integer,
			score real,
			resolved_tmdb_id text,
			resolved_media_type text
		);
		CREATE TABLE artwork_snapshots (
			id text PRIMARY KEY NOT NULL
		);
		CREATE TABLE artwork_revision_groups (
			id text PRIMARY KEY NOT NULL,
			server_instance_id text NOT NULL REFERENCES server_instances(id),
			operation_plan_id text REFERENCES operation_plans(id) ON DELETE SET NULL,
			job_id integer REFERENCES jobs(id) ON DELETE SET NULL,
			kind text NOT NULL,
			initiator text NOT NULL,
			outcome text DEFAULT 'pending' NOT NULL,
			summary text,
			created_at integer NOT NULL,
			completed_at integer
		);
		CREATE TABLE artwork_revisions (
			id text PRIMARY KEY NOT NULL,
			group_id text NOT NULL REFERENCES artwork_revision_groups(id),
			server_instance_id text NOT NULL REFERENCES server_instances(id),
			media_item_id integer REFERENCES media_items(id),
			media_collection_id text REFERENCES media_collections(id),
			operation_plan_id text REFERENCES operation_plans(id) ON DELETE SET NULL,
			job_id integer REFERENCES jobs(id) ON DELETE SET NULL,
			undo_of_revision_id text REFERENCES artwork_revisions(id) ON DELETE SET NULL,
			before_snapshot_id text REFERENCES artwork_snapshots(id),
			after_snapshot_id text REFERENCES artwork_snapshots(id),
			candidate_id integer REFERENCES poster_candidates(id) ON DELETE SET NULL,
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
			outcome text DEFAULT 'pending' NOT NULL,
			verification text DEFAULT 'pending' NOT NULL,
			error_code text,
			error text,
			created_at integer NOT NULL,
			completed_at integer
		);
		CREATE TABLE artwork_slot_states (
			id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
			server_instance_id text NOT NULL REFERENCES server_instances(id),
			media_item_id integer REFERENCES media_items(id) ON DELETE CASCADE,
			media_collection_id text REFERENCES media_collections(id) ON DELETE CASCADE,
			kind text NOT NULL,
			season integer,
			episode integer,
			current_url text,
			current_fingerprint text,
			artwork_version integer DEFAULT 0 NOT NULL,
			last_observed_at integer,
			last_verified_at integer,
			external_changed_at integer,
			updated_at integer NOT NULL
		);
		CREATE UNIQUE INDEX artwork_slot_states_item_root_unique
			ON artwork_slot_states (server_instance_id, media_item_id, kind)
			WHERE media_item_id IS NOT NULL AND media_collection_id IS NULL
				AND season IS NULL AND episode IS NULL;
		CREATE UNIQUE INDEX artwork_slot_states_item_season_unique
			ON artwork_slot_states (server_instance_id, media_item_id, kind, season)
			WHERE media_item_id IS NOT NULL AND media_collection_id IS NULL
				AND season IS NOT NULL AND episode IS NULL;
		CREATE UNIQUE INDEX artwork_slot_states_item_episode_unique
			ON artwork_slot_states (server_instance_id, media_item_id, kind, season, episode)
			WHERE media_item_id IS NOT NULL AND media_collection_id IS NULL
				AND episode IS NOT NULL;
		CREATE UNIQUE INDEX artwork_slot_states_collection_unique
			ON artwork_slot_states (server_instance_id, media_collection_id, kind)
			WHERE media_item_id IS NULL AND media_collection_id IS NOT NULL;

		INSERT INTO server_instances (id) VALUES ('server-a'), ('server-b');
		INSERT INTO operation_plans (id, server_instance_id)
			VALUES ('plan-a', 'server-a'), ('plan-b', 'server-b'), ('plan-global', NULL);
		INSERT INTO jobs (id, server_instance_id) VALUES (1, 'server-a'), (2, 'server-b');
		INSERT INTO media_items (id, server_instance_id)
			VALUES (1, 'server-a'), (2, 'server-b');
		INSERT INTO media_collections (id, server_instance_id)
			VALUES ('collection-a', 'server-a'), ('collection-b', 'server-b');
		INSERT INTO poster_candidates (
			id, server_instance_id, media_item_id, provider, provider_asset_id, set_id,
			set_author, design_family, language, width, height, score,
			resolved_tmdb_id, resolved_media_type
		) VALUES
			(1, 'server-a', 1, 'mediux', 'asset-7', 'set-1', 'Creator', 'family-a',
				'en', 2000, 3000, 42.5, '101', 'movie'),
			(2, 'server-b', 2, 'tmdb', 'asset-8', 'set-2', NULL, NULL,
				NULL, 1000, 1500, 20, '202', 'movie');
	`);

	nowMs = START;
	groupNumber = 0;
	revisionNumber = 0;
	ledger = createArtworkRevisionLedger(database, {
		clock: () => new Date(nowMs),
		generateGroupId: () => `group-${++groupNumber}`,
		generateRevisionId: () => `revision-${++revisionNumber}`
	});
});

afterEach(() => client.close());

function advance(milliseconds = 1_000): void {
	nowMs += milliseconds;
}

async function expectLedgerError(
	promise: Promise<unknown>,
	code: ArtworkRevisionLedgerErrorCode
): Promise<void> {
	await expect(promise).rejects.toMatchObject({
		name: 'ArtworkRevisionLedgerError',
		code
	});
}

async function createApplyGroup() {
	return ledger.createGroup({
		serverInstanceId: 'server-a',
		operationPlanId: 'plan-a',
		jobId: 1,
		kind: 'apply',
		initiator: 'user'
	});
}

describe('artwork revision group lifecycle', () => {
	it('creates a pending group with validated plan and job scope', async () => {
		const group = await createApplyGroup();

		expect(group).toMatchObject({
			id: 'group-1',
			serverInstanceId: 'server-a',
			operationPlanId: 'plan-a',
			jobId: 1,
			kind: 'apply',
			initiator: 'user',
			outcome: 'pending',
			summary: null,
			completedAt: null
		});
		expect(group.createdAt.getTime()).toBe(START);

		await expectLedgerError(
			ledger.createGroup({
				serverInstanceId: 'server-a',
				operationPlanId: 'plan-b',
				kind: 'apply',
				initiator: 'user'
			}),
			'revision_link_scope_mismatch'
		);
		await expect(
			ledger.createGroup({
				serverInstanceId: 'server-a',
				kind: 'apply',
				initiator: ' user '
			})
		).rejects.toThrow(/trimmed/);
	});

	it('finalizes from immutable outcome rows and blocks any later append', async () => {
		const group = await createApplyGroup();
		const success = await ledger.recordOutcome({
			groupId: group.id,
			serverInstanceId: 'server-a',
			mediaItemId: 1,
			action: 'apply',
			destination: 'server',
			kind: 'poster',
			outcome: 'success',
			verification: 'exact'
		});
		advance();
		const failure = await ledger.recordOutcome({
			groupId: group.id,
			serverInstanceId: 'server-a',
			mediaItemId: 1,
			action: 'apply',
			destination: 'kometa',
			kind: 'background',
			outcome: 'failed',
			verification: 'mismatch',
			errorCode: 'kometa_verify_mismatch',
			error: 'Request failed at https://example.test/image?token=do-not-store'
		});
		const beforeFinalize = await database
			.select()
			.from(artworkRevisions)
			.orderBy(asc(artworkRevisions.id));
		advance();

		const completed = await ledger.finalizeGroup({
			groupId: group.id,
			serverInstanceId: 'server-a',
			summary: { flow: 'bulk', revisionCount: 999 }
		});

		expect(completed.outcome).toBe('partial');
		expect(completed.summary).toEqual({
			flow: 'bulk',
			revisionCount: 2,
			outcomes: { success: 1, failed: 1, skipped: 0 },
			verification: { exact: 1, bestEffort: 0, unavailable: 0, mismatch: 1, failed: 0 }
		});
		expect(completed.completedAt?.getTime()).toBe(nowMs);
		expect(failure.revision.error).toContain('token=[redacted]');
		expect(failure.revision.error).not.toContain('do-not-store');
		expect(
			await database.select().from(artworkRevisions).orderBy(asc(artworkRevisions.id))
		).toEqual(beforeFinalize);

		await expectLedgerError(
			ledger.recordOutcome({
				groupId: group.id,
				serverInstanceId: 'server-a',
				mediaItemId: 1,
				action: 'apply',
				destination: 'server',
				kind: 'poster',
				outcome: 'success',
				verification: 'exact'
			}),
			'revision_group_completed'
		);
		await expectLedgerError(
			ledger.finalizeGroup({ groupId: group.id, serverInstanceId: 'server-a' }),
			'revision_group_completed'
		);
		expect(success.revision.id).toBe('revision-1');
	});

	it('refuses to finalize a group without outcomes', async () => {
		const group = await createApplyGroup();
		await expectLedgerError(
			ledger.finalizeGroup({ groupId: group.id, serverInstanceId: 'server-a' }),
			'revision_group_empty'
		);
		expect(
			(
				await database
					.select()
					.from(artworkRevisionGroups)
					.where(eq(artworkRevisionGroups.id, group.id))
			)[0].outcome
		).toBe('pending');
	});
});

describe('append-only outcomes and current slot projection', () => {
	it('copies credential-safe candidate provenance and updates one slot row transactionally', async () => {
		const group = await createApplyGroup();
		const verifiedAt = new Date(nowMs);
		const first = await ledger.recordOutcome({
			groupId: group.id,
			serverInstanceId: 'server-a',
			mediaItemId: 1,
			candidateId: 1,
			action: 'apply',
			destination: 'server',
			kind: 'poster',
			applyMethod: 'server',
			provenance: { operationId: 'operation-1' },
			priorFingerprint: 'before-1',
			proposedFingerprint: 'after-1',
			outcome: 'success',
			verification: 'exact',
			slotState: {
				currentUrl: 'http://server-a/poster/1',
				currentFingerprint: 'after-1',
				artworkVersion: 1,
				lastObservedAt: verifiedAt,
				lastVerifiedAt: verifiedAt
			}
		});

		expect(first.revision).toMatchObject({
			operationPlanId: 'plan-a',
			jobId: 1,
			candidateId: 1,
			sourceProvider: 'mediux',
			provenance: {
				operationId: 'operation-1',
				candidate: {
					id: 1,
					provider: 'mediux',
					providerAssetId: 'asset-7',
					setId: 'set-1',
					setAuthor: 'Creator',
					designFamily: 'family-a',
					resolvedTmdbId: '101'
				}
			}
		});
		expect(JSON.stringify(first.revision.provenance)).not.toContain('http');
		expect(first.currentSlotState).toMatchObject({
			currentFingerprint: 'after-1',
			artworkVersion: 1,
			lastVerifiedAt: verifiedAt
		});
		advance();

		const second = await ledger.recordOutcome({
			groupId: group.id,
			serverInstanceId: 'server-a',
			mediaItemId: 1,
			action: 'apply',
			destination: 'server',
			kind: 'poster',
			priorFingerprint: 'after-1',
			proposedFingerprint: 'after-2',
			outcome: 'success',
			verification: 'best_effort',
			slotState: {
				currentUrl: 'http://server-a/poster/2',
				currentFingerprint: 'after-2',
				artworkVersion: 2,
				lastObservedAt: new Date(nowMs)
			}
		});

		expect(second.revision.id).not.toBe(first.revision.id);
		expect(await database.select().from(artworkRevisions)).toHaveLength(2);
		const storedFirst = (
			await database
				.select()
				.from(artworkRevisions)
				.where(eq(artworkRevisions.id, first.revision.id))
		)[0];
		expect(storedFirst.proposedFingerprint).toBe('after-1');
		const states = await database.select().from(artworkSlotStates);
		expect(states).toHaveLength(1);
		expect(states[0]).toMatchObject({
			currentUrl: 'http://server-a/poster/2',
			currentFingerprint: 'after-2',
			artworkVersion: 2,
			lastVerifiedAt: verifiedAt
		});
	});

	it('rejects wrong target, candidate, group, and action scopes before inserting', async () => {
		const group = await createApplyGroup();
		const base = {
			groupId: group.id,
			serverInstanceId: 'server-a',
			action: 'apply' as const,
			destination: 'server' as const,
			kind: 'poster' as const,
			outcome: 'success' as const,
			verification: 'exact' as const
		};

		await expectLedgerError(
			ledger.recordOutcome({ ...base, mediaItemId: 2 }),
			'revision_target_scope_mismatch'
		);
		await expectLedgerError(
			ledger.recordOutcome({ ...base, mediaItemId: 1, candidateId: 2 }),
			'revision_candidate_scope_mismatch'
		);
		await expectLedgerError(
			ledger.recordOutcome({ ...base, serverInstanceId: 'server-b', mediaItemId: 2 }),
			'revision_group_scope_mismatch'
		);
		await expectLedgerError(
			ledger.recordOutcome({ ...base, mediaItemId: 1, action: 'external_observation' }),
			'revision_group_action_mismatch'
		);
		await expect(
			ledger.recordOutcome({
				...base,
				mediaItemId: 1,
				verification: 'mismatch'
			})
		).rejects.toThrow(/Successful outcomes require/);
		await expect(
			ledger.recordOutcome({
				...base,
				mediaItemId: null,
				mediaCollectionId: 'collection-a',
				candidateId: 1
			})
		).rejects.toThrow(/media item target/);
		expect(await database.select().from(artworkRevisions)).toHaveLength(0);
	});

	it('advances background cache state without invalidating the poster item version', async () => {
		const group = await createApplyGroup();
		const recorded = await ledger.recordOutcome({
			groupId: group.id,
			serverInstanceId: 'server-a',
			mediaItemId: 1,
			action: 'apply',
			destination: 'server',
			kind: 'background',
			outcome: 'success',
			verification: 'exact',
			slotState: {
				currentUrl: 'http://server-a/background/current',
				currentFingerprint: 'background-fingerprint',
				advanceArtworkVersion: true,
				lastVerifiedAt: new Date(nowMs)
			}
		});

		expect(recorded.currentSlotState).toMatchObject({
			kind: 'background',
			artworkVersion: 1,
			currentFingerprint: 'background-fingerprint'
		});
		const [item] = await database
			.select({
				artworkVersion: schema.mediaItems.artworkVersion,
				currentBackgroundFingerprint: schema.mediaItems.currentBackgroundFingerprint
			})
			.from(schema.mediaItems)
			.where(eq(schema.mediaItems.id, 1));
		expect(item).toEqual({
			artworkVersion: 0,
			currentBackgroundFingerprint: 'background-fingerprint'
		});
	});
});

describe('scoped artwork revision timeline', () => {
	it('returns chronological per-slot outcomes without leaking another server', async () => {
		const applyGroup = await createApplyGroup();
		const applied = await ledger.recordOutcome({
			groupId: applyGroup.id,
			serverInstanceId: 'server-a',
			mediaItemId: 1,
			action: 'apply',
			destination: 'server',
			kind: 'poster',
			outcome: 'success',
			verification: 'exact',
			slotState: {
				currentUrl: 'http://server-a/poster/current',
				currentFingerprint: 'fingerprint-current',
				artworkVersion: 3
			}
		});
		advance();
		await ledger.recordOutcome({
			groupId: applyGroup.id,
			serverInstanceId: 'server-a',
			mediaItemId: 1,
			action: 'apply',
			destination: 'kometa',
			kind: 'background',
			outcome: 'failed',
			verification: 'failed',
			errorCode: 'write_failed'
		});
		await ledger.finalizeGroup({ groupId: applyGroup.id, serverInstanceId: 'server-a' });

		advance();
		const otherGroup = await ledger.createGroup({
			serverInstanceId: 'server-b',
			operationPlanId: 'plan-b',
			jobId: 2,
			kind: 'apply',
			initiator: 'user'
		});
		await ledger.recordOutcome({
			groupId: otherGroup.id,
			serverInstanceId: 'server-b',
			mediaItemId: 2,
			action: 'apply',
			destination: 'server',
			kind: 'poster',
			outcome: 'success',
			verification: 'best_effort'
		});

		advance();
		const undoGroup = await ledger.createGroup({
			serverInstanceId: 'server-a',
			operationPlanId: 'plan-global',
			kind: 'undo',
			initiator: 'user'
		});
		const undo = await ledger.recordOutcome({
			groupId: undoGroup.id,
			serverInstanceId: 'server-a',
			mediaItemId: 1,
			undoOfRevisionId: applied.revision.id,
			action: 'undo',
			destination: 'server',
			kind: 'poster',
			outcome: 'success',
			verification: 'exact'
		});

		const timeline = await ledger.listTimeline({ serverInstanceId: 'server-a', mediaItemId: 1 });
		expect(timeline.map(({ revision }) => revision.id)).toEqual([
			applied.revision.id,
			'revision-2',
			undo.revision.id
		]);
		expect(timeline.map(({ group }) => group.id)).toEqual([
			applyGroup.id,
			applyGroup.id,
			undoGroup.id
		]);
		expect(timeline[0].currentSlotState?.currentFingerprint).toBe('fingerprint-current');
		expect(timeline[1].currentSlotState).toBeNull();
		expect(timeline[2].revision.undoOfRevisionId).toBe(applied.revision.id);
		expect(await ledger.listTimeline({ serverInstanceId: 'server-b', mediaItemId: 1 })).toEqual([]);
		expect(
			(await ledger.listTimeline({ serverInstanceId: 'server-a', mediaItemId: 1, limit: 2 })).map(
				({ revision }) => revision.id
			)
		).toEqual([applied.revision.id, 'revision-2']);
	});

	it('requires an undo link to match the exact destination and child slot', async () => {
		const applyGroup = await createApplyGroup();
		const original = await ledger.recordOutcome({
			groupId: applyGroup.id,
			serverInstanceId: 'server-a',
			mediaItemId: 1,
			action: 'apply',
			destination: 'server',
			kind: 'poster',
			season: 1,
			outcome: 'success',
			verification: 'exact'
		});
		const undoGroup = await ledger.createGroup({
			serverInstanceId: 'server-a',
			kind: 'undo',
			initiator: 'user'
		});

		await expectLedgerError(
			ledger.recordOutcome({
				groupId: undoGroup.id,
				serverInstanceId: 'server-a',
				mediaItemId: 1,
				undoOfRevisionId: original.revision.id,
				action: 'undo',
				destination: 'server',
				kind: 'poster',
				season: 2,
				outcome: 'success',
				verification: 'exact'
			}),
			'revision_undo_scope_mismatch'
		);
		expect(await database.select().from(artworkRevisions)).toHaveLength(1);
	});

	it('supports collection-scoped observations and timeline reads', async () => {
		const group = await ledger.createGroup({
			serverInstanceId: 'server-a',
			kind: 'external_observation',
			initiator: 'sync'
		});
		await ledger.recordOutcome({
			groupId: group.id,
			serverInstanceId: 'server-a',
			mediaCollectionId: 'collection-a',
			action: 'external_observation',
			destination: 'server',
			kind: 'background',
			outcome: 'success',
			verification: 'best_effort',
			slotState: {
				currentUrl: 'http://server-a/collection/background',
				currentFingerprint: 'collection-fingerprint'
			}
		});

		const timeline = await ledger.listTimeline({
			serverInstanceId: 'server-a',
			mediaCollectionId: 'collection-a'
		});
		expect(timeline).toHaveLength(1);
		expect(timeline[0]).toMatchObject({
			revision: { mediaCollectionId: 'collection-a', action: 'external_observation' },
			currentSlotState: { currentFingerprint: 'collection-fingerprint' }
		});
		expect(
			await ledger.listTimeline({
				serverInstanceId: 'server-b',
				mediaCollectionId: 'collection-a'
			})
		).toEqual([]);
	});
});
