import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
	class LibrarySelectionError extends Error {
		constructor(
			public readonly code: 'invalid_request' | 'no_active_server' | 'result_set_changed'
		) {
			super(code);
		}
	}

	return {
		enqueue: vi.fn(),
		materializeSelection: vi.fn(),
		getActiveServer: vi.fn(),
		LibrarySelectionError
	};
});

vi.mock('$lib/server/jobs/runner', () => ({ enqueueJob: h.enqueue }));
vi.mock('$lib/server/library-selection', () => ({
	LibrarySelectionError: h.LibrarySelectionError,
	materializeLibrarySelection: h.materializeSelection
}));
vi.mock('$lib/server/server-instances', () => ({
	getActiveServerInstance: h.getActiveServer
}));

import { POST } from './+server';

function request(body: unknown) {
	return {
		request: new Request('http://localhost/api/discover', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	} as Parameters<typeof POST>[0];
}

describe('POST /api/discover', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.enqueue.mockResolvedValue(42);
		h.materializeSelection.mockResolvedValue({
			serverInstanceId: 'server-a',
			itemIds: [7, 8],
			count: 2,
			fingerprint: 'selection-v1'
		});
		h.getActiveServer.mockResolvedValue({ id: 'server-a' });
	});

	it('rematerializes the frozen all-matching scope before enqueueing', async () => {
		const response = await POST(
			request({
				selectionScope: { query: '?genre=Drama', fingerprint: 'selection-v1' },
				forceRefresh: true
			})
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ jobId: 42 });
		expect(h.materializeSelection).toHaveBeenCalledWith('?genre=Drama', 'selection-v1');
		expect(h.enqueue).toHaveBeenCalledWith({
			kind: 'discover',
			serverInstanceId: 'server-a',
			itemIds: [7, 8],
			forceRefresh: true
		});
	});

	it('does not enqueue when the matching result set changed', async () => {
		h.materializeSelection.mockRejectedValue(new h.LibrarySelectionError('result_set_changed'));

		const response = await POST(
			request({ selectionScope: { query: '?type=movie', fingerprint: 'old' } })
		);

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({ error: { code: 'result_set_changed' } });
		expect(h.enqueue).not.toHaveBeenCalled();
	});

	it('rejects a selection snapshot materialized for a different active server', async () => {
		h.materializeSelection.mockResolvedValue({
			serverInstanceId: 'server-b',
			itemIds: [7],
			count: 1,
			fingerprint: 'selection-v1'
		});
		const response = await POST(
			request({ selectionScope: { query: '?type=movie', fingerprint: 'selection-v1' } })
		);
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({ error: { code: 'result_set_changed' } });
		expect(h.enqueue).not.toHaveBeenCalled();
	});

	it('rejects discovery when there is no active named instance', async () => {
		h.getActiveServer.mockResolvedValue(null);
		const response = await POST(request({}));
		expect(response.status).toBe(409);
		expect(h.enqueue).not.toHaveBeenCalled();
	});

	it('scopes a no-body discover-all request to the active server', async () => {
		const response = await POST(request({}));

		expect(response.status).toBe(200);
		expect(h.enqueue).toHaveBeenCalledWith({
			kind: 'discover',
			serverInstanceId: 'server-a',
			itemIds: undefined,
			forceRefresh: undefined
		});
	});

	it('returns a structured conflict instead of starting overlapping work', async () => {
		h.enqueue.mockRejectedValue({
			code: 'job_conflict',
			conflictingJobId: 9,
			conflictingJobType: 'sync'
		});
		const response = await POST(request({ itemIds: [7] }));
		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({
			error: { code: 'job_conflict', conflictingJobId: 9 }
		});
	});
});
