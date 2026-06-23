import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';

// Swappable task implementation so each test controls what the worker runs.
const h = vi.hoisted(() => ({ syncImpl: null as null | ((ctx: unknown) => Promise<void>) }));

vi.mock('./tasks', () => ({
	runSyncJob: (ctx: unknown) => (h.syncImpl ? h.syncImpl(ctx) : Promise.resolve()),
	runDiscoverJob: () => Promise.resolve(),
	runApplyJob: () => Promise.resolve()
}));

// Real in-memory libsql DB so the runner exercises actual SQL, not brittle mocks.
vi.mock('$lib/server/db', async () => {
	const { drizzle } = await import('drizzle-orm/libsql');
	const { createClient } = await import('@libsql/client');
	const { migrate } = await import('drizzle-orm/libsql/migrator');
	const schema = await import('../db/schema');
	const client = createClient({ url: ':memory:' });
	const db = drizzle(client, { schema });
	await migrate(db, { migrationsFolder: './drizzle' });
	return { db, migrateDb: async () => {} };
});

import { db } from '$lib/server/db';
import { jobs } from '$lib/server/db/schema';
import { cancelJob, enqueueJob, markInterruptedJobs } from './runner';

interface Ctx {
	setTotal(n: number): Promise<void>;
	progress(p: number, c: string | null): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
	beforeEach(() => {
		h.syncImpl = null;
	});

	it('runs a job to completion and records progress', async () => {
		h.syncImpl = async (ctx) => {
			const c = ctx as Ctx;
			await c.setTotal(2);
			await c.progress(1, 'a');
			await c.progress(2, 'b');
		};
		const id = await enqueueJob({ kind: 'sync' });
		const j = await waitFor(id, ['completed']);
		expect(j.processed).toBe(2);
		expect(j.total).toBe(2);
	});

	it('marks a job failed when its task throws', async () => {
		h.syncImpl = async () => {
			throw new Error('boom');
		};
		const id = await enqueueJob({ kind: 'sync' });
		const j = await waitFor(id, ['failed']);
		expect(j.error).toContain('boom');
	});

	it('cancels a running job', async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		h.syncImpl = async (ctx) => {
			await (ctx as Ctx).setTotal(1);
			await gate;
		};
		const id = await enqueueJob({ kind: 'sync' });
		await waitFor(id, ['running']);
		cancelJob(id);
		release();
		const j = await waitFor(id, ['cancelled']);
		expect(j.status).toBe('cancelled');
	});

	it('marks pending/running jobs interrupted on startup', async () => {
		const [a] = await db
			.insert(jobs)
			.values({ type: 'sync', status: 'running', processed: 0, total: 0 })
			.returning();
		const [b] = await db
			.insert(jobs)
			.values({ type: 'discover', status: 'pending', processed: 0, total: 0 })
			.returning();
		await markInterruptedJobs();
		expect((await getJob(a.id)).status).toBe('interrupted');
		expect((await getJob(b.id)).status).toBe('interrupted');
	});
});
