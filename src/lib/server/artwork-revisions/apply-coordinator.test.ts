import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import {
	artworkRevisionGroups,
	artworkRevisions,
	artworkSlotStates,
	artworkSnapshots,
	mediaItems
} from '$lib/server/db/schema';
import { DEFAULT_FILENAME } from '$lib/server/kometa/yaml';
import type { MediaServer, ServerArtwork } from '$lib/server/media-server';
import type {
	ApplyOperationExecutionResult,
	ApplyPlanExecutionResult
} from '$lib/server/plans/apply-executor';
import type { ApplyPlanOperation } from '$lib/server/plans/apply-plan';
import { sha256Bytes } from '$lib/server/revisions/verification';
import { createArtworkApplyCoordinator, type ArtworkApplyCoordinator } from './apply-coordinator';
import { createArtworkRevisionLedger, type ArtworkRevisionLedger } from './ledger';
import { ArtworkSnapshotStore } from './snapshot-store';
import { createArtworkSnapshotRepository, type ArtworkSnapshotRepository } from './snapshots';

const NOW = new Date('2026-07-11T12:00:00.000Z');

let directory: string;
let kometaDirectory: string;
let client: Client;
let database: LibSQLDatabase<typeof schema>;
let snapshots: ArtworkSnapshotRepository;
let ledger: ArtworkRevisionLedger;
let snapshotNumber: number;
let groupNumber: number;
let revisionNumber: number;

function bytes(value: string): ArrayBuffer {
	return new TextEncoder().encode(value).buffer;
}

function artwork(value: string, identity: string, kind: 'poster' | 'background' = 'poster') {
	return {
		kind,
		url: `https://server.invalid/${identity}`,
		identity,
		data: bytes(value),
		contentType: 'image/jpeg'
	} satisfies ServerArtwork;
}

function serverReader(...reads: Array<ServerArtwork | null | undefined | Error>): MediaServer {
	const queue = [...reads];
	const readArtwork = vi.fn(async () => {
		const next = queue.shift();
		if (next instanceof Error) throw next;
		return next;
	});
	return { readArtwork } as unknown as MediaServer;
}

function operation(input: {
	id: string;
	destination?: 'server' | 'kometa';
	kind?: 'poster' | 'background';
	serverInstanceId?: string;
	mediaItemId?: number;
	targetId?: string;
	tmdbId?: string | null;
	url?: string;
}): ApplyPlanOperation {
	const destination = input.destination ?? 'server';
	const serverInstanceId = input.serverInstanceId ?? 'server-a';
	const mediaItemId = input.mediaItemId ?? 1;
	const kind = input.kind ?? 'poster';
	const slot = { kind, season: null, episode: null } as const;
	return {
		id: input.id,
		destination,
		target: {
			serverInstanceId,
			mediaItemId,
			librarySectionKey: 'movies',
			sourceId: input.targetId ?? `source-${mediaItemId}`,
			type: 'movie',
			tmdbId: input.tmdbId === undefined ? '101' : input.tmdbId,
			imdbId: null,
			tvdbId: null,
			mediaType: 'movie',
			updatedAt: NOW.toISOString(),
			selectionUpdatedAt: NOW.toISOString()
		},
		targetId: input.targetId ?? `source-${mediaItemId}`,
		slot,
		current: {
			url: 'https://server.invalid/before',
			fingerprint: `prior-${input.id}`,
			artworkVersion: 0,
			observedAt: NOW.toISOString(),
			destinationFingerprint: `destination-${input.id}`
		},
		selection: {
			selectionSource: 'auto',
			sourceItem: { serverInstanceId, mediaItemId },
			slot,
			candidateId: null,
			url: input.url ?? `https://images.invalid/${input.id}.jpg`,
			provider: 'tmdb',
			providerAssetId: `asset-${input.id}`,
			setId: null,
			setAuthor: null,
			designFamily: null,
			language: 'en',
			discoveryRunId: `run-${input.id}`,
			resolvedTmdbId: '101',
			resolvedMediaType: 'movie',
			stale: false,
			score: 42,
			width: 1000,
			height: 1500,
			fingerprint: `selection-${input.id}`
		},
		expectedOverwrite: true
	};
}

function successfulWrite(operation: ApplyPlanOperation): ApplyOperationExecutionResult {
	return {
		operationId: operation.id,
		destination: operation.destination,
		targetId: operation.targetId,
		slot: operation.slot,
		status: 'success'
	};
}

function executionResult(
	operations: ApplyPlanOperation[],
	results: ApplyOperationExecutionResult[]
): ApplyPlanExecutionResult {
	const items = new Map<string, ApplyPlanExecutionResult['items'][number]>();
	for (const operation of operations) {
		const key = `${operation.target.serverInstanceId}:${operation.target.mediaItemId}`;
		let item = items.get(key);
		if (!item) {
			item = {
				serverInstanceId: operation.target.serverInstanceId,
				mediaItemId: operation.target.mediaItemId,
				operations: [],
				skips: []
			};
			items.set(key, item);
		}
		item.operations.push(...results.filter((result) => result.operationId === operation.id));
	}
	return {
		planId: 'plan-global',
		digest: 'digest',
		sourceFingerprint: 'source-fingerprint',
		summary: {
			itemCount: items.size,
			operationCount: results.length,
			succeeded: results.filter((result) => result.status === 'success').length,
			failed: results.filter((result) => result.status === 'failed').length,
			skipped: 0
		},
		items: [...items.values()]
	};
}

function coordinator(): ArtworkApplyCoordinator {
	return createArtworkApplyCoordinator({
		snapshots,
		ledger,
		planId: 'plan-global',
		kometaAssetsDirectory: kometaDirectory,
		clock: () => NOW,
		fetchArtworkBytes: async (url) => bytes(url)
	});
}

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'posterpilot-apply-coordinator-'));
	kometaDirectory = join(directory, 'kometa');
	await mkdir(kometaDirectory, { recursive: true });
	client = createClient({ url: 'file::memory:?cache=shared' });
	database = drizzle(client, { schema });
	await client.executeMultiple(`
		PRAGMA foreign_keys = OFF;
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
		PRAGMA foreign_keys = ON;
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
			current_poster_fingerprint text,
			current_background_url text,
			current_background_fingerprint text,
			artwork_version integer DEFAULT 0 NOT NULL,
			last_verified_at integer,
			external_artwork_changed_at integer,
			updated_at integer NOT NULL
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
			outcome text DEFAULT 'pending' NOT NULL,
			verification text DEFAULT 'pending' NOT NULL,
			error_code text,
			error text,
			created_at integer NOT NULL,
			completed_at integer
		);
		CREATE TABLE artwork_slot_states (
			id integer PRIMARY KEY AUTOINCREMENT,
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

		INSERT INTO server_instances (id) VALUES ('server-a'), ('server-b');
		INSERT INTO operation_plans (id, server_instance_id) VALUES ('plan-global', NULL);
		INSERT INTO media_items (id, server_instance_id, updated_at)
			VALUES (1, 'server-a', 0), (2, 'server-b', 0);
	`);

	snapshotNumber = 0;
	groupNumber = 0;
	revisionNumber = 0;
	const store = new ArtworkSnapshotStore(join(directory, 'artwork-snapshots'));
	snapshots = createArtworkSnapshotRepository(database, store, {
		clock: () => NOW,
		generateId: () => `snapshot-${++snapshotNumber}`
	});
	ledger = createArtworkRevisionLedger(database, {
		clock: () => NOW,
		generateGroupId: () => `group-${++groupNumber}`,
		generateRevisionId: () => `revision-${++revisionNumber}`
	});
});

afterEach(async () => {
	client.close();
	await rm(directory, { recursive: true, force: true });
});

describe('ArtworkApplyCoordinator', () => {
	it('captures original, prior, and after bytes, verifies exactly, and advances artwork version', async () => {
		const subject = coordinator();
		const planned = operation({ id: 'exact-server' });
		const beforeArtwork = artwork('before bytes', 'before-id');
		const afterArtwork = artwork(planned.selection.url, 'after-id');
		planned.current.fingerprint = sha256Bytes(beforeArtwork.data);
		const server = serverReader(beforeArtwork, afterArtwork);

		await subject.prepareOperation(planned, { server });
		const result = await subject.recordOutcome(planned, successfulWrite(planned), { server });
		await subject.finalize(executionResult([planned], [result]));

		expect(result).toMatchObject({
			status: 'success',
			verification: 'exact',
			artworkVersion: 1,
			observedFingerprint: sha256Bytes(afterArtwork.data)
		});
		const [revision] = await database.select().from(artworkRevisions);
		const rows = await database.select().from(artworkSnapshots);
		const original = rows.find((row) => row.isOriginal);
		const prior = rows.find((row) => row.id === revision?.beforeSnapshotId);
		const after = rows.find((row) => row.id === revision?.afterSnapshotId);
		expect(rows).toHaveLength(3);
		expect(original?.id).not.toBe(prior?.id);
		expect(await snapshots.readBytes(original!)).toEqual(Buffer.from('before bytes'));
		expect(await snapshots.readBytes(prior!)).toEqual(Buffer.from('before bytes'));
		expect(await snapshots.readBytes(after!)).toEqual(Buffer.from(planned.selection.url));
		expect(revision).toMatchObject({ outcome: 'success', verification: 'exact' });

		const [slotState] = await database.select().from(artworkSlotStates);
		const [item] = await database
			.select({
				artworkVersion: mediaItems.artworkVersion,
				lastVerifiedAt: mediaItems.lastVerifiedAt
			})
			.from(mediaItems);
		expect(slotState).toMatchObject({
			artworkVersion: 1,
			currentFingerprint: sha256Bytes(afterArtwork.data),
			lastVerifiedAt: NOW
		});
		expect(item).toMatchObject({ artworkVersion: 1, lastVerifiedAt: NOW });
		const [group] = await database.select().from(artworkRevisionGroups);
		expect(group).toMatchObject({
			outcome: 'success',
			summary: {
				planId: 'plan-global',
				revisionCount: 1,
				verification: { exact: 1 }
			}
		});
	});

	it('accepts changed provider evidence as best-effort and advances the verified version', async () => {
		const subject = coordinator();
		const planned = operation({ id: 'best-effort' });
		const beforeArtwork = artwork('before bytes', 'before-id');
		planned.current.fingerprint = sha256Bytes(beforeArtwork.data);
		const server = serverReader(beforeArtwork, artwork('provider transcoded bytes', 'after-id'));

		await subject.prepareOperation(planned, { server });
		const result = await subject.recordOutcome(planned, successfulWrite(planned), { server });
		await subject.finalize(executionResult([planned], [result]));

		expect(result).toMatchObject({
			status: 'success',
			verification: 'best_effort',
			artworkVersion: 1
		});
		const [revision] = await database.select().from(artworkRevisions);
		const [slotState] = await database.select().from(artworkSlotStates);
		const [group] = await database.select().from(artworkRevisionGroups);
		expect(revision).toMatchObject({ outcome: 'success', verification: 'best_effort' });
		expect(slotState).toMatchObject({ artworkVersion: 1, lastVerifiedAt: NOW });
		expect(group).toMatchObject({
			outcome: 'success',
			summary: { verification: { bestEffort: 1 } }
		});
	});

	it('turns unchanged server artwork into a failed mismatch without advancing version', async () => {
		const subject = coordinator();
		const planned = operation({ id: 'mismatch' });
		const unchanged = artwork('unchanged bytes', 'same-id');
		planned.current.fingerprint = sha256Bytes(unchanged.data);
		const server = serverReader(unchanged, unchanged);

		await subject.prepareOperation(planned, { server });
		const result = await subject.recordOutcome(planned, successfulWrite(planned), { server });
		await subject.finalize(executionResult([planned], [result]));

		expect(result).toMatchObject({
			status: 'failed',
			verification: 'mismatch',
			artworkVersion: 0,
			errorCode: 'artwork_unchanged_after_write'
		});
		const [revision] = await database.select().from(artworkRevisions);
		const [slotState] = await database.select().from(artworkSlotStates);
		const [item] = await database
			.select({
				artworkVersion: mediaItems.artworkVersion,
				lastVerifiedAt: mediaItems.lastVerifiedAt
			})
			.from(mediaItems);
		const [group] = await database.select().from(artworkRevisionGroups);
		expect(revision).toMatchObject({ outcome: 'failed', verification: 'mismatch' });
		expect(slotState).toMatchObject({ artworkVersion: 0, lastVerifiedAt: null });
		expect(item).toMatchObject({ artworkVersion: 0, lastVerifiedAt: null });
		expect(group).toMatchObject({ outcome: 'failed' });
	});

	it('records unavailable reads as an unverified failure with unavailable snapshots', async () => {
		const subject = coordinator();
		const planned = operation({ id: 'read-unavailable' });
		planned.current.fingerprint = null;
		const server = serverReader(
			new Error('provider read unavailable'),
			new Error('provider read unavailable')
		);

		await subject.prepareOperation(planned, { server });
		const result = await subject.recordOutcome(planned, successfulWrite(planned), { server });
		await subject.finalize(executionResult([planned], [result]));

		expect(result).toMatchObject({
			status: 'failed',
			verification: 'unavailable',
			errorCode: 'artwork_verification_unavailable'
		});
		expect((await database.select().from(artworkSnapshots)).map((row) => row.state)).toEqual([
			'unavailable',
			'unavailable',
			'unavailable'
		]);
		const [revision] = await database.select().from(artworkRevisions);
		const [group] = await database.select().from(artworkRevisionGroups);
		expect(revision).toMatchObject({ outcome: 'failed', verification: 'unavailable' });
		expect(await database.select().from(artworkSlotStates)).toEqual([]);
		expect(group).toMatchObject({ outcome: 'failed' });
	});

	it('blocks a server write when the live bytes no longer match the frozen destination', async () => {
		const subject = coordinator();
		const planned = operation({ id: 'stale-server' });
		planned.current.fingerprint = sha256Bytes(bytes('planned current'));

		await expect(
			subject.prepareOperation(planned, {
				server: serverReader(artwork('externally changed', 'external-id'))
			})
		).rejects.toThrow(/changed before/);
		expect(await database.select().from(artworkSnapshots)).toHaveLength(2);
		expect(await database.select().from(artworkRevisionGroups)).toHaveLength(1);
	});

	it('preserves absent Kometa original/prior snapshots and records an exact present value', async () => {
		const subject = coordinator();
		const planned = operation({
			id: 'kometa-absent-present',
			destination: 'kometa',
			tmdbId: '101'
		});

		await subject.prepareOperation(planned, {});
		await writeFile(
			join(kometaDirectory, DEFAULT_FILENAME),
			`metadata:\n  101:\n    url_poster: ${planned.selection.url}\n`,
			'utf8'
		);
		const result = await subject.recordOutcome(planned, successfulWrite(planned), {});
		await subject.finalize(executionResult([planned], [result]));

		expect(result).toMatchObject({ status: 'success', verification: 'exact' });
		const rows = await database.select().from(artworkSnapshots);
		const [revision] = await database.select().from(artworkRevisions);
		const original = rows.find((row) => row.isOriginal);
		const prior = rows.find((row) => row.id === revision?.beforeSnapshotId);
		const after = rows.find((row) => row.id === revision?.afterSnapshotId);
		expect(rows).toHaveLength(3);
		expect(original).toMatchObject({ state: 'absent', value: null });
		expect(prior).toMatchObject({ state: 'absent', value: null });
		expect(after).toMatchObject({
			state: 'present',
			value: { state: 'present', url: planned.selection.url }
		});
		expect(
			await snapshots.findOriginal({
				serverInstanceId: 'server-a',
				mediaItemId: 1,
				destination: 'kometa',
				slot: planned.slot
			})
		).toMatchObject({ id: original?.id, state: 'absent' });
		expect(revision).toMatchObject({ outcome: 'success', verification: 'exact' });
	});

	it('blocks a Kometa write when the managed slot changes after preparation', async () => {
		const subject = coordinator();
		const planned = operation({ id: 'stale-kometa', destination: 'kometa', tmdbId: '101' });
		await subject.prepareOperation(planned, {});
		await writeFile(
			join(kometaDirectory, DEFAULT_FILENAME),
			'metadata:\n  101:\n    url_poster: https://external.invalid/new.jpg\n',
			'utf8'
		);

		expect(() => subject.assertKometaFresh([planned], null)).not.toThrow();
		expect(() =>
			subject.assertKometaFresh(
				[planned],
				'metadata:\n  101:\n    url_poster: https://external.invalid/new.jpg\n'
			)
		).toThrow(/changed before/);
	});

	it('uses one group per server and finalizes mixed outcomes as partial', async () => {
		const subject = coordinator();
		const exact = operation({ id: 'group-exact', kind: 'poster' });
		const mismatch = operation({ id: 'group-mismatch', kind: 'background' });
		const exactServer = serverReader(
			artwork('poster before', 'poster-before'),
			artwork(exact.selection.url, 'poster-after')
		);
		const unchangedBackground = artwork('background before', 'background-id', 'background');
		exact.current.fingerprint = sha256Bytes(bytes('poster before'));
		mismatch.current.fingerprint = sha256Bytes(unchangedBackground.data);
		const mismatchServer = serverReader(unchangedBackground, unchangedBackground);

		await subject.prepareOperation(exact, { server: exactServer });
		const exactResult = await subject.recordOutcome(exact, successfulWrite(exact), {
			server: exactServer
		});
		await subject.prepareOperation(mismatch, { server: mismatchServer });
		const mismatchResult = await subject.recordOutcome(mismatch, successfulWrite(mismatch), {
			server: mismatchServer
		});

		const [pendingGroup] = await database.select().from(artworkRevisionGroups);
		expect(await database.select().from(artworkRevisionGroups)).toHaveLength(1);
		expect(pendingGroup).toMatchObject({ serverInstanceId: 'server-a', outcome: 'pending' });
		await subject.finalize(executionResult([exact, mismatch], [exactResult, mismatchResult]));

		const [completedGroup] = await database.select().from(artworkRevisionGroups);
		expect(completedGroup).toMatchObject({
			id: pendingGroup?.id,
			outcome: 'partial',
			summary: {
				revisionCount: 2,
				outcomes: { success: 1, failed: 1, skipped: 0 },
				verification: { exact: 1, mismatch: 1 }
			}
		});
		expect(await database.select().from(artworkRevisions)).toHaveLength(2);
	});
});
