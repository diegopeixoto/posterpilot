import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	enqueue: vi.fn(),
	getActiveServer: vi.fn()
}));

vi.mock('$lib/server/jobs/runner', () => ({ enqueueJob: h.enqueue }));
vi.mock('$lib/server/server-instances', () => ({
	getActiveServerInstance: h.getActiveServer
}));

import { POST } from './+server';

function event(body?: unknown) {
	return {
		request: new Request('http://localhost/api/sync', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			...(body === undefined ? {} : { body: JSON.stringify(body) })
		})
	} as Parameters<typeof POST>[0];
}

describe('POST /api/sync', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.enqueue.mockResolvedValue(71);
		h.getActiveServer.mockResolvedValue({ id: 'server-a' });
	});

	it('freezes the active instance and explicit full-rescan mode into the job', async () => {
		const response = await POST(event({ full: true }));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ jobId: 71 });
		expect(h.enqueue).toHaveBeenCalledWith({
			kind: 'sync',
			serverInstanceId: 'server-a',
			full: true
		});
	});

	it('rejects sync when there is no active named instance', async () => {
		h.getActiveServer.mockResolvedValue(null);
		const response = await POST(event());
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: { code: 'server_instance_not_found' }
		});
		expect(h.enqueue).not.toHaveBeenCalled();
	});

	it('returns the owning job for incompatible active work', async () => {
		h.enqueue.mockRejectedValue({
			code: 'job_conflict',
			conflictingJobId: 81,
			conflictingJobType: 'full_rescan'
		});
		const response = await POST(event());
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: {
				code: 'job_conflict',
				conflictingJobId: 81,
				conflictingJobType: 'full_rescan'
			}
		});
	});
});
