import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
import {
	LEGACY_FILENAME,
	MOVIE_FILENAME,
	SHOW_FILENAME,
	resolveKometaDestination,
	type KometaDestinationV2
} from '$lib/server/kometa/destination';
import type { MediaServer, ServerArtwork } from '$lib/server/media-server';
import type {
	ApplyOperationExecutionResult,
	ApplyPlanExecutionResult
} from '$lib/server/plans/apply-executor';
import type { ApplyPlanOperation } from '$lib/server/plans/apply-plan';
import { hashCanonicalJson } from '$lib/server/plans/canonical-json';
import { RemoteArtworkDownloadError, type RemoteArtworkFetch } from '$lib/server/remote-artwork';
import { sha256Bytes } from '$lib/server/revisions/verification';
import {
	createArtworkApplyCoordinator,
	preflightServerArtwork,
	trustedProviderArtworkUrl,
	type ArtworkApplyCoordinator,
	type ArtworkApplyCoordinatorOptions
} from './apply-coordinator';
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

function destinationFor(input: {
	type?: 'movie' | 'show';
	tmdbId?: string | null;
	tvdbId?: string | null;
	imdbId?: string | null;
}): KometaDestinationV2 {
	const type = input.type ?? 'movie';
	const result = resolveKometaDestination({
		type,
		tmdbId: input.tmdbId === undefined && type === 'movie' ? '101' : input.tmdbId,
		tvdbId: input.tvdbId === undefined && type === 'show' ? '101' : input.tvdbId,
		imdbId: input.imdbId
	});
	if (!result.ok) throw new Error('test Kometa destination must resolve');
	return result.destination;
}

function kometaDestinationFingerprint(
	destination: KometaDestinationV2,
	raw: string | null
): string {
	return hashCanonicalJson({
		filePath: join(kometaDirectory, destination.filename),
		destination,
		fileFingerprint: hashCanonicalJson({ exists: raw !== null, content: raw })
	});
}

function operation(input: {
	id: string;
	destination?: 'server' | 'kometa';
	kind?: 'poster' | 'background';
	serverInstanceId?: string;
	mediaItemId?: number;
	targetId?: string;
	type?: 'movie' | 'show';
	tmdbId?: string | null;
	tvdbId?: string | null;
	imdbId?: string | null;
	kometaDestination?: KometaDestinationV2;
	kometaRaw?: string | null;
	url?: string;
}): ApplyPlanOperation {
	const destination = input.destination ?? 'server';
	const serverInstanceId = input.serverInstanceId ?? 'server-a';
	const mediaItemId = input.mediaItemId ?? 1;
	const type = input.type ?? 'movie';
	const kind = input.kind ?? 'poster';
	const slot = { kind, season: null, episode: null } as const;
	const kometaDestination =
		destination === 'kometa'
			? (input.kometaDestination ??
				destinationFor({
					type,
					tmdbId: input.tmdbId,
					tvdbId: input.tvdbId,
					imdbId: input.imdbId
				}))
			: null;
	return {
		id: input.id,
		destination,
		...(kometaDestination ? { kometaDestination } : {}),
		...(kometaDestination
			? {
					kometaFileFingerprint: hashCanonicalJson({
						exists: (input.kometaRaw ?? null) !== null,
						content: input.kometaRaw ?? null
					})
				}
			: {}),
		target: {
			serverInstanceId,
			mediaItemId,
			librarySectionKey: 'movies',
			sourceId: input.targetId ?? `source-${mediaItemId}`,
			type,
			tmdbId: input.tmdbId === undefined ? '101' : input.tmdbId,
			imdbId: input.imdbId ?? null,
			tvdbId: input.tvdbId ?? null,
			mediaType: type === 'movie' ? 'movie' : 'tv',
			updatedAt: NOW.toISOString(),
			selectionUpdatedAt: NOW.toISOString(),
			selectionRevision: 1
		},
		targetId: kometaDestination?.key ?? input.targetId ?? `source-${mediaItemId}`,
		slot,
		current: {
			url: 'https://server.invalid/before',
			fingerprint: `prior-${input.id}`,
			artworkVersion: 0,
			observedAt: NOW.toISOString(),
			destinationFingerprint: kometaDestination
				? kometaDestinationFingerprint(kometaDestination, input.kometaRaw ?? null)
				: `destination-${input.id}`
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

function coordinator(
	preflight: NonNullable<ArtworkApplyCoordinatorOptions['fetchArtworkBytes']> = async (url) => ({
		bytes: bytes(url),
		contentType: 'image/jpeg'
	})
): ArtworkApplyCoordinator {
	return createArtworkApplyCoordinator({
		snapshots,
		ledger,
		planId: 'plan-global',
		kometaAssetsDirectory: kometaDirectory,
		clock: () => NOW,
		fetchArtworkBytes: preflight
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
	it.each([
		{ kind: 'poster' as const, bytesMethod: 'applyPosterBytes' as const },
		{ kind: 'background' as const, bytesMethod: 'applyBackgroundBytes' as const }
	])(
		'applies the exact preflighted bytes and content type to Plex $kind without a URL fetch',
		async ({ kind, bytesMethod }) => {
			const expectedBytes = bytes(`exact ${kind} bytes`);
			const preflight = vi.fn(async () => ({
				bytes: expectedBytes,
				contentType: 'image/png'
			}));
			const subject = coordinator(preflight);
			const planned = operation({ id: `plex-${kind}-bytes`, kind });
			const beforeArtwork = artwork(`before ${kind}`, `before-${kind}`, kind);
			planned.current.fingerprint = sha256Bytes(beforeArtwork.data);
			let liveArtwork = beforeArtwork;
			const applyPosterUrl = vi.fn(async () => undefined);
			const applyBackgroundUrl = vi.fn(async () => undefined);
			const applyPosterBytes = vi.fn(
				async (_targetId: string, data: ArrayBuffer, contentType?: string) => {
					liveArtwork = {
						kind: 'poster',
						url: 'https://plex.invalid/uploaded-poster',
						identity: 'uploaded-poster',
						data,
						contentType: contentType ?? 'application/octet-stream'
					};
				}
			);
			const applyBackgroundBytes = vi.fn(
				async (_targetId: string, data: ArrayBuffer, contentType?: string) => {
					liveArtwork = {
						kind: 'background',
						url: 'https://plex.invalid/uploaded-background',
						identity: 'uploaded-background',
						data,
						contentType: contentType ?? 'application/octet-stream'
					};
				}
			);
			const server = {
				type: 'plex',
				readArtwork: vi.fn(async () => liveArtwork),
				applyPosterUrl,
				applyPosterBytes,
				applyBackgroundUrl,
				applyBackgroundBytes
			} as unknown as MediaServer;

			await subject.prepareOperation(planned, { server });
			await subject.executeServerOperation(planned, { server });
			const result = await subject.recordOutcome(planned, successfulWrite(planned), { server });
			await expect(subject.executeServerOperation(planned, { server })).rejects.toThrow(
				'Server operation was not prepared'
			);

			expect(preflight).toHaveBeenCalledWith(planned.selection.url);
			expect(server[bytesMethod]).toHaveBeenCalledWith(
				planned.targetId,
				expectedBytes,
				'image/png'
			);
			expect(applyPosterUrl).not.toHaveBeenCalled();
			expect(applyBackgroundUrl).not.toHaveBeenCalled();
			expect(result).toMatchObject({ status: 'success', verification: 'exact' });
			const [revision] = await database.select().from(artworkRevisions);
			expect(revision).toMatchObject({ applyMethod: 'server_bytes', outcome: 'success' });
		}
	);

	it.each(['snapshot', 'ledger'] as const)(
		'releases prepared bytes when $s outcome recording fails and is converted',
		async (failurePoint) => {
			const planned = operation({ id: `record-${failurePoint}-failure` });
			const beforeArtwork = artwork('before record failure', 'before-record-failure');
			planned.current.fingerprint = sha256Bytes(beforeArtwork.data);
			const server = serverReader(
				beforeArtwork,
				artwork('after record failure', 'after-record-failure')
			);
			let captureCount = 0;
			const failingSnapshots: ArtworkSnapshotRepository =
				failurePoint === 'snapshot'
					? {
							...snapshots,
							captureServer: vi.fn(
								async (input: Parameters<ArtworkSnapshotRepository['captureServer']>[0]) => {
									captureCount += 1;
									if (captureCount === 3) throw new Error('snapshot record failed');
									return snapshots.captureServer(input);
								}
							)
						}
					: snapshots;
			const failingLedger: ArtworkRevisionLedger =
				failurePoint === 'ledger'
					? {
							...ledger,
							recordOutcome: vi.fn(async () => {
								throw new Error('ledger record failed');
							})
						}
					: ledger;
			const subject = createArtworkApplyCoordinator({
				snapshots: failingSnapshots,
				ledger: failingLedger,
				planId: 'plan-global',
				kometaAssetsDirectory: kometaDirectory,
				clock: () => NOW,
				fetchArtworkBytes: async () => ({
					bytes: bytes('prepared record failure bytes'),
					contentType: 'image/jpeg'
				})
			});

			await subject.prepareOperation(planned, { server });
			const converted = await subject
				.recordOutcome(planned, successfulWrite(planned), { server })
				.catch(
					(error: unknown): ApplyOperationExecutionResult => ({
						...successfulWrite(planned),
						status: 'failed',
						error: `Outcome record failed: ${error instanceof Error ? error.message : String(error)}`
					})
				);

			expect(converted).toMatchObject({
				status: 'failed',
				error: expect.stringContaining(`${failurePoint} record failed`)
			});
			await expect(subject.executeServerOperation(planned, { server })).rejects.toThrow(
				'Server operation was not prepared'
			);
		}
	);

	it('uses a safe JPEG content type for the legacy ArrayBuffer preflight seam', async () => {
		const expectedBytes = bytes('legacy seam bytes');
		const subject = coordinator(async () => expectedBytes);
		const planned = operation({ id: 'legacy-array-buffer-seam' });
		const beforeArtwork = artwork('before legacy seam', 'before-legacy');
		planned.current.fingerprint = sha256Bytes(beforeArtwork.data);
		let liveArtwork = beforeArtwork;
		const applyPosterBytes = vi.fn(async (_id, data: ArrayBuffer, contentType?: string) => {
			liveArtwork = {
				kind: 'poster',
				url: 'https://server.invalid/uploaded-legacy',
				identity: 'uploaded-legacy',
				data,
				contentType: contentType ?? 'application/octet-stream'
			};
		});
		const server = {
			readArtwork: vi.fn(async () => liveArtwork),
			applyPosterBytes
		} as unknown as MediaServer;

		await subject.prepareOperation(planned, { server });
		await subject.executeServerOperation(planned, { server });

		expect(applyPosterBytes).toHaveBeenCalledWith(planned.targetId, expectedBytes, 'image/jpeg');
	});

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
		const preflight = vi.fn(async (url: string) => bytes(url));
		const subject = coordinator(preflight);
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
		expect(preflight).toHaveBeenCalledOnce();
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
		expect(await database.select().from(artworkSnapshots)).toHaveLength(0);
		expect(await database.select().from(artworkRevisionGroups)).toHaveLength(1);
	});

	it('verifies against the frozen plan when the prepare-time read failed transiently', async () => {
		const subject = coordinator();
		const planned = operation({ id: 'prepare-read-blip' });
		const current = artwork('planned current', 'planned-current');
		planned.current.fingerprint = sha256Bytes(current.data);
		const queue = [new Error('read blip'), current];
		const applyPosterBytes = vi.fn(async () => undefined);
		const server = {
			readArtwork: vi.fn(async () => {
				const next = queue.shift();
				if (next instanceof Error) throw next;
				return next;
			}),
			applyPosterBytes
		} as unknown as MediaServer;

		await subject.prepareOperation(planned, { server });
		await subject.executeServerOperation(planned, { server });

		expect(applyPosterBytes).toHaveBeenCalledOnce();
	});

	it('still blocks a drifted destination when only the execute-time read could see it', async () => {
		const subject = coordinator();
		const planned = operation({ id: 'prepare-blip-then-drift' });
		planned.current.fingerprint = sha256Bytes(bytes('planned current'));
		const queue = [new Error('read blip'), artwork('externally changed', 'external-id')];
		const applyPosterBytes = vi.fn(async () => undefined);
		const server = {
			readArtwork: vi.fn(async () => {
				const next = queue.shift();
				if (next instanceof Error) throw next;
				return next;
			}),
			applyPosterBytes
		} as unknown as MediaServer;

		await subject.prepareOperation(planned, { server });
		await expect(subject.executeServerOperation(planned, { server })).rejects.toThrow(
			/changed before/
		);
		expect(applyPosterBytes).not.toHaveBeenCalled();
	});

	it('proceeds on the prepare-time verification when the execute-time re-read fails', async () => {
		const subject = coordinator();
		const planned = operation({ id: 'execute-read-blip' });
		const current = artwork('planned current', 'planned-current');
		planned.current.fingerprint = sha256Bytes(current.data);
		const queue = [current, new Error('read blip')];
		const applyPosterBytes = vi.fn(async () => undefined);
		const server = {
			readArtwork: vi.fn(async () => {
				const next = queue.shift();
				if (next instanceof Error) throw next;
				return next;
			}),
			applyPosterBytes
		} as unknown as MediaServer;

		await subject.prepareOperation(planned, { server });
		await subject.executeServerOperation(planned, { server });

		expect(applyPosterBytes).toHaveBeenCalledOnce();
	});

	it('refuses the write when the destination was never readable at all', async () => {
		const subject = coordinator();
		const planned = operation({ id: 'never-read' });
		planned.current.fingerprint = sha256Bytes(bytes('planned current'));
		const applyPosterBytes = vi.fn(async () => undefined);
		const server = {
			readArtwork: vi.fn(async () => {
				throw new Error('read blip');
			}),
			applyPosterBytes
		} as unknown as MediaServer;

		await subject.prepareOperation(planned, { server });
		await expect(subject.executeServerOperation(planned, { server })).rejects.toThrow(
			/could not be verified/
		);
		expect(applyPosterBytes).not.toHaveBeenCalled();
	});

	it('blocks an external change during download before snapshots or writes are created', async () => {
		const planned = operation({ id: 'changed-during-download' });
		const beforeArtwork = artwork('planned current', 'planned-current');
		const externalArtwork = artwork('external during download', 'external-during-download');
		planned.current.fingerprint = sha256Bytes(beforeArtwork.data);
		let liveArtwork = beforeArtwork;
		const applyPosterUrl = vi.fn(async () => undefined);
		const applyPosterBytes = vi.fn(async () => undefined);
		const server = {
			readArtwork: vi.fn(async () => liveArtwork),
			applyPosterUrl,
			applyPosterBytes
		} as unknown as MediaServer;
		const subject = coordinator(async () => {
			liveArtwork = externalArtwork;
			return { bytes: bytes('downloaded candidate'), contentType: 'image/webp' };
		});

		await expect(subject.prepareOperation(planned, { server })).rejects.toThrow(/changed before/);
		expect(applyPosterUrl).not.toHaveBeenCalled();
		expect(applyPosterBytes).not.toHaveBeenCalled();
		expect(await database.select().from(artworkSnapshots)).toHaveLength(0);

		const recorded = await subject.recordOutcome(
			planned,
			{ ...successfulWrite(planned), status: 'failed', error: 'destination changed' },
			{ server }
		);
		await subject.finalize(executionResult([planned], [recorded]));
		const [revision] = await database.select().from(artworkRevisions);
		const [after] = await database.select().from(artworkSnapshots);
		expect(revision).toMatchObject({
			beforeSnapshotId: null,
			afterSnapshotId: after?.id,
			outcome: 'failed'
		});
		expect(await snapshots.readBytes(after!)).toEqual(Buffer.from('external during download'));
	});

	it('rechecks the prepared snapshot and blocks an external change before apply', async () => {
		const planned = operation({ id: 'changed-after-prepare' });
		const beforeArtwork = artwork('prepared prior', 'prepared-prior');
		const externalArtwork = artwork('external before apply', 'external-before-apply');
		planned.current.fingerprint = sha256Bytes(beforeArtwork.data);
		let liveArtwork = beforeArtwork;
		const applyPosterUrl = vi.fn(async () => undefined);
		const applyPosterBytes = vi.fn(async () => undefined);
		const server = {
			readArtwork: vi.fn(async () => liveArtwork),
			applyPosterUrl,
			applyPosterBytes
		} as unknown as MediaServer;
		const subject = coordinator(async () => ({
			bytes: bytes('downloaded candidate'),
			contentType: 'image/avif'
		}));

		await subject.prepareOperation(planned, { server });
		liveArtwork = externalArtwork;
		const writeError = await subject
			.executeServerOperation(planned, { server })
			.catch((error: unknown) => error);
		expect(writeError).toBeInstanceOf(Error);
		expect(String(writeError)).toContain('changed before');
		expect(applyPosterUrl).not.toHaveBeenCalled();
		expect(applyPosterBytes).not.toHaveBeenCalled();

		const recorded = await subject.recordOutcome(
			planned,
			{ ...successfulWrite(planned), status: 'failed', error: String(writeError) },
			{ server }
		);
		await subject.finalize(executionResult([planned], [recorded]));
		const [revision] = await database.select().from(artworkRevisions);
		const rows = await database.select().from(artworkSnapshots);
		const prior = rows.find((row) => row.id === revision?.beforeSnapshotId);
		const after = rows.find((row) => row.id === revision?.afterSnapshotId);
		expect(revision).toMatchObject({ outcome: 'failed', verification: 'failed' });
		expect(await snapshots.readBytes(prior!)).toEqual(Buffer.from('prepared prior'));
		expect(await snapshots.readBytes(after!)).toEqual(Buffer.from('external before apply'));
	});

	it('rechecks cancellation after the live artwork read and before applying bytes', async () => {
		const planned = operation({ id: 'cancelled-during-live-read' });
		const beforeArtwork = artwork('prepared prior', 'prepared-prior');
		planned.current.fingerprint = sha256Bytes(beforeArtwork.data);
		let releaseLiveRead!: () => void;
		let signalLiveReadStarted!: () => void;
		const liveReadStarted = new Promise<void>((resolve) => {
			signalLiveReadStarted = resolve;
		});
		const liveReadReleased = new Promise<void>((resolve) => {
			releaseLiveRead = resolve;
		});
		let readCount = 0;
		let cancelled = false;
		const applyPosterBytes = vi.fn(async () => undefined);
		const server = {
			readArtwork: vi.fn(async () => {
				readCount += 1;
				if (readCount === 2) {
					signalLiveReadStarted();
					await liveReadReleased;
				}
				return beforeArtwork;
			}),
			applyPosterBytes
		} as unknown as MediaServer;
		const subject = coordinator();

		await subject.prepareOperation(planned, { server });
		const pending = subject.executeServerOperation(planned, {
			server,
			isCancelled: () => cancelled
		});
		await liveReadStarted;
		cancelled = true;
		releaseLiveRead();

		await expect(pending).rejects.toThrow('cancelled');
		expect(applyPosterBytes).not.toHaveBeenCalled();
	});

	it('uses the exact typed movie file/id and records destination provenance on every snapshot and revision', async () => {
		const subject = coordinator();
		const planned = operation({
			id: 'kometa-absent-present',
			destination: 'kometa',
			tmdbId: '101'
		});
		const typedDestination = planned.kometaDestination!;
		const showSentinel = 'metadata:\n  101:\n    url_poster: https://show.invalid/keep.jpg\n';
		const legacySentinel = 'metadata:\n  101:\n    url_poster: https://legacy.invalid/keep.jpg\n';
		await writeFile(join(kometaDirectory, SHOW_FILENAME), showSentinel, 'utf8');
		await writeFile(join(kometaDirectory, LEGACY_FILENAME), legacySentinel, 'utf8');

		await subject.prepareOperation(planned, {});
		await writeFile(
			join(kometaDirectory, MOVIE_FILENAME),
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
		expect(typedDestination).toMatchObject({
			version: 2,
			mediaKind: 'movie',
			namespace: 'tmdb',
			mappingId: '101',
			filename: MOVIE_FILENAME
		});
		expect(planned.targetId).toBe(typedDestination.key);
		expect(rows).toHaveLength(3);
		expect(original?.id).not.toBe(prior?.id);
		expect(original).toMatchObject({
			state: 'absent',
			value: null,
			metadata: { kometaDestination: typedDestination },
			isOriginal: true
		});
		expect(prior).toMatchObject({
			state: 'absent',
			value: null,
			metadata: { kometaDestination: typedDestination }
		});
		expect(after).toMatchObject({
			state: 'present',
			value: { state: 'present', url: planned.selection.url },
			metadata: { kometaDestination: typedDestination }
		});
		expect(revision).toMatchObject({
			outcome: 'success',
			verification: 'exact',
			provenance: { kometaDestination: typedDestination }
		});
		expect(await readFile(join(kometaDirectory, SHOW_FILENAME), 'utf8')).toBe(showSentinel);
		expect(await readFile(join(kometaDirectory, LEGACY_FILENAME), 'utf8')).toBe(legacySentinel);
	});

	it('blocks a Kometa write when the managed slot changes after preparation', async () => {
		const subject = coordinator();
		const planned = operation({ id: 'stale-kometa', destination: 'kometa', tmdbId: '101' });
		await subject.prepareOperation(planned, {});
		await writeFile(
			join(kometaDirectory, MOVIE_FILENAME),
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

	it('invalidates the whole typed file when only a sibling entry changes after preparation', async () => {
		const initial = `metadata:
  101:
    url_poster: https://images.invalid/current.jpg
  202:
    url_poster: https://images.invalid/sibling-before.jpg
`;
		const changedSibling = initial.replace('sibling-before.jpg', 'sibling-after.jpg');
		await writeFile(join(kometaDirectory, MOVIE_FILENAME), initial, 'utf8');
		const planned = operation({
			id: 'kometa-whole-file-cas',
			destination: 'kometa',
			tmdbId: '101',
			kometaRaw: initial
		});
		const subject = coordinator();

		await subject.prepareOperation(planned, {});
		expect(() => subject.assertKometaFresh([planned], initial)).not.toThrow();
		expect(() => subject.assertKometaFresh([planned], changedSibling)).toThrow(
			/Frozen Kometa metadata file changed/
		);
	});

	it('revalidates the frozen collision guard immediately before a typed write', async () => {
		const planned = operation({
			id: 'kometa-guard-cas',
			destination: 'kometa',
			tmdbId: '101'
		});
		const typedDestinationFingerprint = planned.current.destinationFingerprint;
		planned.current.destinationFingerprint = hashCanonicalJson({
			typedDestinationFingerprint,
			collisionGuardFingerprint: 'guard-v1'
		});
		const subject = coordinator();
		await subject.prepareOperation(planned, {});

		expect(() =>
			subject.assertKometaGuardFresh([planned], {
				migrationRequired: false,
				fingerprint: 'guard-v1'
			})
		).not.toThrow();
		expect(() =>
			subject.assertKometaGuardFresh([planned], {
				migrationRequired: false,
				fingerprint: 'guard-v2'
			})
		).toThrow(/collision guard changed/);
		expect(() =>
			subject.assertKometaGuardFresh([planned], {
				migrationRequired: true,
				fingerprint: 'guard-v1'
			})
		).toThrow(/requires migration/);
	});

	it('releases Kometa entries after each outcome without breaking the remaining sequence', async () => {
		const subject = coordinator();
		const poster = operation({
			id: 'kometa-sequence-poster',
			destination: 'kometa',
			kind: 'poster',
			tmdbId: '101'
		});
		const background = operation({
			id: 'kometa-sequence-background',
			destination: 'kometa',
			kind: 'background',
			tmdbId: '101'
		});
		await subject.prepareOperation(poster, {});
		await subject.prepareOperation(background, {});
		const raw = `metadata:\n  101:\n    url_poster: ${poster.selection.url}\n    url_background: ${background.selection.url}\n`;
		await writeFile(join(kometaDirectory, MOVIE_FILENAME), raw, 'utf8');

		expect(() => subject.assertKometaFresh([poster, background], null)).not.toThrow();
		await subject.recordOutcome(poster, successfulWrite(poster), {});
		expect(() => subject.assertKometaFresh([poster], null)).toThrow('not prepared');
		expect(() => subject.assertKometaFresh([background], null)).not.toThrow();
		await subject.recordOutcome(background, successfulWrite(background), {});
		expect(() => subject.assertKometaFresh([background], null)).toThrow('not prepared');
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
		await expect(subject.executeServerOperation(exact, { server: exactServer })).rejects.toThrow(
			'not prepared'
		);
		await subject.prepareOperation(mismatch, { server: mismatchServer });
		const mismatchResult = await subject.recordOutcome(mismatch, successfulWrite(mismatch), {
			server: mismatchServer
		});
		await expect(
			subject.executeServerOperation(mismatch, { server: mismatchServer })
		).rejects.toThrow('not prepared');

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

describe('preflightServerArtwork', () => {
	it('uses the strict provider allowlist for the initial URL and every redirect hop', async () => {
		const initialFetch = vi.fn<RemoteArtworkFetch>();
		await expect(
			preflightServerArtwork('https://artwork.example/not-really-tmdb.jpg', 'tmdb', initialFetch)
		).rejects.toMatchObject({ code: 'remote_artwork_target_not_allowed' });
		expect(initialFetch).not.toHaveBeenCalled();

		const redirectFetch = vi.fn<RemoteArtworkFetch>(
			async () =>
				new Response(null, {
					status: 302,
					headers: { location: 'https://artwork.example/pivot.jpg' }
				})
		);
		await expect(
			preflightServerArtwork(
				'https://image.tmdb.org/t/p/original/poster.jpg',
				'tmdb',
				redirectFetch
			)
		).rejects.toMatchObject({ code: 'remote_artwork_target_not_allowed' });
		expect(redirectFetch).toHaveBeenCalledOnce();
	});

	it.each([
		{ label: 'custom', provider: 'custom' },
		{ label: 'providerless legacy', provider: null }
	])('preserves $label URLs under the safe custom redirect policy', async ({ provider }) => {
		const fetchImpl = vi.fn<RemoteArtworkFetch>(
			async () =>
				new Response(new Uint8Array([1, 2, 3]), {
					headers: { 'content-type': 'image/jpeg' }
				})
		);

		await expect(
			preflightServerArtwork('http://legacy-artwork.example/poster.jpg', provider, fetchImpl)
		).resolves.toEqual({
			bytes: new Uint8Array([1, 2, 3]).buffer,
			contentType: 'image/jpeg'
		});
		expect(fetchImpl).toHaveBeenCalledOnce();
	});

	it('fails closed for unknown provider provenance', async () => {
		const fetchImpl = vi.fn<RemoteArtworkFetch>();
		await expect(
			preflightServerArtwork(
				'https://legacy-artwork.example/poster.jpg',
				'unknown-provider',
				fetchImpl
			)
		).rejects.toMatchObject({ code: 'remote_artwork_target_not_allowed' });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it.each([
		{
			label: 'an invalid MIME type',
			response: () =>
				new Response(new Uint8Array([1]), { headers: { 'content-type': 'text/html' } }),
			code: 'remote_artwork_content_type_invalid'
		},
		{
			label: 'an oversized body',
			response: () =>
				new Response(new Uint8Array([1]), {
					headers: {
						'content-type': 'image/jpeg',
						'content-length': String(50 * 1024 * 1024 + 1)
					}
				}),
			code: 'remote_artwork_too_large'
		}
	])('propagates $label as a failed preflight', async ({ response, code }) => {
		await expect(
			preflightServerArtwork('https://image.tmdb.org/t/p/original/poster.jpg', 'tmdb', async () =>
				response()
			)
		).rejects.toMatchObject({ code });
	});

	it('does not swallow bounded downloader errors or expose a signed source URL', async () => {
		const failure = new RemoteArtworkDownloadError('remote_artwork_timeout');
		const signedUrl =
			'https://image.tmdb.org/t/p/original/poster.jpg?api_key=should-never-be-reported';
		const error = await preflightServerArtwork(signedUrl, 'tmdb', async () => {
			throw failure;
		}).catch((caught: unknown) => caught);

		expect(error).toBe(failure);
		expect(String(error)).not.toContain('should-never-be-reported');
		expect(String(error)).not.toContain(signedUrl);
	});
});

describe('trustedProviderArtworkUrl', () => {
	it('trusts each provider only on its actual asset hosts', () => {
		expect(trustedProviderArtworkUrl('https://api.mediux.pro/assets/1', 'mediux')).toBe(true);
		expect(trustedProviderArtworkUrl('https://image.tmdb.org/t/p/original/1.jpg', 'tmdb')).toBe(
			true
		);
		expect(trustedProviderArtworkUrl('https://assets.fanart.tv/fanart/1.jpg', 'fanarttv')).toBe(
			true
		);
	});

	it('trusts the ThePosterDB CDN, where set-page candidates actually live', () => {
		// Regression: set-page candidates are stored on images.theposterdb.com — an
		// allowlist with only the apex hosts silently drops every ThePosterDB apply.
		expect(
			trustedProviderArtworkUrl(
				'https://images.theposterdb.com/prod/public/images/posters/optimized/movies/1/a.jpg',
				'theposterdb'
			)
		).toBe(true);
		// The apex hosts stay trusted for the legacy /api/assets fallback candidates.
		expect(trustedProviderArtworkUrl('https://theposterdb.com/api/assets/1', 'theposterdb')).toBe(
			true
		);
		expect(
			trustedProviderArtworkUrl('https://www.theposterdb.com/api/assets/1', 'theposterdb')
		).toBe(true);
	});

	it('rejects mismatched providers, non-https, and unknown providers', () => {
		expect(trustedProviderArtworkUrl('https://image.tmdb.org/t/p/original/1.jpg', 'mediux')).toBe(
			false
		);
		expect(trustedProviderArtworkUrl('http://api.mediux.pro/assets/1', 'mediux')).toBe(false);
		expect(trustedProviderArtworkUrl('https://api.mediux.pro/assets/1', 'unknown')).toBe(false);
		expect(trustedProviderArtworkUrl('https://api.mediux.pro/assets/1', null)).toBe(false);
		expect(trustedProviderArtworkUrl('not-a-url', 'mediux')).toBe(false);
	});

	it('rejects embedded credentials and non-default ports on trusted hosts', () => {
		expect(trustedProviderArtworkUrl('https://user:secret@image.tmdb.org/a.jpg', 'tmdb')).toBe(
			false
		);
		expect(trustedProviderArtworkUrl('https://image.tmdb.org:8443/a.jpg', 'tmdb')).toBe(false);
		expect(trustedProviderArtworkUrl('https://image.tmdb.org.evil.test/a.jpg', 'tmdb')).toBe(false);
	});
});
