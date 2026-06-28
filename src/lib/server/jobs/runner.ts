import { eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { jobs } from '$lib/server/db/schema';
import { emitProgress } from './events';
import { runApplyJob, runDiscoverJob, runSyncJob, type JobPayload, type JobType } from './tasks';

/** Helpers passed to each job task for progress + cancellation. */
export interface JobContext {
	jobId: number;
	isCancelled(): boolean;
	setTotal(total: number): Promise<void>;
	progress(processed: number, currentItem: string | null): Promise<void>;
}

interface QueueEntry {
	jobId: number;
	payload: JobPayload;
}

const queue: QueueEntry[] = [];
const cancelled = new Set<number>();
let working = false;

/** Enqueue a job, persist it as pending, and kick the worker. Returns the job id. */
export async function enqueueJob(payload: JobPayload): Promise<number> {
	const type: JobType = payload.kind;
	const [row] = await db
		.insert(jobs)
		.values({ type, status: 'pending', processed: 0, total: 0 })
		.returning();
	queue.push({ jobId: row.id, payload });
	void pump();
	return row.id;
}

/** Request cancellation of a queued or running job. */
export function cancelJob(jobId: number): void {
	cancelled.add(jobId);
}

async function pump(): Promise<void> {
	if (working) return;
	working = true;
	try {
		while (queue.length) {
			const entry = queue.shift();
			if (entry) await runEntry(entry);
		}
	} finally {
		working = false;
	}
}

async function runEntry(entry: QueueEntry): Promise<void> {
	const { jobId, payload } = entry;

	if (cancelled.has(jobId)) {
		await finish(jobId, 'cancelled');
		cancelled.delete(jobId);
		return;
	}

	await db.update(jobs).set({ status: 'running', startedAt: new Date() }).where(eq(jobs.id, jobId));
	await emit(jobId);

	const ctx: JobContext = {
		jobId,
		isCancelled: () => cancelled.has(jobId),
		setTotal: async (total) => {
			await db.update(jobs).set({ total }).where(eq(jobs.id, jobId));
			await emit(jobId);
		},
		progress: async (processed, currentItem) => {
			await db.update(jobs).set({ processed, currentItem }).where(eq(jobs.id, jobId));
			await emit(jobId);
		}
	};

	try {
		if (payload.kind === 'sync') await runSyncJob(ctx, payload);
		else if (payload.kind === 'discover') await runDiscoverJob(ctx, payload);
		else await runApplyJob(ctx, payload);
		await finish(jobId, cancelled.has(jobId) ? 'cancelled' : 'completed');
	} catch (e) {
		await db
			.update(jobs)
			.set({
				status: 'failed',
				error: e instanceof Error ? e.message : String(e),
				finishedAt: new Date()
			})
			.where(eq(jobs.id, jobId));
		await emit(jobId);
	} finally {
		cancelled.delete(jobId);
	}
}

async function finish(jobId: number, status: 'completed' | 'cancelled'): Promise<void> {
	await db.update(jobs).set({ status, finishedAt: new Date() }).where(eq(jobs.id, jobId));
	await emit(jobId);
}

async function emit(jobId: number): Promise<void> {
	const [row] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
	if (row) {
		emitProgress({
			jobId,
			processed: row.processed,
			total: row.total,
			currentItem: row.currentItem,
			status: row.status
		});
	}
}

/** On startup, mark any job left pending/running by a crash as interrupted. */
export async function markInterruptedJobs(): Promise<void> {
	await db
		.update(jobs)
		.set({ status: 'interrupted', finishedAt: new Date() })
		.where(inArray(jobs.status, ['pending', 'running']));
}
