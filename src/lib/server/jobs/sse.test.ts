import { describe, expect, it } from 'vitest';
import type { PublicJobProgress } from '$lib/job-progress';
import { JOB_SSE_RETRY_MS, jobSseKeepalive, jobSseRetryDirective, jobSseSnapshot } from './sse';

function progress(): PublicJobProgress {
	return {
		id: 12,
		jobId: 12,
		serverInstanceId: 'server-a',
		librarySectionKey: 'movies',
		type: 'sync',
		status: 'running',
		phase: 'resolution',
		processed: 2,
		total: 4,
		currentItem: 'Line one\nLine two',
		attempt: 1,
		maxAttempts: 3,
		resultSummary: { succeeded: 2, failed: 0, skipped: 0, interrupted: 0 },
		error: null,
		failureCount: 0,
		retryableFailedCount: 0,
		failures: [],
		hiddenFailureCount: 0,
		createdAt: '2026-07-11T00:00:00.000Z',
		startedAt: '2026-07-11T00:00:01.000Z',
		finishedAt: null,
		updatedAt: '2026-07-11T00:00:02.000Z'
	};
}

describe('job SSE framing', () => {
	it('provides browser reconnect timing and harmless heartbeat comments', () => {
		expect(jobSseRetryDirective()).toBe(`retry: ${JOB_SSE_RETRY_MS}\n\n`);
		expect(jobSseKeepalive(1234)).toBe(': keepalive 1234\n\n');
	});

	it('encodes each durable snapshot as one resumable SSE event', () => {
		const encoded = jobSseSnapshot(progress());
		expect(encoded).toContain('id: 12-1783728002000\n');
		expect(encoded).toContain('"status":"running"');
		expect(encoded).toContain('Line one\\nLine two');
		expect(encoded.split('\ndata: ')).toHaveLength(2);
	});
});
