import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	active: vi.fn(),
	confirm: vi.fn(),
	enqueue: vi.fn()
}));

vi.mock('$lib/server/db', () => ({ db: {} }));

vi.mock('$lib/server/plans/apply-runtime', () => ({
	activeApplyServerInstanceId: h.active,
	confirmDatabaseArtworkApply: h.confirm
}));
vi.mock('$lib/server/jobs/runner', () => ({ enqueueJob: h.enqueue }));

import { POST } from './+server';

describe('POST /api/apply', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.active.mockResolvedValue('server-a');
		h.confirm.mockResolvedValue({ jobId: 7, planId: 'plan-1', digest: 'b'.repeat(64) });
	});

	it('requires plan id and digest instead of mutable apply inputs', async () => {
		const response = await POST({
			request: new Request('http://localhost/api/apply', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ itemIds: [1], method: 'both', selection: 'auto' })
			})
		} as Parameters<typeof POST>[0]);
		expect(response.status).toBe(400);
		expect(h.confirm).not.toHaveBeenCalled();
	});

	it('confirms only the frozen plan in the active server scope', async () => {
		const response = await POST({
			request: new Request('http://localhost/api/apply', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ planId: 'plan-1', digest: 'b'.repeat(64) })
			})
		} as Parameters<typeof POST>[0]);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			jobId: 7,
			planId: 'plan-1',
			digest: 'b'.repeat(64)
		});
		expect(h.confirm).toHaveBeenCalledWith(
			{ planId: 'plan-1', digest: 'b'.repeat(64), serverInstanceId: 'server-a' },
			h.enqueue
		);
	});

	it('returns the conflicting durable job instead of executing an overlapping plan', async () => {
		h.confirm.mockRejectedValue({
			code: 'job_conflict',
			conflictingJobId: 22,
			conflictingJobType: 'full_rescan'
		});
		const response = await POST({
			request: new Request('http://localhost/api/apply', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ planId: 'plan-1', digest: 'b'.repeat(64) })
			})
		} as Parameters<typeof POST>[0]);
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: {
				code: 'job_conflict',
				conflictingJobId: 22,
				conflictingJobType: 'full_rescan'
			}
		});
	});
});
