import type {
	PublicJobFailure,
	PublicJobProgress,
	PublicJobResultSummary
} from '$lib/job-progress';
import { sanitizeJobErrorText } from './policy';

const MAX_FAILURE_DETAILS = 25;

export interface PublicJobRow {
	id: number;
	serverInstanceId: string | null;
	librarySectionKey: string | null;
	type: string;
	status: string;
	phase: string | null;
	processed: number;
	total: number;
	currentItem: string | null;
	attempt: number;
	maxAttempts: number;
	result: Record<string, unknown> | null;
	errorCode: string | null;
	error: string | null;
	createdAt: Date;
	startedAt: Date | null;
	finishedAt: Date | null;
	updatedAt: Date;
}

export interface PublicOutcomeRow {
	id: number;
	jobId: number;
	mediaItemId: number | null;
	destination: string | null;
	kind: string | null;
	season: number | null;
	episode: number | null;
	status: 'success' | 'failed' | 'skipped' | 'interrupted';
	retryable: boolean;
	result: Record<string, unknown> | null;
	errorCode: string | null;
	error: string | null;
}

function count(value: unknown): number {
	const parsed = typeof value === 'number' ? value : Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function errorCode(value: unknown): string {
	return (
		sanitizeJobErrorText(value ?? 'job_failed')
			.toLowerCase()
			.replace(/[^a-z0-9_.-]/g, '_')
			.slice(0, 80) || 'job_failed'
	);
}

function outcomeUnitKey(outcome: PublicOutcomeRow): string {
	const operationId = outcome.result?.operationId;
	if (typeof operationId === 'string' && operationId) return `operation:${operationId}`;
	return [
		'item',
		outcome.mediaItemId ?? 'none',
		outcome.destination ?? 'none',
		outcome.kind ?? 'none',
		outcome.season ?? 'root',
		outcome.episode ?? 'root'
	].join(':');
}

/** A later success for the same durable unit removes an earlier failure from the public view. */
function latestOutcomes(outcomes: PublicOutcomeRow[]): PublicOutcomeRow[] {
	const latest = new Map<string, PublicOutcomeRow>();
	for (const outcome of [...outcomes].sort((a, b) => a.id - b.id)) {
		latest.set(outcomeUnitKey(outcome), outcome);
	}
	return [...latest.values()].sort((a, b) => a.id - b.id);
}

function resultSummary(row: PublicJobRow, outcomes: PublicOutcomeRow[]): PublicJobResultSummary {
	const stored =
		row.result?.summary && typeof row.result.summary === 'object'
			? (row.result.summary as Record<string, unknown>)
			: null;
	if (stored) {
		return {
			succeeded: count(stored.succeeded),
			failed: count(stored.failed),
			skipped: count(stored.skipped),
			interrupted: count(stored.interrupted)
		};
	}
	return outcomes.reduce<PublicJobResultSummary>(
		(summary, outcome) => {
			if (outcome.status === 'success') summary.succeeded++;
			else if (outcome.status === 'failed') summary.failed++;
			else if (outcome.status === 'skipped') summary.skipped++;
			else summary.interrupted++;
			return summary;
		},
		{ succeeded: 0, failed: 0, skipped: 0, interrupted: 0 }
	);
}

function publicFailure(outcome: PublicOutcomeRow): PublicJobFailure {
	return {
		outcomeId: outcome.id,
		mediaItemId: outcome.mediaItemId,
		destination: outcome.destination,
		kind: outcome.kind,
		season: outcome.season,
		episode: outcome.episode,
		retryable: outcome.retryable,
		errorCode: errorCode(outcome.errorCode),
		errorMessage: outcome.error ? sanitizeJobErrorText(outcome.error) : null
	};
}

/**
 * Convert persisted job state into the only job representation allowed in UI/SSE.
 * The immutable payload, provider URLs, full result, and outcome result are never returned.
 */
export function buildPublicJobProgress(
	row: PublicJobRow,
	allOutcomes: PublicOutcomeRow[] = []
): PublicJobProgress {
	const outcomes = latestOutcomes(allOutcomes.filter((outcome) => outcome.jobId === row.id));
	const failed = outcomes.filter((outcome) => outcome.status === 'failed');
	const failures = failed.slice(0, MAX_FAILURE_DETAILS).map(publicFailure);
	const safeErrorCode = row.errorCode ? errorCode(row.errorCode) : null;
	return {
		id: row.id,
		jobId: row.id,
		serverInstanceId: row.serverInstanceId,
		librarySectionKey: row.librarySectionKey,
		type: row.type,
		status: row.status,
		phase: row.phase,
		processed: count(row.processed),
		total: count(row.total),
		currentItem: row.currentItem ? sanitizeJobErrorText(row.currentItem).slice(0, 250) : null,
		attempt: count(row.attempt),
		maxAttempts: count(row.maxAttempts),
		resultSummary: resultSummary(row, outcomes),
		error:
			safeErrorCode || row.error
				? {
						code: safeErrorCode ?? 'job_failed',
						message: row.error ? sanitizeJobErrorText(row.error) : null
					}
				: null,
		failureCount: failed.length,
		retryableFailedCount: failed.filter((outcome) => outcome.retryable).length,
		failures,
		hiddenFailureCount: Math.max(0, failed.length - failures.length),
		createdAt: row.createdAt,
		startedAt: row.startedAt,
		finishedAt: row.finishedAt,
		updatedAt: row.updatedAt
	};
}
