import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from '$lib/server/db/schema';
import {
	artworkRevisionGroups,
	artworkRevisions,
	artworkSnapshots,
	automationSchedules,
	backupRecords,
	events,
	jobs,
	mediaCollections,
	mediaItems,
	operationPlans,
	posterCandidates,
	serverInstances,
	settings
} from '$lib/server/db/schema';
import { canonicalJson, hashCanonicalJson } from '$lib/server/plans/canonical-json';
import type {
	CreateOperationPlanInput,
	OperationPlan,
	OperationPlanExpectations
} from '$lib/server/plans/operation-plan-store';
import { createServerPurgeService, type ServerPurgePlanStore } from './purge';
import { ACTIVE_SERVER_INSTANCE_KEY, createServerInstanceStore } from './store';

const NOW = new Date('2026-07-11T18:00:00.000Z');

let directory: string;
let client: Client;
let database: LibSQLDatabase<typeof schema>;
let planStore: DatabasePlanStore;
let release: Mock<(referenceId: string, sha256: string) => Promise<boolean>>;
let service: ReturnType<typeof createServerPurgeService>;

class PlanFailure extends Error {
	constructor(readonly code: string) {
		super(code);
	}
}

class DatabasePlanStore implements ServerPurgePlanStore {
	private nextId = 0;

	constructor(private readonly database: LibSQLDatabase<typeof schema>) {}

	async create<T>(input: CreateOperationPlanInput<T>): Promise<OperationPlan<T>> {
		const id = `purge-plan-${++this.nextId}`;
		const payload = canonicalJson(input.payload);
		const digest = hashCanonicalJson(input.payload);
		const expiresAt = new Date(NOW.getTime() + 15 * 60_000);
		await this.database.insert(operationPlans).values({
			id,
			kind: input.kind,
			serverInstanceId: input.serverInstanceId ?? null,
			librarySectionKey: input.librarySectionKey ?? null,
			payload,
			digest,
			createdAt: NOW,
			expiresAt,
			consumedAt: null
		});
		return {
			id,
			kind: input.kind,
			serverInstanceId: input.serverInstanceId ?? null,
			librarySectionKey: input.librarySectionKey ?? null,
			payload: JSON.parse(payload) as T,
			digest,
			createdAt: NOW,
			expiresAt,
			consumedAt: null
		};
	}

	async validate<T = unknown>(
		id: string,
		expectations: OperationPlanExpectations = {}
	): Promise<OperationPlan<T>> {
		const [row] = await this.database
			.select()
			.from(operationPlans)
			.where(eq(operationPlans.id, id))
			.limit(1);
		if (!row) throw new PlanFailure('plan_not_found');
		if (row.consumedAt) throw new PlanFailure('plan_consumed');
		if (expectations.kind && expectations.kind !== row.kind) {
			throw new PlanFailure('plan_kind_mismatch');
		}
		if (expectations.digest && expectations.digest !== row.digest) {
			throw new PlanFailure('plan_digest_mismatch');
		}
		if (
			Object.hasOwn(expectations, 'serverInstanceId') &&
			expectations.serverInstanceId !== row.serverInstanceId
		) {
			throw new PlanFailure('plan_scope_mismatch');
		}
		if (
			Object.hasOwn(expectations, 'payload') &&
			hashCanonicalJson(expectations.payload) !== row.digest
		) {
			throw new PlanFailure('plan_payload_mismatch');
		}
		return {
			id: row.id,
			kind: row.kind,
			serverInstanceId: row.serverInstanceId,
			librarySectionKey: row.librarySectionKey,
			payload: JSON.parse(row.payload) as T,
			digest: row.digest,
			createdAt: row.createdAt,
			expiresAt: row.expiresAt,
			consumedAt: row.consumedAt
		};
	}

	async consume<T = unknown>(
		id: string,
		expectations: OperationPlanExpectations = {}
	): Promise<OperationPlan<T>> {
		const plan = await this.validate<T>(id, expectations);
		await this.database
			.update(operationPlans)
			.set({ consumedAt: NOW })
			.where(and(eq(operationPlans.id, id), isNull(operationPlans.consumedAt)));
		return { ...plan, consumedAt: NOW };
	}
}

async function seed(): Promise<void> {
	await database.insert(serverInstances).values([
		{
			id: 'server-a',
			name: 'Disconnected A',
			normalizedName: 'disconnected a',
			type: 'plex',
			baseUrl: 'http://a.invalid',
			credential: null,
			enabled: false,
			protected: true,
			connectionStatus: 'disabled',
			disconnectedAt: NOW,
			createdAt: new Date(NOW.getTime() - 10_000),
			updatedAt: NOW
		},
		{
			id: 'server-b',
			name: 'Connected B',
			normalizedName: 'connected b',
			type: 'jellyfin',
			baseUrl: 'http://b.invalid',
			credential: 'encrypted-b',
			enabled: true,
			protected: false,
			connectionStatus: 'healthy',
			disconnectedAt: null,
			createdAt: new Date(NOW.getTime() - 5_000),
			updatedAt: NOW
		}
	]);
	await database.insert(settings).values([
		{ key: ACTIVE_SERVER_INSTANCE_KEY, value: 'server-b' },
		{ key: 'language', value: 'pt-BR' }
	]);
	await database.insert(mediaItems).values([
		{
			id: 1,
			serverInstanceId: 'server-a',
			ratingKey: 'shared-source',
			sectionKey: 'movies',
			type: 'movie',
			title: 'A title',
			updatedAt: NOW
		},
		{
			id: 2,
			serverInstanceId: 'server-b',
			ratingKey: 'shared-source',
			sectionKey: 'movies',
			type: 'movie',
			title: 'B title',
			updatedAt: NOW
		}
	]);
	await database.insert(posterCandidates).values([
		{
			id: 1,
			serverInstanceId: 'server-a',
			mediaItemId: 1,
			setId: 'set-a',
			provider: 'tmdb',
			url: 'https://image.tmdb.org/a.jpg',
			kind: 'poster',
			createdAt: NOW
		},
		{
			id: 2,
			serverInstanceId: 'server-b',
			mediaItemId: 2,
			setId: 'set-b',
			provider: 'tmdb',
			url: 'https://image.tmdb.org/b.jpg',
			kind: 'poster',
			createdAt: NOW
		}
	]);
	await database.insert(jobs).values([
		{
			id: 1,
			serverInstanceId: 'server-a',
			type: 'sync',
			status: 'completed',
			payload: {},
			updatedAt: NOW,
			createdAt: NOW
		},
		{
			id: 2,
			serverInstanceId: 'server-b',
			type: 'sync',
			status: 'completed',
			payload: {},
			updatedAt: NOW,
			createdAt: NOW
		}
	]);
	await database.insert(mediaCollections).values([
		{
			id: 'collection-a',
			serverInstanceId: 'server-a',
			source: 'tmdb',
			sourceId: '101',
			name: 'Collection A',
			updatedAt: NOW,
			firstSeenAt: NOW
		},
		{
			id: 'collection-b',
			serverInstanceId: 'server-b',
			source: 'tmdb',
			sourceId: '202',
			name: 'Collection B',
			updatedAt: NOW,
			firstSeenAt: NOW
		}
	]);
	await database.insert(automationSchedules).values([
		{
			id: 'schedule-a',
			serverInstanceId: 'server-a',
			name: 'Schedule A',
			normalizedName: 'schedule a',
			enabled: false,
			triggerType: 'interval',
			action: 'sync',
			timezone: 'UTC',
			intervalMinutes: 60,
			libraryScopes: ['movies'],
			createdAt: NOW,
			updatedAt: NOW
		},
		{
			id: 'schedule-b',
			serverInstanceId: 'server-b',
			name: 'Schedule B',
			normalizedName: 'schedule b',
			enabled: false,
			triggerType: 'interval',
			action: 'sync',
			timezone: 'UTC',
			intervalMinutes: 60,
			libraryScopes: ['movies'],
			createdAt: NOW,
			updatedAt: NOW
		}
	]);
	await database.insert(artworkSnapshots).values([
		{
			id: 'snapshot-a',
			serverInstanceId: 'server-a',
			mediaItemId: 1,
			destination: 'server',
			kind: 'poster',
			state: 'present',
			sha256: 'a'.repeat(64),
			storagePath: '/internal/a',
			sizeBytes: 10,
			createdAt: NOW
		},
		{
			id: 'snapshot-b',
			serverInstanceId: 'server-b',
			mediaItemId: 2,
			destination: 'server',
			kind: 'poster',
			state: 'present',
			sha256: 'b'.repeat(64),
			storagePath: '/internal/b',
			sizeBytes: 10,
			createdAt: NOW
		}
	]);
	await database.insert(artworkRevisionGroups).values([
		{
			id: 'group-a',
			serverInstanceId: 'server-a',
			kind: 'apply',
			initiator: 'user',
			outcome: 'success',
			createdAt: NOW,
			completedAt: NOW
		},
		{
			id: 'group-b',
			serverInstanceId: 'server-b',
			kind: 'apply',
			initiator: 'user',
			outcome: 'success',
			createdAt: NOW,
			completedAt: NOW
		}
	]);
	await database.insert(artworkRevisions).values([
		{
			id: 'revision-a',
			groupId: 'group-a',
			serverInstanceId: 'server-a',
			mediaItemId: 1,
			beforeSnapshotId: 'snapshot-a',
			afterSnapshotId: 'snapshot-a',
			action: 'apply',
			destination: 'server',
			kind: 'poster',
			outcome: 'success',
			verification: 'exact',
			createdAt: NOW,
			completedAt: NOW
		},
		{
			id: 'revision-b',
			groupId: 'group-b',
			serverInstanceId: 'server-b',
			mediaItemId: 2,
			beforeSnapshotId: 'snapshot-b',
			afterSnapshotId: 'snapshot-b',
			action: 'apply',
			destination: 'server',
			kind: 'poster',
			outcome: 'success',
			verification: 'exact',
			createdAt: NOW,
			completedAt: NOW
		}
	]);
	await database.insert(backupRecords).values({
		id: 'backup-global',
		trigger: 'manual',
		status: 'completed',
		bundleName: 'global-backup',
		storagePath: '/backups/global',
		createdAt: NOW,
		completedAt: NOW
	});
}

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'posterpilot-server-purge-'));
	client = createClient({ url: `file:${join(directory, 'purge.db')}` });
	database = drizzle(client, { schema });
	await migrate(database, { migrationsFolder: './drizzle' });
	await seed();
	planStore = new DatabasePlanStore(database);
	release = vi.fn(async (_referenceId: string, _sha256: string) => true);
	service = createServerPurgeService(database, planStore, {
		snapshotStore: { release }
	});
});

afterEach(async () => {
	client.close();
	await rm(directory, { recursive: true, force: true });
});

describe('server permanent purge', () => {
	it('previews exact scoped impact and performs no deletion', async () => {
		const preview = await service.preview('server-a');

		expect(preview).toMatchObject({
			server: { id: 'server-a', name: 'Disconnected A', type: 'plex' },
			impact: {
				serverRecords: 1,
				libraries: 1,
				items: 1,
				candidates: 1,
				jobs: 1,
				collections: 1,
				schedules: 1,
				snapshots: 1,
				snapshotFiles: 1,
				revisionGroups: 1,
				revisions: 1,
				operationPlans: 1,
				activeMutatingJobs: 0
			},
			blocked: false,
			backupRecommended: true
		});
		expect(await database.select().from(serverInstances)).toHaveLength(2);
		expect(await database.select().from(mediaItems)).toHaveLength(2);
		expect(release).not.toHaveBeenCalled();
	});

	it('rejects wrong scope and stale or active-job plans before deletion', async () => {
		const wrongScope = await service.preview('server-a');
		await expect(
			service.confirm({
				serverInstanceId: 'server-b',
				planId: wrongScope.planId,
				digest: wrongScope.digest
			})
		).rejects.toMatchObject({ code: 'plan_scope_mismatch' });

		const identityStale = await service.preview('server-a');
		await database.delete(posterCandidates).where(eq(posterCandidates.id, 1));
		await database.insert(posterCandidates).values({
			id: 3,
			serverInstanceId: 'server-a',
			mediaItemId: 1,
			setId: 'replacement-set',
			provider: 'tmdb',
			url: 'https://image.tmdb.org/replacement.jpg',
			kind: 'poster',
			createdAt: NOW
		});
		await expect(
			service.confirm({
				serverInstanceId: 'server-a',
				planId: identityStale.planId,
				digest: identityStale.digest
			})
		).rejects.toMatchObject({ code: 'server_purge_stale' });

		const stale = await service.preview('server-a');
		await database.insert(mediaItems).values({
			serverInstanceId: 'server-a',
			ratingKey: 'new-after-preview',
			sectionKey: 'shows',
			type: 'show',
			title: 'New item',
			updatedAt: NOW
		});
		await expect(
			service.confirm({
				serverInstanceId: 'server-a',
				planId: stale.planId,
				digest: stale.digest
			})
		).rejects.toMatchObject({ code: 'server_purge_stale' });

		const activePreview = await service.preview('server-a');
		await database.insert(jobs).values({
			serverInstanceId: 'server-a',
			type: 'apply',
			status: 'running',
			payload: {},
			createdAt: NOW,
			updatedAt: NOW
		});
		await expect(
			service.confirm({
				serverInstanceId: 'server-a',
				planId: activePreview.planId,
				digest: activePreview.digest
			})
		).rejects.toMatchObject({ code: 'server_purge_active_jobs' });
		expect(await database.select().from(serverInstances)).toHaveLength(2);
	});

	it('deletes only the confirmed server in dependency order and releases its snapshot files', async () => {
		const preview = await service.preview('server-a');
		const result = await service.confirm({
			serverInstanceId: 'server-a',
			planId: preview.planId,
			digest: preview.digest
		});

		expect(result).toMatchObject({
			serverInstanceId: 'server-a',
			activeServerId: 'server-b',
			snapshotFilesReleased: 1,
			snapshotFilesReleaseFailed: 0
		});
		expect(release).toHaveBeenCalledWith('snapshot-a', 'a'.repeat(64));
		expect(await database.select().from(serverInstances)).toMatchObject([{ id: 'server-b' }]);
		expect((await database.select().from(mediaItems)).map((row) => row.id)).toEqual([2]);
		expect((await database.select().from(posterCandidates)).map((row) => row.id)).toEqual([2]);
		expect((await database.select().from(jobs)).map((row) => row.id)).toEqual([2]);
		expect((await database.select().from(mediaCollections)).map((row) => row.id)).toEqual([
			'collection-b'
		]);
		expect((await database.select().from(automationSchedules)).map((row) => row.id)).toEqual([
			'schedule-b'
		]);
		expect((await database.select().from(artworkSnapshots)).map((row) => row.id)).toEqual([
			'snapshot-b'
		]);
		expect((await database.select().from(artworkRevisions)).map((row) => row.id)).toEqual([
			'revision-b'
		]);
		expect(await database.select().from(backupRecords)).toHaveLength(1);
		expect(
			(await database.select().from(settings).where(eq(settings.key, 'language')))[0]?.value
		).toBe('pt-BR');
		expect(
			(await database.select().from(events).where(eq(events.code, 'server_purged')))[0]
		).toMatchObject({ serverInstanceId: null, parameters: { serverInstanceId: 'server-a' } });
	});

	it('rejects replay after the single-use plan has purged its own row', async () => {
		const preview = await service.preview('server-a');
		await service.confirm({
			serverInstanceId: 'server-a',
			planId: preview.planId,
			digest: preview.digest
		});
		await expect(
			service.confirm({
				serverInstanceId: 'server-a',
				planId: preview.planId,
				digest: preview.digest
			})
		).rejects.toMatchObject({ code: 'plan_not_found' });
		expect(release).toHaveBeenCalledTimes(1);
	});

	it('returns to no active server after the last configured instance is purged', async () => {
		let preview = await service.preview('server-a');
		await service.confirm({
			serverInstanceId: 'server-a',
			planId: preview.planId,
			digest: preview.digest
		});
		const registry = createServerInstanceStore(database, Buffer.alloc(32, 7), {
			clock: () => new Date(NOW.getTime() + 1_000)
		});
		await registry.disconnect('server-b');

		preview = await service.preview('server-b');
		const result = await service.confirm({
			serverInstanceId: 'server-b',
			planId: preview.planId,
			digest: preview.digest
		});

		expect(result.activeServerId).toBeNull();
		expect(await database.select().from(serverInstances)).toEqual([]);
		expect(
			await database.select().from(settings).where(eq(settings.key, ACTIVE_SERVER_INSTANCE_KEY))
		).toEqual([]);
		expect(await database.select().from(backupRecords)).toHaveLength(1);
		expect(
			(await database.select().from(settings).where(eq(settings.key, 'language')))[0]?.value
		).toBe('pt-BR');
	});

	it('disconnect revokes credentials but retains scoped data for later purge preview', async () => {
		await database
			.update(serverInstances)
			.set({
				credential: 'still-encrypted',
				enabled: true,
				disconnectedAt: null,
				connectionStatus: 'healthy'
			})
			.where(eq(serverInstances.id, 'server-a'));
		await database
			.update(automationSchedules)
			.set({ enabled: true, nextRunAt: new Date(NOW.getTime() + 60_000) })
			.where(eq(automationSchedules.id, 'schedule-a'));
		const registry = createServerInstanceStore(database, Buffer.alloc(32, 9), {
			clock: () => NOW
		});
		const disconnected = await registry.disconnect('server-a');

		expect(disconnected).toMatchObject({
			id: 'server-a',
			enabled: false,
			credentialSet: false
		});
		expect(
			await database.select().from(mediaItems).where(eq(mediaItems.serverInstanceId, 'server-a'))
		).toHaveLength(1);
		expect(
			await database
				.select()
				.from(artworkRevisions)
				.where(eq(artworkRevisions.serverInstanceId, 'server-a'))
		).toHaveLength(1);
		expect(
			await database
				.select({ enabled: automationSchedules.enabled, pausedAt: automationSchedules.pausedAt })
				.from(automationSchedules)
				.where(eq(automationSchedules.id, 'schedule-a'))
		).toEqual([{ enabled: false, pausedAt: NOW }]);
		expect((await service.preview('server-a')).impact.items).toBe(1);
	});
});
