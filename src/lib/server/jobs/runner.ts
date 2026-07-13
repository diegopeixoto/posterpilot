import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { jobAttempts, jobItemOutcomes, jobs } from '$lib/server/db/schema';
import { assertMutationsAllowed } from '$lib/server/maintenance';
import { assertApplyPlanPayload } from '$lib/server/plans/apply-plan-validation';
import { assertUndoPlanPayload } from '$lib/server/artwork-revisions/undo-plan';
import { canonicalJsonDigest } from '$lib/server/plans/canonical-json';
import { automationStore } from '$lib/server/automation/runtime';
import { notifyAutomationEvent } from '$lib/server/automation/scheduler-runtime';
import { emitProgress } from './events';
import {
	calculateRetryDelayMs,
	classifyJobFailure,
	DEFAULT_RETRY_POLICY,
	describeJob,
	relateJobs,
	sanitizedResult,
	sanitizeJobErrorText,
	type JobDescriptor
} from './policy';
import { runApplyJob, runAutomationJob, runDiscoverJob, runSyncJob, runUndoJob } from './tasks';
import type {
	JobContext,
	JobItemOutcomeInput,
	JobPayload,
	JobTaskResult,
	PersistedJobType,
	WorkerTaskResult
} from './types';

type JobRow = typeof jobs.$inferSelect;
type AttemptRow = typeof jobAttempts.$inferSelect;
type TerminalJobStatus = 'completed' | 'partial_failed' | 'failed' | 'cancelled' | 'interrupted';

const ACTIVE_STATUSES = ['pending', 'running', 'retry_scheduled'] as const;
const CLAIMABLE_STATUSES = ['pending', 'retry_scheduled'] as const;
const WORKER_ID = `posterpilot-${randomUUID()}`;
const LEASE_MS = 30_000;
const HEARTBEAT_MS = 10_000;
const MAX_ATTEMPTS_LIMIT = 10;

const cancelled = new Set<number>();
const drainWaiters = new Set<() => void>();
let working = false;
let wakeTimer: ReturnType<typeof setTimeout> | null = null;

export interface EnqueueJobOptions {
	parentJobId?: number | null;
	initiator?: string;
	maxAttempts?: number;
	availableAt?: Date;
	trigger?: string;
	persistedType?: PersistedJobType;
	/** Stable retry/subset identity; never use a random value here. */
	idempotencySalt?: string;
}

export interface EnqueueJobResult {
	jobId: number;
	reused: boolean;
}

export class JobConflictError extends Error {
	readonly code = 'job_conflict';
	constructor(
		readonly conflictingJobId: number,
		readonly conflictingJobType: string
	) {
		super('An incompatible job already owns this scope');
		this.name = 'JobConflictError';
	}
}

function now(): Date {
	return new Date();
}

function safePositiveInt(value: number | undefined, fallback: number): number {
	if (value === undefined) return fallback;
	if (!Number.isSafeInteger(value) || value < 1 || value > MAX_ATTEMPTS_LIMIT) {
		throw new RangeError('job_max_attempts_invalid');
	}
	return value;
}

function validatePayload(payload: JobPayload): void {
	if (payload.kind === 'undo') {
		assertUndoPlanPayload(payload.plan);
		if (
			!payload.planId?.trim() ||
			payload.plan.summary.operationCount === 0 ||
			canonicalJsonDigest(payload.plan).digest !== payload.digest
		) {
			throw new TypeError('Frozen undo job does not match its plan digest');
		}
		return;
	}
	if (payload.kind !== 'apply') return;
	assertApplyPlanPayload(payload.plan);
	if (
		!payload.planId?.trim() ||
		payload.plan.summary.operationCount === 0 ||
		canonicalJsonDigest(payload.plan).digest !== payload.digest
	) {
		throw new TypeError('Frozen apply job does not match its plan digest');
	}
}

function descriptorFromRow(
	row: Pick<JobRow, 'type' | 'payload' | 'idempotencyKey'>
): JobDescriptor {
	const payload = row.payload as unknown as JobPayload;
	return describeJob(payload, {
		persistedType: row.type as PersistedJobType,
		// Persisted keys are authoritative for old retry rows whose enqueue salt is
		// intentionally absent from the immutable execution payload.
		idempotencySalt: row.idempotencyKey?.startsWith('job:v1:')
			? undefined
			: (row.idempotencyKey ?? undefined)
	});
}

async function findExistingOrConflict(
	descriptor: JobDescriptor
): Promise<{ existing?: JobRow; conflict?: JobRow }> {
	const active = await db
		.select()
		.from(jobs)
		.where(inArray(jobs.status, [...ACTIVE_STATUSES]))
		.orderBy(asc(jobs.id));
	for (const row of active) {
		if (
			row.idempotencyKey === descriptor.idempotencyKey ||
			row.dedupeKey === descriptor.dedupeKey
		) {
			return { existing: row };
		}
		try {
			const relationship = relateJobs(descriptor, descriptorFromRow(row));
			if (relationship === 'equivalent') return { existing: row };
			if (relationship === 'conflict') return { conflict: row };
		} catch {
			// A legacy active row without an immutable payload is conservatively
			// serialized when it targets the same server.
			if (
				row.serverInstanceId &&
				descriptor.scope.serverInstanceIds.includes(row.serverInstanceId)
			) {
				return { conflict: row };
			}
		}
	}
	return {};
}

/**
 * Persist an immutable job plus its initial pending attempt. Exact active work is
 * reused; incompatible overlap is rejected with the owning job identity.
 */
export async function enqueueJobDetailed(
	payload: JobPayload,
	options: EnqueueJobOptions = {}
): Promise<EnqueueJobResult> {
	assertMutationsAllowed();
	validatePayload(payload);
	const maxAttempts = safePositiveInt(options.maxAttempts, 3);
	const trigger = sanitizeJobErrorText(options.trigger ?? 'enqueue').slice(0, 80);
	const descriptor = describeJob(payload, {
		persistedType: options.persistedType,
		idempotencySalt: `trigger:${trigger};input:${options.idempotencySalt ?? ''}`
	});
	const conflict = await findExistingOrConflict(descriptor);
	if (conflict.existing) return { jobId: conflict.existing.id, reused: true };
	if (conflict.conflict) {
		throw new JobConflictError(conflict.conflict.id, conflict.conflict.type);
	}

	const frozenPayload = descriptor.normalizedPayload;
	const serverInstanceId =
		descriptor.scope.serverInstanceIds.length === 1 ? descriptor.scope.serverInstanceIds[0] : null;
	const librarySectionKey =
		descriptor.scope.librarySectionKeys !== '*' && descriptor.scope.librarySectionKeys.length === 1
			? descriptor.scope.librarySectionKeys[0]
			: null;
	const availableAt = options.availableAt ?? now();
	const createdAt = now();
	const initiator = sanitizeJobErrorText(options.initiator ?? 'user').slice(0, 80);

	try {
		const [row] = await db
			.insert(jobs)
			.values({
				type: descriptor.persistedType,
				status: 'pending',
				processed: 0,
				total: 0,
				payload: frozenPayload as unknown as Record<string, unknown>,
				serverInstanceId,
				librarySectionKey,
				planId:
					frozenPayload.kind === 'apply' || frozenPayload.kind === 'undo'
						? frozenPayload.planId
						: null,
				parentJobId: options.parentJobId ?? null,
				initiator,
				idempotencyKey: descriptor.idempotencyKey,
				dedupeKey: descriptor.dedupeKey,
				attempt: 0,
				maxAttempts,
				availableAt,
				createdAt,
				updatedAt: createdAt
			})
			.returning();
		// A crash in this narrow gap is repaired by markInterruptedJobs(), which
		// materializes a missing pending attempt before claiming the job.
		await db.insert(jobAttempts).values({
			jobId: row.id,
			serverInstanceId,
			attemptNumber: 1,
			trigger,
			status: 'pending',
			createdAt
		});
		kickWorker();
		return { jobId: row.id, reused: false };
	} catch (error) {
		// The partial unique index closes the exact-dedupe race between concurrent
		// requests/processes. Resolve its winner without exposing the SQL error.
		const [winner] = await db
			.select()
			.from(jobs)
			.where(
				and(eq(jobs.dedupeKey, descriptor.dedupeKey), inArray(jobs.status, [...ACTIVE_STATUSES]))
			)
			.limit(1);
		if (winner) return { jobId: winner.id, reused: true };
		throw error;
	}
}

/** Compatibility API used by all existing routes. */
export async function enqueueJob(payload: JobPayload): Promise<number> {
	return (await enqueueJobDetailed(payload)).jobId;
}

async function ensureAttempt(
	job: JobRow,
	attemptNumber: number,
	status: 'pending' | 'running',
	trigger: string
): Promise<AttemptRow> {
	const [existing] = await db
		.select()
		.from(jobAttempts)
		.where(and(eq(jobAttempts.jobId, job.id), eq(jobAttempts.attemptNumber, attemptNumber)))
		.limit(1);
	if (existing) return existing;
	const [inserted] = await db
		.insert(jobAttempts)
		.values({
			jobId: job.id,
			serverInstanceId: job.serverInstanceId,
			attemptNumber,
			trigger,
			status,
			createdAt: now()
		})
		.returning();
	return inserted;
}

async function claimNextJob(): Promise<{ job: JobRow; attempt: AttemptRow } | null> {
	const claimedAt = now();
	const [candidate] = await db
		.select()
		.from(jobs)
		.where(
			and(
				inArray(jobs.status, [...CLAIMABLE_STATUSES]),
				or(isNull(jobs.availableAt), lte(jobs.availableAt, claimedAt)),
				isNull(jobs.cancelRequestedAt)
			)
		)
		.orderBy(asc(jobs.availableAt), asc(jobs.id))
		.limit(1);
	if (!candidate) return null;
	const leaseExpiresAt = new Date(claimedAt.getTime() + LEASE_MS);
	// The guarded UPDATE is the atomic claim boundary. Another worker that selected
	// the same candidate receives no row and tries again.
	const [job] = await db
		.update(jobs)
		.set({
			status: 'running',
			attempt: sql`${jobs.attempt} + 1`,
			startedAt: candidate.startedAt ?? claimedAt,
			finishedAt: null,
			leaseOwner: WORKER_ID,
			leaseExpiresAt,
			updatedAt: claimedAt
		})
		.where(
			and(
				eq(jobs.id, candidate.id),
				inArray(jobs.status, [...CLAIMABLE_STATUSES]),
				or(isNull(jobs.availableAt), lte(jobs.availableAt, claimedAt)),
				isNull(jobs.cancelRequestedAt)
			)
		)
		.returning();
	if (!job) return null;
	const attemptNumber = job.attempt;
	let [attempt] = await db
		.update(jobAttempts)
		.set({
			status: 'running',
			leaseOwner: WORKER_ID,
			leaseExpiresAt,
			startedAt: claimedAt
		})
		.where(
			and(
				eq(jobAttempts.jobId, job.id),
				eq(jobAttempts.attemptNumber, attemptNumber),
				eq(jobAttempts.status, 'pending')
			)
		)
		.returning();
	if (!attempt) {
		[attempt] = await db
			.insert(jobAttempts)
			.values({
				jobId: job.id,
				serverInstanceId: job.serverInstanceId,
				attemptNumber,
				trigger: attemptNumber === 1 ? 'enqueue' : 'recovery',
				status: 'running',
				leaseOwner: WORKER_ID,
				leaseExpiresAt,
				createdAt: claimedAt,
				startedAt: claimedAt
			})
			.returning();
	}
	return { job, attempt };
}

async function heartbeat(jobId: number): Promise<void> {
	const heartbeatAt = now();
	const [row] = await db
		.update(jobs)
		.set({
			leaseExpiresAt: new Date(heartbeatAt.getTime() + LEASE_MS),
			updatedAt: heartbeatAt
		})
		.where(and(eq(jobs.id, jobId), eq(jobs.status, 'running'), eq(jobs.leaseOwner, WORKER_ID)))
		.returning({ cancelRequestedAt: jobs.cancelRequestedAt, attempt: jobs.attempt });
	if (row?.cancelRequestedAt) cancelled.add(jobId);
	if (row) {
		await db
			.update(jobAttempts)
			.set({ leaseExpiresAt: new Date(heartbeatAt.getTime() + LEASE_MS) })
			.where(
				and(
					eq(jobAttempts.jobId, jobId),
					eq(jobAttempts.attemptNumber, row.attempt),
					eq(jobAttempts.status, 'running')
				)
			);
	}
}

async function insertOutcome(
	job: JobRow,
	attempt: AttemptRow,
	input: JobItemOutcomeInput
): Promise<void> {
	const classified = input.error === undefined ? null : classifyJobFailure(input.error);
	await db.insert(jobItemOutcomes).values({
		jobId: job.id,
		attemptId: attempt.id,
		serverInstanceId: input.serverInstanceId,
		mediaItemId: input.mediaItemId ?? null,
		destination: input.destination ?? null,
		kind: input.kind ?? null,
		season: input.season ?? null,
		episode: input.episode ?? null,
		status: input.status,
		retryable:
			input.status === 'failed' ? (input.retryable ?? classified?.retryable ?? false) : false,
		result: input.result ? sanitizedResult(input.result) : null,
		errorCode: input.errorCode ?? classified?.code ?? null,
		error: classified?.message ?? null,
		createdAt: now(),
		updatedAt: now()
	});
}

async function persistApplyOutcomes(
	job: JobRow,
	attempt: AttemptRow,
	result: Extract<WorkerTaskResult, { planId: string }>
): Promise<void> {
	for (const item of result.items) {
		for (const operation of item.operations) {
			const classified =
				operation.status === 'failed'
					? classifyJobFailure(operation.error ?? operation.errorCode ?? 'apply_operation_failed')
					: null;
			await insertOutcome(job, attempt, {
				serverInstanceId: item.serverInstanceId,
				mediaItemId: item.mediaItemId,
				destination: operation.destination,
				kind: operation.slot.kind,
				season: operation.slot.season,
				episode: operation.slot.episode,
				status: operation.status,
				retryable: classified?.retryable ?? false,
				result: {
					operationId: operation.operationId,
					targetId: operation.targetId,
					verification: operation.verification ?? null,
					observedFingerprint: operation.observedFingerprint ?? null,
					artworkVersion: operation.artworkVersion ?? null
				},
				errorCode: operation.errorCode ?? classified?.code,
				error: operation.error
			});
		}
		for (const skip of item.skips) {
			await insertOutcome(job, attempt, {
				serverInstanceId: item.serverInstanceId,
				mediaItemId: item.mediaItemId,
				destination: skip.destination,
				kind: skip.slot?.kind,
				season: skip.slot?.season,
				episode: skip.slot?.episode,
				status: 'skipped',
				result: { code: skip.code, parameters: skip.parameters }
			});
		}
	}
}

function resultCounts(result: WorkerTaskResult | undefined): {
	succeeded: number;
	failed: number;
} {
	if (!result) return { succeeded: 0, failed: 0 };
	const summary = result.summary as unknown as Record<string, unknown>;
	return {
		succeeded: Number(summary.succeeded ?? 0),
		failed: Number(summary.failed ?? 0)
	};
}

async function finish(
	job: JobRow,
	attempt: AttemptRow,
	status: TerminalJobStatus,
	result: Record<string, unknown>,
	error?: { code: string; message: string; retryable: boolean }
): Promise<void> {
	const finishedAt = now();
	await db
		.update(jobAttempts)
		.set({
			status,
			result,
			retryable: error?.retryable ?? (status === 'partial_failed' || status === 'failed'),
			errorCode: error?.code ?? null,
			error: error?.message ?? null,
			leaseOwner: null,
			leaseExpiresAt: null,
			finishedAt
		})
		.where(and(eq(jobAttempts.id, attempt.id), eq(jobAttempts.status, 'running')));
	await db
		.update(jobs)
		.set({
			status,
			result,
			errorCode: error?.code ?? null,
			error: error?.message ?? null,
			leaseOwner: null,
			leaseExpiresAt: null,
			finishedAt,
			updatedAt: finishedAt
		})
		.where(and(eq(jobs.id, job.id), eq(jobs.leaseOwner, WORKER_ID)));
	const payload = job.payload as unknown as JobPayload;
	if (payload.kind === 'automation') {
		try {
			await automationStore.completeOccurrence({
				occurrenceId: payload.occurrenceId,
				jobId: job.id,
				status:
					status === 'completed'
						? 'completed'
						: status === 'partial_failed'
							? 'partial_failed'
							: 'failed',
				result,
				errorCode: error?.code ?? null
			});
		} catch {
			// The scheduler reconciles this narrow enqueue/attach or crash gap from
			// the durable terminal job on its next poll.
		}
	}
	await emit(job.id);
	notifyDrained();
}

async function scheduleRetry(
	job: JobRow,
	attempt: AttemptRow,
	failure: ReturnType<typeof classifyJobFailure>
): Promise<void> {
	const failedAt = now();
	const payload = job.payload as unknown as JobPayload;
	const retryPolicy =
		payload.kind === 'automation'
			? {
					baseDelayMs: payload.occurrence.retryPolicy.baseDelayMs,
					maxDelayMs: payload.occurrence.retryPolicy.maxDelayMs,
					jitterRatio: DEFAULT_RETRY_POLICY.jitterRatio
				}
			: DEFAULT_RETRY_POLICY;
	const delayMs = calculateRetryDelayMs(job.attempt, retryPolicy);
	const availableAt = new Date(failedAt.getTime() + delayMs);
	const result = {
		failure: {
			code: failure.code,
			retryable: true,
			recommendedAction: failure.recommendedAction
		},
		nextAttempt: job.attempt + 1,
		availableAt: availableAt.toISOString()
	};
	await db
		.update(jobAttempts)
		.set({
			status: 'failed',
			result,
			retryable: true,
			errorCode: failure.code,
			error: failure.message,
			leaseOwner: null,
			leaseExpiresAt: null,
			finishedAt: failedAt
		})
		.where(eq(jobAttempts.id, attempt.id));
	await db
		.update(jobs)
		.set({
			status: 'retry_scheduled',
			result,
			errorCode: failure.code,
			error: failure.message,
			availableAt,
			leaseOwner: null,
			leaseExpiresAt: null,
			updatedAt: failedAt
		})
		.where(and(eq(jobs.id, job.id), eq(jobs.leaseOwner, WORKER_ID)));
	await db
		.insert(jobAttempts)
		.values({
			jobId: job.id,
			serverInstanceId: job.serverInstanceId,
			attemptNumber: job.attempt + 1,
			trigger: 'automatic_retry',
			status: 'pending',
			createdAt: failedAt
		})
		.onConflictDoNothing();
	await emit(job.id);
}

async function runClaimed(entry: { job: JobRow; attempt: AttemptRow }): Promise<void> {
	const { job, attempt } = entry;
	const payload = job.payload as unknown as JobPayload;
	let heartbeatBusy = false;
	const heartbeatTimer = setInterval(() => {
		if (heartbeatBusy) return;
		heartbeatBusy = true;
		void heartbeat(job.id)
			.catch(() => undefined)
			.finally(() => {
				heartbeatBusy = false;
			});
	}, HEARTBEAT_MS);
	(heartbeatTimer as unknown as { unref?: () => void }).unref?.();
	await emit(job.id);

	const ctx: JobContext = {
		jobId: job.id,
		isCancelled: () => cancelled.has(job.id),
		setPhase: async (phase) => {
			const normalized = phase
				? phase
						.toLowerCase()
						.replace(/[^a-z0-9_.-]/g, '_')
						.slice(0, 80)
				: null;
			await db
				.update(jobs)
				.set({ phase: normalized, updatedAt: now() })
				.where(and(eq(jobs.id, job.id), eq(jobs.leaseOwner, WORKER_ID)));
			await heartbeat(job.id);
			await emit(job.id);
		},
		setTotal: async (total) => {
			if (!Number.isSafeInteger(total) || total < 0) throw new RangeError('job_total_invalid');
			await db
				.update(jobs)
				.set({ total, updatedAt: now() })
				.where(and(eq(jobs.id, job.id), eq(jobs.leaseOwner, WORKER_ID)));
			await heartbeat(job.id);
			await emit(job.id);
		},
		progress: async (processed, currentItem) => {
			if (!Number.isSafeInteger(processed) || processed < 0) {
				throw new RangeError('job_progress_invalid');
			}
			await db
				.update(jobs)
				.set({
					processed,
					currentItem: currentItem?.slice(0, 250) ?? null,
					updatedAt: now()
				})
				.where(and(eq(jobs.id, job.id), eq(jobs.leaseOwner, WORKER_ID)));
			await heartbeat(job.id);
			await emit(job.id);
		},
		recordOutcome: (outcome) => insertOutcome(job, attempt, outcome)
	};

	try {
		validatePayload(payload);
		let taskResult: WorkerTaskResult | undefined;
		if (payload.kind === 'sync') taskResult = await runSyncJob(ctx, payload);
		else if (payload.kind === 'discover') taskResult = await runDiscoverJob(ctx, payload);
		else if (payload.kind === 'automation') {
			taskResult = await runAutomationJob(ctx, payload);
		} else if (payload.kind === 'undo') {
			taskResult = await runUndoJob(ctx, payload);
		} else {
			taskResult = await runApplyJob(ctx, payload);
			await persistApplyOutcomes(job, attempt, taskResult);
		}

		if (payload.kind === 'sync' && !cancelled.has(job.id)) {
			const events = (taskResult as JobTaskResult | undefined)?.automationEvents;
			if (events) {
				await notifyAutomationEvent({
					serverInstanceId: payload.serverInstanceId,
					eventType: 'sync_completed',
					eventIdentity: `job:${job.id}:sync_completed`,
					librarySectionKeys: events.librarySectionKeys
				}).catch(() => undefined);
				if (events.newItems.length) {
					await notifyAutomationEvent({
						serverInstanceId: payload.serverInstanceId,
						eventType: 'new_items',
						eventIdentity: `job:${job.id}:new_items`,
						librarySectionKeys: events.librarySectionKeys,
						items: events.newItems
					}).catch(() => undefined);
				}
			}
		}

		const safeResult = sanitizedResult(taskResult ?? {});
		if (cancelled.has(job.id)) {
			await finish(job, attempt, 'cancelled', safeResult, {
				code: 'cancelled',
				message: 'cancelled',
				retryable: false
			});
			return;
		}
		const counts = resultCounts(taskResult);
		if (counts.failed > 0) {
			await finish(job, attempt, counts.succeeded > 0 ? 'partial_failed' : 'failed', safeResult, {
				code: 'item_failures',
				message: 'One or more scoped units failed',
				retryable: true
			});
			return;
		}
		await finish(job, attempt, 'completed', safeResult);
	} catch (error) {
		const failure = classifyJobFailure(error);
		let descriptor: JobDescriptor | null = null;
		try {
			descriptor = descriptorFromRow(job);
		} catch {
			// Invalid persisted payloads are permanent failures.
		}
		if (
			!cancelled.has(job.id) &&
			failure.retryable &&
			descriptor?.safeToReplay &&
			job.attempt < job.maxAttempts
		) {
			await scheduleRetry(job, attempt, failure);
		} else {
			await finish(
				job,
				attempt,
				cancelled.has(job.id) ? 'cancelled' : 'failed',
				{
					failure: {
						code: failure.code,
						retryable: false,
						recommendedAction:
							descriptor?.safeToReplay === false ? 'review' : failure.recommendedAction
					}
				},
				{
					code: cancelled.has(job.id) ? 'cancelled' : failure.code,
					message: cancelled.has(job.id) ? 'cancelled' : failure.message,
					retryable: false
				}
			);
		}
	} finally {
		clearInterval(heartbeatTimer);
		cancelled.delete(job.id);
	}
}

function kickWorker(): void {
	if (wakeTimer) {
		clearTimeout(wakeTimer);
		wakeTimer = null;
	}
	void pump().catch(() => {
		// Keep a database/worker-cycle failure from becoming an unhandled rejection.
		// The next durable wake retries the claim; task errors are handled separately.
		if (!wakeTimer) {
			wakeTimer = setTimeout(() => {
				wakeTimer = null;
				kickWorker();
			}, 1_000);
			(wakeTimer as unknown as { unref?: () => void }).unref?.();
		}
	});
}

async function pump(): Promise<void> {
	if (working) return;
	working = true;
	try {
		while (true) {
			const entry = await claimNextJob();
			if (!entry) break;
			await runClaimed(entry);
		}
	} finally {
		working = false;
		await scheduleNextWake();
		notifyDrained();
	}
}

async function scheduleNextWake(): Promise<void> {
	if (wakeTimer) clearTimeout(wakeTimer);
	wakeTimer = null;
	const current = now();
	const [queued] = await db
		.select({ availableAt: jobs.availableAt })
		.from(jobs)
		.where(and(inArray(jobs.status, [...CLAIMABLE_STATUSES]), isNull(jobs.cancelRequestedAt)))
		.orderBy(asc(jobs.availableAt), asc(jobs.id))
		.limit(1);
	const [leased] = await db
		.select({ leaseExpiresAt: jobs.leaseExpiresAt })
		.from(jobs)
		.where(eq(jobs.status, 'running'))
		.orderBy(asc(jobs.leaseExpiresAt))
		.limit(1);
	const dueTimes = [queued?.availableAt, leased?.leaseExpiresAt]
		.filter((date): date is Date => date instanceof Date)
		.map((date) => date.getTime());
	if (queued && !queued.availableAt) dueTimes.push(current.getTime());
	if (!dueTimes.length) return;
	const delay = Math.max(0, Math.min(...dueTimes) - current.getTime());
	wakeTimer = setTimeout(
		() => {
			wakeTimer = null;
			void recoverExpiredLeases()
				.catch(() => undefined)
				.finally(kickWorker);
		},
		Math.min(delay, 2_147_000_000)
	);
	(wakeTimer as unknown as { unref?: () => void }).unref?.();
}

function notifyDrained(): void {
	void (async () => {
		const [active] = await db
			.select({ count: sql<number>`count(*)` })
			.from(jobs)
			.where(inArray(jobs.status, [...ACTIVE_STATUSES]));
		if ((active?.count ?? 0) !== 0) return;
		for (const resolve of drainWaiters) resolve();
		drainWaiters.clear();
	})().catch(() => undefined);
}

/** Wait until all work accepted before maintenance reaches a terminal state. */
export async function drainJobQueue(timeoutMs = 60_000): Promise<void> {
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		throw new RangeError('job drain timeout must be positive');
	}
	const [active] = await db
		.select({ count: sql<number>`count(*)` })
		.from(jobs)
		.where(inArray(jobs.status, [...ACTIVE_STATUSES]));
	if ((active?.count ?? 0) === 0) return;
	await new Promise<void>((resolve, reject) => {
		const done = () => {
			clearTimeout(timer);
			drainWaiters.delete(done);
			resolve();
		};
		const timer = setTimeout(() => {
			drainWaiters.delete(done);
			reject(new Error('job_drain_timeout'));
		}, timeoutMs);
		drainWaiters.add(done);
	});
}

/** Persist a cancellation request; queued work becomes terminal immediately. */
export async function cancelJob(jobId: number): Promise<boolean> {
	if (!Number.isSafeInteger(jobId) || jobId <= 0) return false;
	const requestedAt = now();
	const queued = await db
		.update(jobs)
		.set({
			status: 'cancelled',
			cancelRequestedAt: requestedAt,
			finishedAt: requestedAt,
			errorCode: 'cancelled',
			error: 'cancelled',
			updatedAt: requestedAt
		})
		.where(and(eq(jobs.id, jobId), inArray(jobs.status, [...CLAIMABLE_STATUSES])))
		.returning({ id: jobs.id });
	if (queued.length === 1) {
		await db
			.update(jobAttempts)
			.set({
				status: 'cancelled',
				retryable: false,
				errorCode: 'cancelled',
				error: 'cancelled',
				finishedAt: requestedAt
			})
			.where(and(eq(jobAttempts.jobId, jobId), eq(jobAttempts.status, 'pending')));
		await emit(jobId);
		notifyDrained();
		return true;
	}

	// The guarded queued update and this running update form one CAS ladder. If a
	// worker claims the row between them, the second step persists cancellation
	// instead of reporting success while silently letting the job continue.
	const running = await db
		.update(jobs)
		.set({ cancelRequestedAt: requestedAt, updatedAt: requestedAt })
		.where(and(eq(jobs.id, jobId), eq(jobs.status, 'running')))
		.returning({ id: jobs.id });
	if (running.length === 1) {
		cancelled.add(jobId);
		return true;
	}
	cancelled.delete(jobId);
	return false;
}

async function persistInterruptedApplyUnits(job: JobRow, attemptId: number | null): Promise<void> {
	const payload = job.payload as unknown as JobPayload;
	if (payload.kind !== 'apply') return;
	const previous = await db
		.select({ result: jobItemOutcomes.result })
		.from(jobItemOutcomes)
		.where(eq(jobItemOutcomes.jobId, job.id));
	const recorded = new Set(
		previous
			.map((row) => row.result?.operationId)
			.filter((id): id is string => typeof id === 'string')
	);
	for (const item of payload.plan.items) {
		for (const operation of item.operations) {
			if (recorded.has(operation.id)) continue;
			await db.insert(jobItemOutcomes).values({
				jobId: job.id,
				attemptId,
				serverInstanceId: item.target.serverInstanceId,
				mediaItemId: item.target.mediaItemId,
				destination: operation.destination,
				kind: operation.slot.kind,
				season: operation.slot.season,
				episode: operation.slot.episode,
				status: 'interrupted',
				retryable: false,
				result: { operationId: operation.id, targetId: operation.targetId },
				errorCode: 'interrupted_requires_review',
				error: 'Interrupted mutation requires revision review',
				createdAt: now(),
				updatedAt: now()
			});
		}
	}
}

/** Recover only expired leases; safe work re-enters the durable queue. */
export async function recoverExpiredLeases(at = now()): Promise<{
	retried: number;
	interrupted: number;
}> {
	const expired = await db
		.select()
		.from(jobs)
		.where(
			and(eq(jobs.status, 'running'), or(isNull(jobs.leaseExpiresAt), lte(jobs.leaseExpiresAt, at)))
		);
	let retried = 0;
	let interrupted = 0;
	for (const job of expired) {
		let descriptor: JobDescriptor | null = null;
		try {
			descriptor = descriptorFromRow(job);
		} catch {
			// Malformed work is never replayed.
		}
		const [attempt] = await db
			.select()
			.from(jobAttempts)
			.where(and(eq(jobAttempts.jobId, job.id), eq(jobAttempts.attemptNumber, job.attempt)))
			.limit(1);
		const retry =
			!job.cancelRequestedAt && !!descriptor?.safeToReplay && job.attempt < job.maxAttempts;
		// Claim recovery before touching attempt/outcome state. Binding the selected
		// attempt, owner, and cancellation marker prevents an ABA lease or concurrent
		// cancel/finish from being classified using stale data. Keep this as one short
		// autocommit CAS: concurrent libsql transactions can surface SQLITE_BUSY before
		// either contender reaches its guarded UPDATE.
		const winner = await db
			.update(jobs)
			.set({
				status: job.cancelRequestedAt ? 'cancelled' : retry ? 'retry_scheduled' : 'interrupted',
				availableAt: retry ? at : job.availableAt,
				leaseOwner: null,
				leaseExpiresAt: null,
				errorCode: job.cancelRequestedAt ? 'cancelled' : 'lease_expired',
				error: job.cancelRequestedAt
					? 'cancelled'
					: retry
						? 'Interrupted safe work scheduled for recovery'
						: 'Interrupted mutation requires review',
				finishedAt: retry ? null : at,
				updatedAt: at
			})
			.where(
				and(
					eq(jobs.id, job.id),
					eq(jobs.status, 'running'),
					eq(jobs.attempt, job.attempt),
					job.leaseOwner === null ? isNull(jobs.leaseOwner) : eq(jobs.leaseOwner, job.leaseOwner),
					job.cancelRequestedAt === null
						? isNull(jobs.cancelRequestedAt)
						: eq(jobs.cancelRequestedAt, job.cancelRequestedAt),
					or(isNull(jobs.leaseExpiresAt), lte(jobs.leaseExpiresAt, at))
				)
			)
			.returning({ id: jobs.id });
		if (winner.length !== 1) continue;

		if (attempt) {
			await db
				.update(jobAttempts)
				.set({
					status: 'interrupted',
					retryable: retry,
					errorCode: 'lease_expired',
					error: 'Worker lease expired',
					leaseOwner: null,
					leaseExpiresAt: null,
					finishedAt: at
				})
				.where(and(eq(jobAttempts.id, attempt.id), eq(jobAttempts.status, 'running')));
		}
		if (retry) {
			await db
				.insert(jobAttempts)
				.values({
					jobId: job.id,
					serverInstanceId: job.serverInstanceId,
					attemptNumber: job.attempt + 1,
					trigger: 'lease_recovery',
					status: 'pending',
					createdAt: at
				})
				.onConflictDoNothing();
		}
		if (retry) retried++;
		else {
			interrupted++;
			await persistInterruptedApplyUnits(job, attempt?.id ?? null);
		}
		await emit(job.id);
	}
	return { retried, interrupted };
}

/**
 * Boot compatibility entrypoint. Pending/retry rows remain durable and are
 * re-entered; only expired running leases are classified as interrupted/retryable.
 */
export async function markInterruptedJobs(): Promise<void> {
	await recoverExpiredLeases();
	const pending = await db
		.select()
		.from(jobs)
		.where(inArray(jobs.status, [...CLAIMABLE_STATUSES]));
	for (const job of pending) {
		if (job.cancelRequestedAt) {
			await cancelJob(job.id);
			continue;
		}
		await ensureAttempt(job, job.attempt + 1, 'pending', job.attempt ? 'recovery' : 'enqueue');
	}
	kickWorker();
}

async function emit(jobId: number): Promise<void> {
	const [row] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
	if (!row) return;
	emitProgress({
		jobId,
		processed: row.processed,
		total: row.total,
		currentItem: row.currentItem,
		status: row.status
	});
}
