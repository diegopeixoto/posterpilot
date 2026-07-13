import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
	class JobConflictError extends Error {
		readonly code = 'job_conflict';
		constructor(
			readonly conflictingJobId: number,
			readonly conflictingJobType: string
		) {
			super('conflict');
		}
	}
	class JobRetryError extends Error {
		constructor(readonly code: string) {
			super(code);
		}
	}
	return {
		retry: vi.fn(),
		active: vi.fn(),
		JobConflictError,
		JobRetryError
	};
});

vi.mock('$lib/server/jobs/runner', () => ({ JobConflictError: h.JobConflictError }));
vi.mock('$lib/server/jobs/retry', () => ({
	JobRetryError: h.JobRetryError,
	retryFailedJob: h.retry
}));
vi.mock('$lib/server/server-instances', () => ({ getActiveServerInstance: h.active }));

import { POST } from './+server';

function event(id: string, body: unknown = {}) {
	return {
		params: { id },
		request: new Request(`http://localhost/api/jobs/${id}/retry`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	} as Parameters<typeof POST>[0];
}

describe('POST /api/jobs/[id]/retry', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.active.mockResolvedValue({ id: 'server-a' });
		h.retry.mockResolvedValue({
			jobIds: [91],
			reused: false,
			outcomeIds: [7, 9]
		});
	});

	it('enqueues exactly the selected failed subset in the active scope', async () => {
		const response = await POST(event('12', { outcomeIds: [9, 7] }));
		expect(response.status).toBe(200);
		expect(h.retry).toHaveBeenCalledWith({
			parentJobId: 12,
			serverInstanceId: 'server-a',
			outcomeIds: [9, 7]
		});
		expect(await response.json()).toEqual({
			jobId: 91,
			jobIds: [91],
			reused: false,
			outcomeIds: [7, 9]
		});
	});

	it('does not reveal a job outside the active server scope', async () => {
		h.retry.mockRejectedValue(new h.JobRetryError('job_not_found'));
		const response = await POST(event('12'));
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: { code: 'job_not_found' } });
	});

	it('returns the active conflicting job safely', async () => {
		h.retry.mockRejectedValue(new h.JobConflictError(33, 'full_rescan'));
		const response = await POST(event('12'));
		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({
			error: { code: 'job_conflict', conflictingJobId: 33 }
		});
	});
});
