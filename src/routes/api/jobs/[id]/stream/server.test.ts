import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicJobProgress } from '$lib/job-progress';

const h = vi.hoisted(() => ({
	active: vi.fn(),
	getJob: vi.fn(),
	onProgress: vi.fn(),
	listener: null as (() => void) | null
}));

vi.mock('$lib/server/server-instances', () => ({ getActiveServerInstance: h.active }));
vi.mock('$lib/server/queries', () => ({ getJob: h.getJob }));
vi.mock('$lib/server/jobs/events', () => ({ onProgress: h.onProgress }));

import { GET } from './+server';

function snapshot(): PublicJobProgress {
	return {
		id: 7,
		jobId: 7,
		serverInstanceId: 'server-a',
		librarySectionKey: 'movies',
		type: 'discover',
		status: 'partial_failed',
		phase: 'discovery',
		processed: 2,
		total: 2,
		currentItem: 'Example',
		attempt: 1,
		maxAttempts: 3,
		resultSummary: { succeeded: 1, failed: 1, skipped: 0, interrupted: 0 },
		error: { code: 'item_failures', message: 'One or more scoped units failed' },
		failureCount: 1,
		retryableFailedCount: 1,
		failures: [
			{
				outcomeId: 44,
				mediaItemId: 12,
				destination: 'server',
				kind: 'poster',
				season: null,
				episode: null,
				retryable: true,
				errorCode: 'provider_timeout',
				errorMessage: 'timeout'
			}
		],
		hiddenFailureCount: 0,
		createdAt: '2026-07-11T00:00:00.000Z',
		startedAt: '2026-07-11T00:00:01.000Z',
		finishedAt: '2026-07-11T00:00:02.000Z',
		updatedAt: '2026-07-11T00:00:02.000Z'
	};
}

function event(id = '7') {
	return {
		params: { id },
		request: new Request(`http://localhost/api/jobs/${id}/stream`)
	} as Parameters<typeof GET>[0];
}

describe('GET /api/jobs/[id]/stream', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.listener = null;
		h.active.mockResolvedValue({ id: 'server-a' });
		h.getJob.mockResolvedValue(snapshot());
		h.onProgress.mockImplementation((_jobId: number, listener: () => void) => {
			h.listener = listener;
			return vi.fn();
		});
	});

	it('sends a durable terminal snapshot with reconnect and anti-buffering headers', async () => {
		const response = await GET(event());
		expect(response.headers.get('content-type')).toContain('text/event-stream');
		expect(response.headers.get('cache-control')).toBe('no-cache, no-transform');
		expect(response.headers.get('x-accel-buffering')).toBe('no');

		const body = await response.text();
		expect(body).toContain('retry: 2000');
		expect(body).toContain('id: 7-1783728002000');
		expect(body).toContain('"status":"partial_failed"');
		expect(body).toContain('"retryableFailedCount":1');
		expect(h.getJob).toHaveBeenCalledTimes(2);
		expect(h.getJob).toHaveBeenLastCalledWith(7, 'server-a');
	});

	it('re-reads durable state for live events so reconnects and worker events converge', async () => {
		const running = { ...snapshot(), status: 'running', finishedAt: null, error: null };
		const completed = {
			...snapshot(),
			status: 'completed',
			error: null,
			failureCount: 0,
			retryableFailedCount: 0,
			failures: []
		};
		h.getJob.mockReset();
		h.getJob
			.mockResolvedValueOnce(running)
			.mockResolvedValueOnce(running)
			.mockResolvedValue(completed);
		const response = await GET(event());
		const reader = response.body!.getReader();
		const decoder = new TextDecoder();
		let received = '';
		while (!received.includes('"status":"running"')) {
			const chunk = await reader.read();
			received += decoder.decode(chunk.value, { stream: !chunk.done });
		}

		expect(h.listener).toBeTypeOf('function');
		h.listener?.();
		while (!received.includes('"status":"completed"')) {
			const chunk = await reader.read();
			received += decoder.decode(chunk.value, { stream: !chunk.done });
		}

		expect(received).toContain('"status":"running"');
		expect(received).toContain('"status":"completed"');
		expect(h.getJob).toHaveBeenCalledTimes(3);
	});

	it('does not reveal a job outside the active server scope', async () => {
		h.getJob.mockResolvedValueOnce(null);
		await expect(GET(event())).rejects.toMatchObject({ status: 404 });
		expect(h.onProgress).not.toHaveBeenCalled();
	});
});
