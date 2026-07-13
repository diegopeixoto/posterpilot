import { describe, it, expect, vi, beforeEach } from 'vitest';
import { asc, eq } from 'drizzle-orm';

// Swappable task implementation so each test controls what the worker runs.
const h = vi.hoisted(() => ({
	syncImpl: null as null | ((ctx: unknown) => Promise<unknown>),
	automationImpl: null as null | ((ctx: unknown, payload: unknown) => Promise<unknown>),
	applyImpl: null as null | ((ctx: unknown, payload: unknown) => Promise<unknown>)
}));

vi.mock('./tasks', () => ({
	runSyncJob: (ctx: unknown) => (h.syncImpl ? h.syncImpl(ctx) : Promise.resolve()),
	runDiscoverJob: () => Promise.resolve(),
	runAutomationJob: (ctx: unknown, payload: unknown) =>
		h.automationImpl
			? h.automationImpl(ctx, payload)
			: Promise.resolve({ summary: { processed: 0, succeeded: 0, failed: 0 } }),
	runApplyJob: (ctx: unknown, payload: unknown) =>
		h.applyImpl
			? h.applyImpl(ctx, payload)
			: Promise.resolve({ summary: { succeeded: 0, failed: 0 } })
}));

// Real temporary libsql DB so the runner exercises actual SQL, not brittle mocks.
vi.mock('$lib/server/db', async () => {
	const { drizzle } = await import('drizzle-orm/libsql');
	const { createClient } = await import('@libsql/client');
	const { migrate } = await import('drizzle-orm/libsql/migrator');
	const schema = await import('../db/schema');
	// libsql transactions use a separate connection and therefore cannot retain a
	// bare `:memory:` database. A process-unique temporary file exercises the same
	// transaction behavior as production.
	const client = createClient({
		url: `file:/tmp/posterpilot-runner-${process.pid}-${Date.now()}.db`
	});
	const db = drizzle(client, { schema });
	await migrate(db, { migrationsFolder: './drizzle' });
	return { db, migrateDb: async () => {} };
});

import { db } from '$lib/server/db';
import {
	jobAttempts,
	jobItemOutcomes,
	jobs,
	operationPlans,
	serverInstances
} from '$lib/server/db/schema';
import {
	cancelJob,
	drainJobQueue,
	enqueueJob,
	enqueueJobDetailed,
	markInterruptedJobs,
	recoverExpiredLeases
} from './runner';
import { enterMaintenanceMode, resetMaintenanceModeForTests } from '$lib/server/maintenance';
import { canonicalJsonDigest } from '$lib/server/plans/canonical-json';
import { buildApplyPlanPayload, type FrozenApplyJobPayload } from '$lib/server/plans/apply-plan';
import {
	freezeAutomationOccurrence,
	normalizeAutomationDefinition
} from '$lib/server/automation/model';

interface Ctx {
	setTotal(n: number): Promise<void>;
	progress(p: number, c: string | null): Promise<void>;
	recordOutcome(input: Record<string, unknown>): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SERVER_ID = 'legacy-default';

async function getJob(id: number) {
	return (await db.select().from(jobs).where(eq(jobs.id, id)).limit(1))[0];
}

async function waitFor(id: number, statuses: string[], timeout = 3000) {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		const j = await getJob(id);
		if (j && statuses.includes(j.status)) return j;
		await sleep(10);
	}
	throw new Error(`timed out waiting for job ${id} to reach ${statuses.join('/')}`);
}

describe('job runner', () => {
	beforeEach(async () => {
		h.syncImpl = null;
		h.automationImpl = null;
		h.applyImpl = null;
		resetMaintenanceModeForTests();
		await db
			.insert(serverInstances)
			.values({
				id: SERVER_ID,
				name: 'Legacy',
				normalizedName: 'legacy',
				type: 'plex'
			})
			.onConflictDoNothing();
	});

	it('runs a job to completion and records progress', async () => {
		h.syncImpl = async (ctx) => {
			const c = ctx as Ctx;
			await c.setTotal(2);
			await c.progress(1, 'a');
			await c.progress(2, 'b');
		};
		const id = await enqueueJob({ kind: 'sync', serverInstanceId: SERVER_ID });
		const j = await waitFor(id, ['completed']);
		expect(j.processed).toBe(2);
		expect(j.total).toBe(2);
		expect(j.serverInstanceId).toBe(SERVER_ID);
		expect(j.payload).toEqual({ kind: 'sync', serverInstanceId: SERVER_ID });
		expect(j.attempt).toBe(1);
		const [attempt] = await db.select().from(jobAttempts).where(eq(jobAttempts.jobId, id));
		expect(attempt).toMatchObject({ attemptNumber: 1, status: 'completed' });
	});

	it('persists per-unit outcomes and a partial terminal result', async () => {
		h.syncImpl = async (ctx) => {
			const c = ctx as Ctx;
			await c.recordOutcome({
				serverInstanceId: SERVER_ID,
				status: 'success',
				result: { unit: 'one' }
			});
			await c.recordOutcome({
				serverInstanceId: SERVER_ID,
				status: 'failed',
				retryable: true,
				errorCode: 'provider_timeout',
				error: 'timeout token=must-not-survive'
			});
			return { summary: { processed: 2, succeeded: 1, failed: 1 } };
		};
		const id = await enqueueJob({ kind: 'sync', serverInstanceId: SERVER_ID });
		const row = await waitFor(id, ['partial_failed']);
		expect(row.result).toMatchObject({ summary: { succeeded: 1, failed: 1 } });
		const outcomes = await db
			.select()
			.from(jobItemOutcomes)
			.where(eq(jobItemOutcomes.jobId, id))
			.orderBy(asc(jobItemOutcomes.id));
		expect(outcomes.map((outcome) => outcome.status)).toEqual(['success', 'failed']);
		expect(outcomes[1]).toMatchObject({ retryable: true, errorCode: 'provider_timeout' });
		expect(outcomes[1].error).not.toContain('must-not-survive');
	});

	it('persists a full rescan as a distinct job type while keeping its frozen sync payload', async () => {
		const id = await enqueueJob({ kind: 'sync', serverInstanceId: SERVER_ID, full: true });
		const job = await waitFor(id, ['completed']);
		expect(job.type).toBe('full_rescan');
		expect(job.payload).toEqual({ kind: 'sync', serverInstanceId: SERVER_ID, full: true });
	});

	it('executes a frozen review-only automation without entering the apply path', async () => {
		const occurrence = freezeAutomationOccurrence({
			automationId: 'automation-a',
			definition: normalizeAutomationDefinition({
				name: 'Nightly review',
				enabled: true,
				serverInstanceId: SERVER_ID,
				timezone: 'UTC',
				timing: { triggerType: 'interval', intervalMinutes: 60 },
				libraryScopes: ['movies']
			}),
			logicalKey: 'interval:2026-07-10T12:00:00.000Z',
			scheduledFor: new Date('2026-07-10T12:00:00.000Z'),
			frozenAt: new Date('2026-07-10T12:00:00.000Z')
		});
		const payload = {
			kind: 'automation' as const,
			occurrenceId: `occ_${'a'.repeat(40)}`,
			occurrence
		};
		const executed = vi.fn().mockResolvedValue({
			summary: { processed: 1, succeeded: 1, failed: 0 }
		});
		h.automationImpl = executed;
		h.applyImpl = async () => {
			throw new Error('apply_must_not_run');
		};
		const id = await enqueueJob(payload);
		const job = await waitFor(id, ['completed']);
		expect(job.type).toBe('automation');
		expect(job.payload).toEqual(payload);
		expect(executed).toHaveBeenCalledWith(expect.anything(), payload);
	});

	it('detaches and normalizes the immutable payload before returning', async () => {
		const itemIds = [9, 2, 9];
		const id = await enqueueJob({
			kind: 'discover',
			serverInstanceId: SERVER_ID,
			itemIds
		});
		itemIds.push(100);
		const row = await waitFor(id, ['completed']);
		expect(row.payload).toEqual({
			kind: 'discover',
			serverInstanceId: SERVER_ID,
			itemIds: [2, 9]
		});
	});

	it('marks a job failed when its task throws', async () => {
		h.syncImpl = async () => {
			throw Object.assign(new Error('invalid request'), { code: 'invalid_request' });
		};
		const id = await enqueueJob({ kind: 'sync', serverInstanceId: SERVER_ID });
		const j = await waitFor(id, ['failed']);
		expect(j.errorCode).toBe('invalid_request');
	});

	it('cancels a running job', async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		h.syncImpl = async (ctx) => {
			await (ctx as Ctx).setTotal(1);
			await gate;
		};
		const id = await enqueueJob({ kind: 'sync', serverInstanceId: SERVER_ID });
		await waitFor(id, ['running']);
		await cancelJob(id);
		release();
		const j = await waitFor(id, ['cancelled']);
		expect(j.status).toBe('cancelled');
	});

	it('atomically cancels queued work and its pending attempt', async () => {
		const [job] = await db
			.insert(jobs)
			.values({
				type: 'sync',
				status: 'pending',
				payload: { kind: 'sync', serverInstanceId: SERVER_ID },
				serverInstanceId: SERVER_ID
			})
			.returning();
		await db.insert(jobAttempts).values({
			jobId: job.id,
			serverInstanceId: SERVER_ID,
			attemptNumber: 1,
			trigger: 'enqueue',
			status: 'pending'
		});

		await expect(cancelJob(job.id)).resolves.toBe(true);
		expect(await getJob(job.id)).toMatchObject({
			status: 'cancelled',
			errorCode: 'cancelled'
		});
		const [attempt] = await db.select().from(jobAttempts).where(eq(jobAttempts.jobId, job.id));
		expect(attempt).toMatchObject({ status: 'cancelled', errorCode: 'cancelled' });
	});

	it('persists and passes the exact frozen apply plan to the worker', async () => {
		const identity = {
			serverInstanceId: 'legacy-default',
			mediaItemId: 99,
			librarySectionKey: 'movies',
			sourceId: 'rating-99',
			type: 'movie' as const,
			tmdbId: '99',
			imdbId: null,
			tvdbId: null,
			mediaType: 'movie' as const,
			updatedAt: '2026-07-10T12:00:00.000Z',
			selectionUpdatedAt: '2026-07-10T12:00:00.000Z'
		};
		const selection = {
			selectionSource: 'stored' as const,
			sourceItem: {
				serverInstanceId: identity.serverInstanceId,
				mediaItemId: identity.mediaItemId
			},
			slot: { kind: 'poster' as const, season: null, episode: null },
			candidateId: null,
			url: 'https://art.example/frozen.jpg',
			provider: null,
			providerAssetId: null,
			setId: null,
			setAuthor: null,
			designFamily: null,
			language: null,
			discoveryRunId: null,
			resolvedTmdbId: '99',
			resolvedMediaType: 'movie' as const,
			stale: false,
			score: null,
			width: null,
			height: null,
			fingerprint: 'selection-fingerprint'
		};
		const plan = buildApplyPlanPayload({
			plannedAt: '2026-07-10T12:00:00.000Z',
			context: { source: 'bulk', resultSetFingerprint: null },
			defaults: {
				configuredMethod: 'server',
				effectiveMethod: 'server',
				methodSource: 'explicit',
				selectionMode: 'stored',
				scoring: {
					providerPriority: [],
					weights: { providerWeights: {}, resolutionWeight: 0, aspectWeight: 0 }
				}
			},
			items: [
				{
					target: identity,
					selectionFrom: identity,
					discovery: {
						status: 'succeeded',
						runId: null,
						completedAt: null,
						resolvedTmdbId: '99',
						resolvedMediaType: 'movie',
						candidateIds: [],
						candidateCount: 0,
						fingerprint: 'discovery-fingerprint'
					},
					selections: [selection],
					destinationSlots: [
						{
							destination: 'server',
							slot: selection.slot,
							targetId: 'rating-99',
							capability: 'supported',
							current: {
								url: null,
								fingerprint: null,
								artworkVersion: 0,
								observedAt: null,
								destinationFingerprint: 'server-state'
							},
							skipCode: null,
							parameters: {}
						}
					],
					itemSkip: null
				}
			]
		});
		const canonical = canonicalJsonDigest(plan);
		const payload: FrozenApplyJobPayload = {
			kind: 'apply',
			planId: 'plan-99',
			digest: canonical.digest,
			plan
		};
		await db
			.insert(serverInstances)
			.values({
				id: identity.serverInstanceId,
				name: 'Legacy',
				normalizedName: 'legacy',
				type: 'plex'
			})
			.onConflictDoNothing();
		await db.insert(operationPlans).values({
			id: payload.planId,
			kind: 'artwork_apply',
			serverInstanceId: identity.serverInstanceId,
			librarySectionKey: identity.librarySectionKey,
			payload: canonical.canonicalJson,
			digest: canonical.digest,
			expiresAt: new Date('2026-07-10T12:15:00.000Z'),
			consumedAt: new Date('2026-07-10T12:00:01.000Z')
		});
		let received: unknown;
		h.applyImpl = async (_ctx, input) => {
			received = input;
			return {
				planId: payload.planId,
				digest: payload.digest,
				sourceFingerprint: plan.sourceFingerprint,
				summary: {
					itemCount: 1,
					operationCount: 1,
					succeeded: 1,
					failed: 0,
					skipped: plan.summary.skipCount
				},
				items: []
			};
		};

		const id = await enqueueJob(payload);
		const row = await waitFor(id, ['completed']);
		expect(received).toEqual(payload);
		expect(row.payload).toEqual(payload);
		expect(row.planId).toBe(payload.planId);
		expect(row.serverInstanceId).toBe('legacy-default');
		expect(row.librarySectionKey).toBe('movies');
		expect(row.result).toMatchObject({
			planId: payload.planId,
			summary: { operationCount: 1, succeeded: 1, failed: 0 }
		});
	});

	it('recovers an expired safe lease and re-enters durable pending work on startup', async () => {
		const [a] = await db
			.insert(jobs)
			.values({
				type: 'sync',
				status: 'running',
				processed: 0,
				total: 0,
				payload: { kind: 'sync', serverInstanceId: SERVER_ID },
				serverInstanceId: SERVER_ID,
				attempt: 1,
				leaseOwner: 'dead-worker',
				leaseExpiresAt: new Date(0)
			})
			.returning();
		await db.insert(jobAttempts).values({
			jobId: a.id,
			serverInstanceId: SERVER_ID,
			attemptNumber: 1,
			trigger: 'enqueue',
			status: 'running',
			leaseOwner: 'dead-worker',
			leaseExpiresAt: new Date(0)
		});
		const [b] = await db
			.insert(jobs)
			.values({
				type: 'discover',
				status: 'pending',
				processed: 0,
				total: 0,
				payload: { kind: 'discover', serverInstanceId: SERVER_ID },
				serverInstanceId: SERVER_ID
			})
			.returning();
		await markInterruptedJobs();
		await waitFor(a.id, ['completed']);
		await waitFor(b.id, ['completed']);
		const attempts = await db.select().from(jobAttempts).where(eq(jobAttempts.jobId, a.id));
		expect(attempts.map((attempt) => attempt.status)).toEqual(['interrupted', 'completed']);
	});

	it('never replays an interrupted non-idempotent apply automatically', async () => {
		const apply = vi.fn(async () => ({ summary: { succeeded: 1, failed: 0 }, items: [] }));
		h.applyImpl = apply;
		const [job] = await db
			.insert(jobs)
			.values({
				type: 'apply',
				status: 'running',
				serverInstanceId: SERVER_ID,
				attempt: 1,
				maxAttempts: 3,
				leaseOwner: 'dead-worker',
				leaseExpiresAt: new Date(0),
				payload: {
					kind: 'apply',
					planId: 'interrupted-plan',
					digest: 'not-executed',
					plan: {
						scope: {
							serverInstanceIds: [SERVER_ID],
							librarySectionKeys: ['movies'],
							targetItemIds: []
						},
						items: []
					}
				}
			})
			.returning();
		await db.insert(jobAttempts).values({
			jobId: job.id,
			serverInstanceId: SERVER_ID,
			attemptNumber: 1,
			trigger: 'enqueue',
			status: 'running',
			leaseOwner: 'dead-worker',
			leaseExpiresAt: new Date(0)
		});
		await markInterruptedJobs();
		expect((await getJob(job.id)).status).toBe('interrupted');
		expect(apply).not.toHaveBeenCalled();
	});

	it('allows only one recovery winner for each expired lease', async () => {
		const expiredAt = new Date('2026-07-10T12:00:00.000Z');
		const rows = await db
			.insert(jobs)
			.values(
				Array.from({ length: 12 }, () => ({
					type: 'sync' as const,
					status: 'running' as const,
					processed: 0,
					total: 0,
					payload: { kind: 'sync' as const, serverInstanceId: SERVER_ID },
					serverInstanceId: SERVER_ID,
					attempt: 1,
					maxAttempts: 1,
					leaseOwner: 'expired-worker',
					leaseExpiresAt: new Date(0)
				}))
			)
			.returning({ id: jobs.id });

		const results = await Promise.all(
			Array.from({ length: 5 }, () => recoverExpiredLeases(expiredAt))
		);
		expect(results.reduce((sum, result) => sum + result.interrupted, 0)).toBe(rows.length);
		expect(results.reduce((sum, result) => sum + result.retried, 0)).toBe(0);
		for (const row of rows) {
			expect(await getJob(row.id)).toMatchObject({ status: 'interrupted', attempt: 1 });
		}
	});

	it('reuses equivalent active work and rejects incompatible overlap', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		h.syncImpl = async () => gate;
		const first = await enqueueJobDetailed({ kind: 'sync', serverInstanceId: SERVER_ID });
		await waitFor(first.jobId, ['running']);
		const duplicate = await enqueueJobDetailed({ kind: 'sync', serverInstanceId: SERVER_ID });
		expect(duplicate).toEqual({ jobId: first.jobId, reused: true });
		await expect(
			enqueueJobDetailed({ kind: 'discover', serverInstanceId: SERVER_ID, itemIds: [1] })
		).rejects.toMatchObject({ code: 'job_conflict', conflictingJobId: first.jobId });
		release();
		await waitFor(first.jobId, ['completed']);
	});

	it('blocks new jobs in maintenance while draining work accepted before it', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		h.syncImpl = async () => gate;
		const id = await enqueueJob({ kind: 'sync', serverInstanceId: SERVER_ID });
		await waitFor(id, ['running']);

		enterMaintenanceMode('application_restore');
		await expect(
			enqueueJob({ kind: 'discover', serverInstanceId: SERVER_ID })
		).rejects.toMatchObject({
			code: 'maintenance_mode'
		});
		const drained = drainJobQueue(1_000);
		release();
		await drained;
		expect((await getJob(id)).status).toBe('completed');
	});
});
