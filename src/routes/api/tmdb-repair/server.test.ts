import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	enqueue: vi.fn(),
	getActiveServer: vi.fn(),
	countPending: vi.fn()
}));

vi.mock('$lib/server/jobs/runner', () => ({ enqueueJob: h.enqueue }));
vi.mock('$lib/server/server-instances', () => ({
	getActiveServerInstance: h.getActiveServer
}));
vi.mock('$lib/server/tmdb/repair', () => ({ countPendingTmdbRepairs: h.countPending }));

import { POST } from './+server';

function event() {
	return {} as Parameters<typeof POST>[0];
}

describe('POST /api/tmdb-repair', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.getActiveServer.mockResolvedValue({ id: 'server-a' });
		h.countPending.mockResolvedValue(3);
		h.enqueue.mockResolvedValue(72);
	});

	it('enqueues a selective repair for the active server', async () => {
		const response = await POST(event());
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ jobId: 72, pendingCount: 3 });
		expect(h.enqueue).toHaveBeenCalledWith({
			kind: 'tmdb_repair',
			serverInstanceId: 'server-a'
		});
	});

	it('does not enqueue after the durable pending set reaches zero', async () => {
		h.countPending.mockResolvedValue(0);
		const response = await POST(event());
		expect(await response.json()).toEqual({ jobId: null, pendingCount: 0 });
		expect(h.enqueue).not.toHaveBeenCalled();
	});

	it('keeps server instances isolated', async () => {
		h.getActiveServer.mockResolvedValue({ id: 'server-b' });
		await POST(event());
		expect(h.countPending).toHaveBeenCalledWith('server-b');
		expect(h.enqueue).toHaveBeenCalledWith({
			kind: 'tmdb_repair',
			serverInstanceId: 'server-b'
		});
	});

	it('returns the owning job when same-server sync work conflicts', async () => {
		h.enqueue.mockRejectedValue({
			code: 'job_conflict',
			conflictingJobId: 81,
			conflictingJobType: 'sync'
		});
		const response = await POST(event());
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: { code: 'job_conflict', conflictingJobId: 81, conflictingJobType: 'sync' }
		});
	});
});
