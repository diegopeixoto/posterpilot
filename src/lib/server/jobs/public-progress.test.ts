import { describe, expect, it } from 'vitest';
import {
	buildPublicJobProgress,
	type PublicJobRow,
	type PublicOutcomeRow
} from './public-progress';

function job(overrides: Partial<PublicJobRow> = {}): PublicJobRow {
	const at = new Date('2026-07-11T00:00:00.000Z');
	return {
		id: 9,
		serverInstanceId: 'server-a',
		librarySectionKey: 'movies',
		type: 'discover',
		status: 'partial_failed',
		phase: 'discovery',
		processed: 3,
		total: 3,
		currentItem: 'Example',
		attempt: 1,
		maxAttempts: 3,
		result: { summary: { succeeded: 2, failed: 1 } },
		errorCode: 'item_failures',
		error: 'Bearer top-secret',
		createdAt: at,
		startedAt: at,
		finishedAt: at,
		updatedAt: at,
		...overrides
	};
}

function outcome(overrides: Partial<PublicOutcomeRow>): PublicOutcomeRow {
	return {
		id: 1,
		jobId: 9,
		mediaItemId: 44,
		destination: 'server',
		kind: 'poster',
		season: null,
		episode: null,
		status: 'failed',
		retryable: true,
		result: null,
		errorCode: 'provider_timeout',
		error: 'https://user:pass@example.test/image?token=secret',
		...overrides
	};
}

describe('public job progress', () => {
	it('returns counts and sanitized failures without exposing persisted result objects', () => {
		const progress = buildPublicJobProgress(job(), [outcome({})]);
		expect(progress.resultSummary).toEqual({
			succeeded: 2,
			failed: 1,
			skipped: 0,
			interrupted: 0
		});
		expect(progress.retryableFailedCount).toBe(1);
		expect(progress.failures[0]).toMatchObject({
			outcomeId: 1,
			mediaItemId: 44,
			errorCode: 'provider_timeout',
			retryable: true
		});
		expect(progress.failures[0].errorMessage).not.toContain('pass');
		expect(progress.failures[0].errorMessage).not.toContain('secret');
		expect(progress.error?.message).toBe('Bearer [redacted]');
		expect(progress).not.toHaveProperty('result');
	});

	it('shows only the latest outcome for a durable unit', () => {
		const progress = buildPublicJobProgress(job({ result: null }), [
			outcome({ id: 1, result: { operationId: 'same' } }),
			outcome({ id: 2, result: { operationId: 'same' }, status: 'success', retryable: false }),
			outcome({ id: 3, mediaItemId: 55, retryable: false })
		]);
		expect(progress.failureCount).toBe(1);
		expect(progress.retryableFailedCount).toBe(0);
		expect(progress.failures.map((failure) => failure.outcomeId)).toEqual([3]);
		expect(progress.resultSummary).toEqual({
			succeeded: 1,
			failed: 1,
			skipped: 0,
			interrupted: 0
		});
	});
});
