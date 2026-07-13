import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '$lib/server/db/schema';
import type { MediaServer, ServerArtwork } from '$lib/server/media-server';
import type { ApplyServerRegistry } from '$lib/server/plans/apply-server-registry';
import { hashCanonicalJson } from '$lib/server/plans/canonical-json';
import { sha256Bytes } from '$lib/server/revisions/verification';
import {
	ArtworkUndoPlannerError,
	confirmArtworkUndoPlan,
	createArtworkUndoPlanner,
	type UndoOperationPlanStore,
	type UndoStoredOperationPlan
} from './undo-planner';
import { UNDO_PLAN_KIND, type UndoPlanPayloadV1, type UndoPlanScope } from './undo-plan';

const PLANNED_AT = new Date('2026-07-11T12:00:00.000Z');
const CREATED_AT = new Date('2026-07-11T11:00:00.000Z');
const PRESENT_SHA = sha256Bytes(Uint8Array.of(1, 2, 3));

let client: Client;
let database: ReturnType<typeof drizzle<typeof schema>>;

class MemoryPlanStore implements UndoOperationPlanStore {
	plans: UndoStoredOperationPlan<unknown>[] = [];
	validateCalls = 0;
	consumeCalls = 0;

	async create<T>(input: {
		kind: string;
		payload: T;
		serverInstanceId?: string | null;
		ttlMs?: number;
	}): Promise<UndoStoredOperationPlan<T>> {
		const plan: UndoStoredOperationPlan<T> = {
			id: `undo-plan-${this.plans.length + 1}`,
			kind: input.kind,
			serverInstanceId: input.serverInstanceId ?? null,
			payload: input.payload,
			digest: hashCanonicalJson(input.payload),
			expiresAt: new Date(PLANNED_AT.getTime() + (input.ttlMs ?? 900_000)),
			consumedAt: null
		};
		this.plans.push(plan);
		return plan;
	}

	async validate<T = unknown>(
		id: string,
		expectations: {
			kind?: string;
			digest?: string;
			payload?: unknown;
			serverInstanceId?: string | null;
		} = {}
	): Promise<UndoStoredOperationPlan<T>> {
		this.validateCalls++;
		const index = this.plans.findIndex((candidate) => candidate.id === id);
		if (index < 0) throw new Error('plan_not_found');
		const plan = this.plans[index];
		if (plan.consumedAt) throw new Error('plan_consumed');
		if (expectations.kind !== undefined && expectations.kind !== plan.kind) {
			throw new Error('plan_kind_mismatch');
		}
		if (expectations.digest !== undefined && expectations.digest !== plan.digest) {
			throw new Error('plan_digest_mismatch');
		}
		if (
			Object.hasOwn(expectations, 'serverInstanceId') &&
			expectations.serverInstanceId !== plan.serverInstanceId
		) {
			throw new Error('plan_scope_mismatch');
		}
		if (
			Object.hasOwn(expectations, 'payload') &&
			hashCanonicalJson(expectations.payload) !== plan.digest
		) {
			throw new Error('plan_payload_mismatch');
		}
		return plan as UndoStoredOperationPlan<T>;
	}

	async consume<T = unknown>(
		id: string,
		expectations: {
			kind?: string;
			digest?: string;
			payload?: unknown;
			serverInstanceId?: string | null;
		} = {}
	): Promise<UndoStoredOperationPlan<T>> {
		this.consumeCalls++;
		const plan = await this.validate<T>(id, expectations);
		const index = this.plans.findIndex((candidate) => candidate.id === id);
		const consumed = { ...plan, consumedAt: new Date(PLANNED_AT) };
		this.plans[index] = consumed;
		return consumed;
	}
}

interface TestServerOptions {
	instanceId?: string | null;
	read?: (targetId: string, kind: 'poster' | 'background') => Promise<ServerArtwork | null>;
}

function testServer(options: TestServerOptions = {}) {
	const readArtwork = vi.fn(
		options.read ??
			(async (targetId: string, kind: 'poster' | 'background') => ({
				kind,
				url: `https://live.invalid/${targetId}`,
				identity: `identity-${targetId}`,
				data: Uint8Array.from(targetId, (character) => character.charCodeAt(0)).buffer,
				contentType: 'image/jpeg'
			}))
	);
	const listSeasons = vi.fn(async () => [
		{
			id: 'season-target-1',
			number: 1,
			currentPosterUrl: null,
			currentBackgroundUrl: null,
			serverUpdatedAt: null
		}
	]);
	const listEpisodes = vi.fn(async () => [
		{
			id: 'episode-target-2',
			number: 2,
			currentPosterUrl: null,
			currentBackgroundUrl: null,
			serverUpdatedAt: null
		}
	]);
	const server = {
		type: 'plex',
		identity: { instanceId: options.instanceId ?? 'server-a', name: 'A', type: 'plex' },
		capabilities: {},
		listSeasons,
		listEpisodes,
		readArtwork,
		readCollectionArtwork: readArtwork
	} as unknown as MediaServer;
	return { server, readArtwork, listSeasons, listEpisodes };
}

function registryFor(server: MediaServer, bindingId = 'server-a') {
	const resolve = vi.fn(async () => ({
		serverInstanceId: bindingId,
		server,
		fingerprint: 'f'.repeat(64)
	}));
	return { registry: { resolve } satisfies ApplyServerRegistry, resolve };
}

function seconds(value: Date): number {
	return Math.floor(value.getTime() / 1000);
}

async function execute(sql: string, args: Array<string | number | null> = []) {
	await client.execute({ sql, args });
}

async function addItem(
	id: number,
	serverInstanceId = 'server-a',
	overrides: { ratingKey?: string; tmdbId?: string | null; artworkVersion?: number } = {}
) {
	await execute(
		'INSERT INTO media_items (id, server_instance_id, rating_key, tmdb_id, artwork_version) VALUES (?, ?, ?, ?, ?)',
		[
			id,
			serverInstanceId,
			overrides.ratingKey ?? `root-${id}`,
			overrides.tmdbId === undefined ? String(100 + id) : overrides.tmdbId,
			overrides.artworkVersion ?? 3
		]
	);
}

interface AddRevisionInput {
	id: string;
	serverInstanceId?: string;
	groupId?: string;
	mediaItemId?: number | null;
	mediaCollectionId?: string | null;
	destination?: 'server' | 'kometa';
	kind?: 'poster' | 'background' | 'title_card';
	season?: number | null;
	episode?: number | null;
	snapshotState?: 'present' | 'absent' | 'unavailable';
	snapshotSha?: string | null;
	snapshotPath?: string | null;
	snapshotValue?: unknown;
	action?: 'apply' | 'undo' | 'external_observation';
	undoOfRevisionId?: string | null;
	createdAt?: Date;
}

async function addRevision(input: AddRevisionInput) {
	const serverInstanceId = input.serverInstanceId ?? 'server-a';
	const mediaItemId = input.mediaItemId === undefined ? 1 : input.mediaItemId;
	const mediaCollectionId = input.mediaCollectionId ?? null;
	const destination = input.destination ?? 'server';
	const kind = input.kind ?? 'poster';
	const season = input.season ?? null;
	const episode = input.episode ?? null;
	const snapshotId = `snapshot-${input.id}`;
	const snapshotState = input.snapshotState ?? 'present';
	const snapshotValue =
		input.snapshotValue === undefined && destination === 'kometa' && snapshotState === 'present'
			? { state: 'present', url: 'https://secret.invalid/prior.jpg?token=never-public' }
			: input.snapshotValue;
	await execute(
		`INSERT INTO artwork_snapshots
		 (id, server_instance_id, media_item_id, media_collection_id, destination, kind, season, episode, state, sha256, storage_path, value)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			snapshotId,
			serverInstanceId,
			mediaItemId,
			mediaCollectionId,
			destination,
			kind,
			season,
			episode,
			snapshotState,
			input.snapshotSha === undefined && destination === 'server' && snapshotState === 'present'
				? PRESENT_SHA
				: (input.snapshotSha ?? null),
			input.snapshotPath === undefined && destination === 'server' && snapshotState === 'present'
				? `/private/data/${snapshotId}`
				: (input.snapshotPath ?? null),
			snapshotValue === undefined ? null : JSON.stringify(snapshotValue)
		]
	);
	await execute(
		`INSERT INTO artwork_revisions
		 (id, group_id, server_instance_id, media_item_id, media_collection_id, undo_of_revision_id, before_snapshot_id,
		  action, destination, kind, season, episode, outcome, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'success', ?)`,
		[
			input.id,
			input.groupId ?? 'group-main',
			serverInstanceId,
			mediaItemId,
			mediaCollectionId,
			input.undoOfRevisionId ?? null,
			snapshotId,
			input.action ?? 'apply',
			destination,
			kind,
			season,
			episode,
			seconds(input.createdAt ?? CREATED_AT)
		]
	);
}

async function addSlotVersion(input: {
	mediaItemId: number;
	kind: 'poster' | 'background' | 'title_card';
	season?: number | null;
	episode?: number | null;
	artworkVersion: number;
}) {
	await execute(
		`INSERT INTO artwork_slot_states
		 (server_instance_id, media_item_id, media_collection_id, kind, season, episode, artwork_version)
		 VALUES ('server-a', ?, NULL, ?, ?, ?, ?)`,
		[
			input.mediaItemId,
			input.kind,
			input.season ?? null,
			input.episode ?? null,
			input.artworkVersion
		]
	);
}

async function seedScopedRevisions() {
	await addItem(1);
	await addItem(2);
	await addRevision({ id: 'rev-root-server', createdAt: new Date('2026-07-11T11:06:00Z') });
	await addRevision({
		id: 'rev-root-kometa',
		destination: 'kometa',
		createdAt: new Date('2026-07-11T11:05:00Z')
	});
	await addRevision({
		id: 'rev-season',
		season: 1,
		createdAt: new Date('2026-07-11T11:04:00Z')
	});
	await addRevision({
		id: 'rev-episode',
		kind: 'title_card',
		season: 1,
		episode: 2,
		createdAt: new Date('2026-07-11T11:03:00Z')
	});
	await addRevision({
		id: 'rev-other-item',
		mediaItemId: 2,
		createdAt: new Date('2026-07-11T11:02:00Z')
	});
}

function planner(
	options: {
		server?: ReturnType<typeof testServer>;
		bindingId?: string;
		readKometa?: (serverInstanceId: string) => Promise<string | null | undefined>;
		store?: MemoryPlanStore;
	} = {}
) {
	const server = options.server ?? testServer();
	const bound = registryFor(server.server, options.bindingId);
	const store = options.store ?? new MemoryPlanStore();
	const readKometa =
		options.readKometa ??
		vi.fn(
			async () =>
				'metadata:\n  101:\n    url_poster: https://live.invalid/current.jpg?token=secret\n'
		);
	const dependencies = {
		database,
		serverRegistry: bound.registry,
		readKometa,
		planStore: store,
		clock: () => new Date(PLANNED_AT)
	};
	return {
		createPreview: createArtworkUndoPlanner(dependencies),
		dependencies,
		server,
		resolve: bound.resolve,
		readKometa,
		store
	};
}

beforeAll(async () => {
	client = createClient({ url: ':memory:' });
	database = drizzle(client, { schema });
	await client.batch(
		[
			`CREATE TABLE media_items (
			 id INTEGER PRIMARY KEY, server_instance_id TEXT NOT NULL, rating_key TEXT NOT NULL,
			 tmdb_id TEXT, artwork_version INTEGER NOT NULL
			)`,
			`CREATE TABLE media_collections (
			 id TEXT PRIMARY KEY, server_instance_id TEXT NOT NULL, source TEXT NOT NULL, source_id TEXT NOT NULL
			)`,
			`CREATE TABLE artwork_slot_states (
			 id INTEGER PRIMARY KEY AUTOINCREMENT, server_instance_id TEXT NOT NULL, media_item_id INTEGER,
			 media_collection_id TEXT, kind TEXT NOT NULL, season INTEGER, episode INTEGER,
			 artwork_version INTEGER NOT NULL
			)`,
			`CREATE TABLE artwork_snapshots (
			 id TEXT PRIMARY KEY, server_instance_id TEXT NOT NULL, media_item_id INTEGER,
			 media_collection_id TEXT, destination TEXT NOT NULL, kind TEXT NOT NULL,
			 season INTEGER, episode INTEGER, state TEXT NOT NULL, sha256 TEXT,
			 storage_path TEXT, value TEXT
			)`,
			`CREATE TABLE artwork_revisions (
			 id TEXT PRIMARY KEY, group_id TEXT NOT NULL, server_instance_id TEXT NOT NULL,
			 media_item_id INTEGER, media_collection_id TEXT, undo_of_revision_id TEXT,
			 before_snapshot_id TEXT, action TEXT NOT NULL, destination TEXT NOT NULL,
			 kind TEXT NOT NULL, season INTEGER, episode INTEGER, outcome TEXT NOT NULL,
			 created_at INTEGER NOT NULL
			)`
		],
		'write'
	);
});

beforeEach(async () => {
	for (const table of [
		'artwork_revisions',
		'artwork_snapshots',
		'artwork_slot_states',
		'media_collections',
		'media_items'
	]) {
		await client.execute(`DELETE FROM ${table}`);
	}
});

describe('artwork undo planner scopes', () => {
	it.each([
		[
			'revision',
			{ kind: 'revision', serverInstanceId: 'server-a', revisionId: 'rev-root-kometa' },
			['rev-root-kometa']
		],
		[
			'slot',
			{
				kind: 'slot',
				serverInstanceId: 'server-a',
				target: { kind: 'item', mediaItemId: 1 },
				slot: { kind: 'poster', season: null, episode: null }
			},
			['rev-root-server', 'rev-root-kometa']
		],
		[
			'season',
			{ kind: 'season', serverInstanceId: 'server-a', mediaItemId: 1, season: 1 },
			['rev-season', 'rev-episode']
		],
		[
			'item',
			{ kind: 'item', serverInstanceId: 'server-a', mediaItemId: 1 },
			['rev-root-server', 'rev-season', 'rev-episode', 'rev-root-kometa']
		],
		[
			'destination',
			{
				kind: 'destination',
				serverInstanceId: 'server-a',
				target: { kind: 'item', mediaItemId: 1 },
				destination: 'server'
			},
			['rev-root-server', 'rev-season', 'rev-episode']
		],
		[
			'group',
			{ kind: 'group', serverInstanceId: 'server-a', revisionGroupId: 'group-main' },
			['rev-root-server', 'rev-season', 'rev-episode', 'rev-root-kometa', 'rev-other-item']
		]
	] as Array<[string, UndoPlanScope, string[]]>)(
		'queries and materializes the exact %s scope',
		async (_label, scope, expected) => {
			await seedScopedRevisions();
			const { createPreview } = planner();
			const preview = await createPreview({ scope });

			expect(preview.operations.map((operation) => operation.revisionId)).toEqual(expected);
			expect(preview.scope).toEqual(scope);
		}
	);
});

describe('live destination materialization', () => {
	it('materializes a native collection target through its exact provider id and slot version', async () => {
		await execute(
			"INSERT INTO media_collections (id, server_instance_id, source, source_id) VALUES ('collection-a', 'server-a', 'native', 'native-77')"
		);
		await addRevision({
			id: 'rev-native-collection',
			mediaItemId: null,
			mediaCollectionId: 'collection-a'
		});
		await execute(
			`INSERT INTO artwork_slot_states
			 (server_instance_id, media_item_id, media_collection_id, kind, season, episode, artwork_version)
			 VALUES ('server-a', NULL, 'collection-a', 'poster', NULL, NULL, 6)`
		);
		const runtime = planner();
		const preview = await runtime.createPreview({
			scope: {
				kind: 'destination',
				serverInstanceId: 'server-a',
				target: { kind: 'collection', mediaCollectionId: 'collection-a' },
				destination: 'server'
			}
		});

		expect(preview.operations[0]).toMatchObject({
			target: { kind: 'collection', mediaCollectionId: 'collection-a' },
			destination: 'server',
			current: { state: 'present', artworkVersion: 6 }
		});
		const payload = runtime.store.plans[0].payload as UndoPlanPayloadV1;
		expect(payload.operations[0].targetId).toBe('native-77');
		expect(runtime.server.readArtwork).toHaveBeenCalledWith('native-77', 'poster');
	});

	it('re-resolves season and episode target ids by number and loads exact slot versions', async () => {
		await addItem(1, 'server-a', { artworkVersion: 4 });
		await addRevision({ id: 'rev-root' });
		await addRevision({ id: 'rev-season', season: 1 });
		await addRevision({ id: 'rev-episode', kind: 'title_card', season: 1, episode: 2 });
		await addSlotVersion({ mediaItemId: 1, kind: 'poster', season: 1, artworkVersion: 8 });
		await addSlotVersion({
			mediaItemId: 1,
			kind: 'title_card',
			season: 1,
			episode: 2,
			artworkVersion: 9
		});
		const runtime = planner();
		const preview = await runtime.createPreview({
			scope: { kind: 'item', serverInstanceId: 'server-a', mediaItemId: 1 }
		});

		expect(runtime.server.listSeasons).toHaveBeenCalledWith('root-1');
		expect(runtime.server.listEpisodes).toHaveBeenCalledWith('season-target-1');
		expect(runtime.server.readArtwork).toHaveBeenCalledTimes(3);
		expect(runtime.server.readArtwork.mock.calls.map(([id]) => id)).toEqual(
			expect.arrayContaining(['root-1', 'season-target-1', 'episode-target-2'])
		);
		expect(preview.operations.map((operation) => operation.current.artworkVersion)).toEqual([
			4, 8, 9
		]);
		const payload = runtime.store.plans[0].payload as UndoPlanPayloadV1;
		expect(payload.operations.map((operation) => operation.targetId)).toEqual([
			'root-1',
			'season-target-1',
			'episode-target-2'
		]);
		expect(
			payload.operations.every((operation) => operation.current.fingerprint?.length === 64)
		).toBe(true);
	});

	it('reads and fingerprints the exact Kometa slot without exposing its raw URL', async () => {
		await addItem(1);
		await addRevision({ id: 'rev-kometa', destination: 'kometa' });
		const readKometa = vi.fn(
			async () =>
				'metadata:\n  101:\n    url_poster: https://host.invalid/current.jpg?token=ultra-secret\n'
		);
		const runtime = planner({ readKometa });
		const preview = await runtime.createPreview({
			scope: { kind: 'revision', serverInstanceId: 'server-a', revisionId: 'rev-kometa' }
		});

		expect(readKometa).toHaveBeenCalledWith('server-a');
		expect(preview.operations[0]).toMatchObject({
			destination: 'kometa',
			current: { state: 'present' },
			snapshot: { state: 'present', restorable: true }
		});
		const payload = runtime.store.plans[0].payload as UndoPlanPayloadV1;
		expect(payload.operations[0]).toMatchObject({
			targetId: 'kometa:101',
			current: { state: 'present', fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) },
			snapshot: { state: 'present', fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) }
		});
		expect(JSON.stringify(preview)).not.toMatch(/https?:|token|ultra-secret/i);
		expect(JSON.stringify(payload)).not.toMatch(/https?:|token|ultra-secret/i);
	});

	it('classifies genuine absence and unavailable reads/snapshots independently', async () => {
		await addItem(1);
		await addItem(2);
		await addRevision({ id: 'rev-absent', mediaItemId: 1, snapshotState: 'absent' });
		await addRevision({ id: 'rev-unavailable', mediaItemId: 2, snapshotState: 'unavailable' });
		const server = testServer({
			read: async (targetId) => {
				if (targetId === 'root-1') return null;
				throw new Error('provider cannot read current artwork');
			}
		});
		const runtime = planner({ server });
		const preview = await runtime.createPreview({
			scope: { kind: 'group', serverInstanceId: 'server-a', revisionGroupId: 'group-main' }
		});

		expect(preview.operations).toEqual([
			expect.objectContaining({
				revisionId: 'rev-absent',
				current: { state: 'absent', artworkVersion: 3 },
				snapshot: { state: 'absent', restorable: true }
			}),
			expect.objectContaining({
				revisionId: 'rev-unavailable',
				current: { state: 'unavailable', artworkVersion: 3 },
				snapshot: { state: 'unavailable', restorable: false }
			})
		]);
		expect(preview.summary).toMatchObject({
			actionableCount: 1,
			unavailableCount: 1,
			restoreStates: { present: 0, absent: 1, unavailable: 1 }
		});
	});
});

describe('scope safety and persisted plan boundary', () => {
	it('does not find a revision through the wrong server scope', async () => {
		await addItem(1, 'server-b');
		await addRevision({ id: 'rev-b', serverInstanceId: 'server-b' });
		const runtime = planner();

		await expect(
			runtime.createPreview({
				scope: { kind: 'revision', serverInstanceId: 'server-a', revisionId: 'rev-b' }
			})
		).rejects.toMatchObject({ code: 'undo_scope_not_found' });
		expect(runtime.resolve).not.toHaveBeenCalled();
		expect(runtime.store.plans).toEqual([]);
	});

	it('rejects a registry binding or provider identity for another named server', async () => {
		await addItem(1);
		await addRevision({ id: 'rev-a' });
		const wrongBinding = planner({ bindingId: 'server-b' });
		await expect(
			wrongBinding.createPreview({
				scope: { kind: 'revision', serverInstanceId: 'server-a', revisionId: 'rev-a' }
			})
		).rejects.toMatchObject({ code: 'server_scope_mismatch' });
		expect(wrongBinding.store.plans).toEqual([]);

		const wrongIdentity = planner({ server: testServer({ instanceId: 'server-b' }) });
		await expect(
			wrongIdentity.createPreview({
				scope: { kind: 'revision', serverInstanceId: 'server-a', revisionId: 'rev-a' }
			})
		).rejects.toMatchObject({ code: 'server_scope_mismatch' });
		expect(wrongIdentity.store.plans).toEqual([]);
	});

	it('rejects an individually selected revision that already has a successful undo', async () => {
		await addItem(1);
		await addRevision({ id: 'rev-original' });
		await addRevision({
			id: 'rev-undo',
			action: 'undo',
			undoOfRevisionId: 'rev-original',
			createdAt: new Date('2026-07-11T11:30:00Z')
		});
		const runtime = planner();

		await expect(
			runtime.createPreview({
				scope: {
					kind: 'revision',
					serverInstanceId: 'server-a',
					revisionId: 'rev-original'
				}
			})
		).rejects.toMatchObject({
			code: 'revision_already_undone',
			recordId: 'rev-original'
		});
		expect(runtime.store.plans).toEqual([]);
	});

	it('excludes already restored revisions from a group undo preview', async () => {
		await addItem(1);
		await addRevision({ id: 'rev-restored', createdAt: new Date('2026-07-11T11:01:00Z') });
		await addRevision({
			id: 'rev-pending',
			kind: 'background',
			createdAt: new Date('2026-07-11T11:02:00Z')
		});
		await addRevision({
			id: 'rev-undo',
			groupId: 'group-undo',
			action: 'undo',
			undoOfRevisionId: 'rev-restored',
			createdAt: new Date('2026-07-11T11:30:00Z')
		});
		const runtime = planner();

		const preview = await runtime.createPreview({
			scope: {
				kind: 'group',
				serverInstanceId: 'server-a',
				revisionGroupId: 'group-main'
			}
		});

		expect(preview.operations.map((operation) => operation.revisionId)).toEqual(['rev-pending']);
	});

	it('persists an exact artwork_undo plan while the public preview redacts live/snapshot internals', async () => {
		await addItem(1, 'server-a', { ratingKey: 'provider-target-private' });
		await addRevision({ id: 'rev-redacted' });
		const runtime = planner();
		const preview = await runtime.createPreview({
			scope: {
				kind: 'revision',
				serverInstanceId: 'server-a',
				revisionId: 'rev-redacted'
			},
			ttlMs: 60_000
		});
		const stored = runtime.store.plans[0] as UndoStoredOperationPlan<UndoPlanPayloadV1>;

		expect(stored).toMatchObject({
			id: preview.planId,
			kind: UNDO_PLAN_KIND,
			serverInstanceId: 'server-a',
			digest: preview.digest,
			consumedAt: null
		});
		expect(stored.payload.operations[0].targetId).toBe('provider-target-private');
		expect(preview.operations[0]).not.toHaveProperty('targetId');
		expect(preview.operations[0].current).not.toHaveProperty('fingerprint');
		expect(preview.operations[0].snapshot).not.toHaveProperty('fingerprint');
		expect(JSON.stringify(preview)).not.toMatch(
			/https?:|storagePath|storage_path|private\/data|"value"|bytes|secret|token/i
		);
		expect(JSON.stringify(stored.payload)).not.toMatch(
			/https?:|storagePath|storage_path|private\/data|"value"|bytes|secret|token/i
		);

		await runtime.store.consume(preview.planId, {
			kind: UNDO_PLAN_KIND,
			digest: preview.digest,
			payload: stored.payload,
			serverInstanceId: 'server-a'
		});
		await expect(runtime.store.consume(preview.planId)).rejects.toThrow('plan_consumed');
	});

	it('fails closed when a before snapshot belongs to another server or slot', async () => {
		await addItem(1);
		await addRevision({ id: 'rev-corrupt' });
		await execute(
			"UPDATE artwork_snapshots SET server_instance_id = 'server-b' WHERE id = 'snapshot-rev-corrupt'"
		);
		const runtime = planner();
		await expect(
			runtime.createPreview({
				scope: { kind: 'revision', serverInstanceId: 'server-a', revisionId: 'rev-corrupt' }
			})
		).rejects.toMatchObject({
			code: 'snapshot_scope_mismatch',
			recordId: 'snapshot-rev-corrupt'
		});
		expect(runtime.store.plans).toEqual([]);
	});
});

describe('artwork undo confirmation freshness', () => {
	it('revalidates the exact materialized state and consumes the existing plan once', async () => {
		await addItem(1);
		await addRevision({ id: 'rev-confirm' });
		const runtime = planner();
		const scope = {
			kind: 'revision',
			serverInstanceId: 'server-a',
			revisionId: 'rev-confirm'
		} as const;
		const preview = await runtime.createPreview({ scope });
		const confirmed = await confirmArtworkUndoPlan(
			{
				planId: preview.planId,
				digest: preview.digest,
				serverInstanceId: 'server-a',
				scope
			},
			runtime.dependencies
		);

		expect(confirmed).toMatchObject({
			planId: preview.planId,
			digest: preview.digest,
			payload: { type: UNDO_PLAN_KIND, scope }
		});
		expect(runtime.store.plans).toHaveLength(1);
		expect(runtime.store.plans[0].consumedAt).toEqual(PLANNED_AT);
		expect(runtime.store.consumeCalls).toBe(1);
	});

	it('rejects changed live artwork without consuming the plan', async () => {
		await addItem(1);
		await addRevision({ id: 'rev-live-change' });
		let observedByte = 1;
		const server = testServer({
			read: async (_targetId, kind) => ({
				kind,
				url: null,
				identity: 'stable-provider-id',
				data: Uint8Array.of(observedByte).buffer,
				contentType: 'image/jpeg'
			})
		});
		const runtime = planner({ server });
		const preview = await runtime.createPreview({
			scope: {
				kind: 'revision',
				serverInstanceId: 'server-a',
				revisionId: 'rev-live-change'
			}
		});
		observedByte = 2;

		await expect(
			confirmArtworkUndoPlan(
				{
					planId: preview.planId,
					digest: preview.digest,
					serverInstanceId: 'server-a'
				},
				runtime.dependencies
			)
		).rejects.toMatchObject({ code: 'plan_stale', recordId: 'rev-live-change' });
		expect(runtime.store.consumeCalls).toBe(0);
		expect(runtime.store.plans[0].consumedAt).toBeNull();
	});

	it('re-reads the exact Kometa slot and rejects an external YAML change', async () => {
		await addItem(1);
		await addRevision({ id: 'rev-kometa-change', destination: 'kometa' });
		let url = 'https://host.invalid/first.jpg?token=private-one';
		const runtime = planner({
			readKometa: vi.fn(async () => `metadata:\n  101:\n    url_poster: ${url}\n`)
		});
		const preview = await runtime.createPreview({
			scope: {
				kind: 'revision',
				serverInstanceId: 'server-a',
				revisionId: 'rev-kometa-change'
			}
		});
		url = 'https://host.invalid/second.jpg?token=private-two';

		await expect(
			confirmArtworkUndoPlan(
				{
					planId: preview.planId,
					digest: preview.digest,
					serverInstanceId: 'server-a'
				},
				runtime.dependencies
			)
		).rejects.toMatchObject({ code: 'plan_stale', recordId: 'rev-kometa-change' });
		expect(runtime.readKometa).toHaveBeenCalledTimes(2);
		expect(runtime.store.consumeCalls).toBe(0);
		expect(JSON.stringify(runtime.store.plans[0].payload)).not.toMatch(/private-one|private-two/);
	});

	it('rejects a child id remapped for the same season number', async () => {
		await addItem(1);
		await addRevision({ id: 'rev-child-remap', season: 1 });
		const server = testServer();
		server.listSeasons
			.mockResolvedValueOnce([
				{
					id: 'season-target-old',
					number: 1,
					currentPosterUrl: null,
					currentBackgroundUrl: null,
					serverUpdatedAt: null
				}
			])
			.mockResolvedValue([
				{
					id: 'season-target-new',
					number: 1,
					currentPosterUrl: null,
					currentBackgroundUrl: null,
					serverUpdatedAt: null
				}
			]);
		const runtime = planner({ server });
		const preview = await runtime.createPreview({
			scope: { kind: 'season', serverInstanceId: 'server-a', mediaItemId: 1, season: 1 }
		});

		await expect(
			confirmArtworkUndoPlan(
				{
					planId: preview.planId,
					digest: preview.digest,
					serverInstanceId: 'server-a'
				},
				runtime.dependencies
			)
		).rejects.toMatchObject({ code: 'plan_stale', recordId: 'rev-child-remap' });
		expect(runtime.store.consumeCalls).toBe(0);
	});

	it('rejects a changed before-snapshot identity', async () => {
		await addItem(1);
		await addRevision({ id: 'rev-snapshot-change' });
		const runtime = planner();
		const preview = await runtime.createPreview({
			scope: {
				kind: 'revision',
				serverInstanceId: 'server-a',
				revisionId: 'rev-snapshot-change'
			}
		});
		await execute(
			`UPDATE artwork_snapshots SET sha256 = ? WHERE id = 'snapshot-rev-snapshot-change'`,
			['b'.repeat(64)]
		);

		await expect(
			confirmArtworkUndoPlan(
				{
					planId: preview.planId,
					digest: preview.digest,
					serverInstanceId: 'server-a'
				},
				runtime.dependencies
			)
		).rejects.toMatchObject({ code: 'plan_stale', recordId: 'rev-snapshot-change' });
		expect(runtime.store.consumeCalls).toBe(0);
	});

	it('rejects an altered revision record and an advanced slot version', async () => {
		await addItem(1);
		await addRevision({ id: 'rev-record-change' });
		const alteredRevision = planner();
		const revisionPreview = await alteredRevision.createPreview({
			scope: {
				kind: 'revision',
				serverInstanceId: 'server-a',
				revisionId: 'rev-record-change'
			}
		});
		await execute(
			"UPDATE artwork_revisions SET group_id = 'group-changed' WHERE id = 'rev-record-change'"
		);
		await expect(
			confirmArtworkUndoPlan(
				{
					planId: revisionPreview.planId,
					digest: revisionPreview.digest,
					serverInstanceId: 'server-a'
				},
				alteredRevision.dependencies
			)
		).rejects.toMatchObject({ code: 'plan_stale', recordId: 'rev-record-change' });

		await execute(
			"UPDATE artwork_revisions SET group_id = 'group-main' WHERE id = 'rev-record-change'"
		);
		const advancedVersion = planner();
		const versionPreview = await advancedVersion.createPreview({
			scope: {
				kind: 'revision',
				serverInstanceId: 'server-a',
				revisionId: 'rev-record-change'
			}
		});
		await execute('UPDATE media_items SET artwork_version = 99 WHERE id = 1');
		await expect(
			confirmArtworkUndoPlan(
				{
					planId: versionPreview.planId,
					digest: versionPreview.digest,
					serverInstanceId: 'server-a'
				},
				advancedVersion.dependencies
			)
		).rejects.toMatchObject({ code: 'plan_stale', recordId: 'rev-record-change' });
		expect(alteredRevision.store.consumeCalls).toBe(0);
		expect(advancedVersion.store.consumeCalls).toBe(0);
	});

	it('binds validation to digest, named server, and the optional exact scope', async () => {
		await addItem(1);
		await addRevision({ id: 'rev-scope' });
		const runtime = planner();
		const preview = await runtime.createPreview({
			scope: { kind: 'item', serverInstanceId: 'server-a', mediaItemId: 1 }
		});

		await expect(
			confirmArtworkUndoPlan(
				{
					planId: preview.planId,
					digest: 'c'.repeat(64),
					serverInstanceId: 'server-a'
				},
				runtime.dependencies
			)
		).rejects.toThrow('plan_digest_mismatch');
		await expect(
			confirmArtworkUndoPlan(
				{
					planId: preview.planId,
					digest: preview.digest,
					serverInstanceId: 'server-b'
				},
				runtime.dependencies
			)
		).rejects.toThrow('plan_scope_mismatch');
		await expect(
			confirmArtworkUndoPlan(
				{
					planId: preview.planId,
					digest: preview.digest,
					serverInstanceId: 'server-a',
					scope: { kind: 'item', serverInstanceId: 'server-a', mediaItemId: 2 }
				},
				runtime.dependencies
			)
		).rejects.toMatchObject({ code: 'plan_scope_mismatch' });
		expect(runtime.store.consumeCalls).toBe(0);
	});

	it('leaves expiry/replay enforcement to validate and CAS consume', async () => {
		await addItem(1);
		await addRevision({ id: 'rev-replay' });
		const runtime = planner();
		const preview = await runtime.createPreview({
			scope: {
				kind: 'revision',
				serverInstanceId: 'server-a',
				revisionId: 'rev-replay'
			}
		});
		const confirmation = {
			planId: preview.planId,
			digest: preview.digest,
			serverInstanceId: 'server-a'
		};
		await confirmArtworkUndoPlan(confirmation, runtime.dependencies);
		await expect(confirmArtworkUndoPlan(confirmation, runtime.dependencies)).rejects.toThrow(
			'plan_consumed'
		);
		expect(runtime.store.plans).toHaveLength(1);
		expect(runtime.store.consumeCalls).toBe(1);
	});
});

it('exports a typed locale-neutral planner error', () => {
	expect(new ArtworkUndoPlannerError('invalid_scope')).toMatchObject({
		name: 'ArtworkUndoPlannerError',
		code: 'invalid_scope'
	});
});
