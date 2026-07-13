import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
	class ApplyAndNextError extends Error {
		constructor(readonly code: string) {
			super(code);
		}
	}
	return { active: vi.fn(), complete: vi.fn(), ApplyAndNextError };
});

vi.mock('$lib/server/server-instances', () => ({ getActiveServerInstance: h.active }));
vi.mock('$lib/server/review', () => ({
	ApplyAndNextError: h.ApplyAndNextError,
	completeReviewAfterVerifiedApply: h.complete
}));

import { POST } from './+server';

function event(id = '12', body: unknown = { jobId: 33 }) {
	return {
		params: { id },
		request: new Request(`http://localhost/api/review/items/${id}/apply-next-complete`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	} as Parameters<typeof POST>[0];
}

describe('POST /api/review/items/[id]/apply-next-complete', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.active.mockResolvedValue({ id: 'server-a' });
		h.complete.mockResolvedValue({ state: 'completed', eventId: 4 });
	});

	it('binds completion to the active server, item, and terminal job', async () => {
		const response = await POST(event());
		expect(response.status).toBe(200);
		expect(h.complete).toHaveBeenCalledWith({
			serverInstanceId: 'server-a',
			mediaItemId: 12,
			jobId: 33
		});
		expect(await response.json()).toEqual({ state: 'completed', eventId: 4 });
	});

	it('returns locale-neutral conflicts without leaking the job', async () => {
		h.complete.mockRejectedValue(new h.ApplyAndNextError('job_not_verified'));
		const response = await POST(event());
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({ error: { code: 'job_not_verified' } });

		h.complete.mockRejectedValue(new h.ApplyAndNextError('job_not_found'));
		const missing = await POST(event());
		expect(missing.status).toBe(404);
		expect(await missing.json()).toEqual({ error: { code: 'job_not_found' } });
	});

	it('rejects malformed identifiers before calling the service', async () => {
		const response = await POST(event('oops', { jobId: 'nope' }));
		expect(response.status).toBe(400);
		expect(h.complete).not.toHaveBeenCalled();
	});
});
