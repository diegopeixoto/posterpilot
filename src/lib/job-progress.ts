const TERMINAL_JOB_STATUSES = [
	'completed',
	'partial_failed',
	'failed',
	'cancelled',
	'interrupted'
] as const;

export type TerminalJobStatus = (typeof TERMINAL_JOB_STATUSES)[number];

export interface PublicJobResultSummary {
	succeeded: number;
	failed: number;
	skipped: number;
	interrupted: number;
}

export interface PublicJobFailure {
	outcomeId: number;
	mediaItemId: number | null;
	destination: string | null;
	kind: string | null;
	season: number | null;
	episode: number | null;
	retryable: boolean;
	errorCode: string;
	errorMessage: string | null;
}

/**
 * Credentials-safe job shape shared by dashboard loads and the live SSE stream.
 * Immutable worker payloads and raw result objects are intentionally absent.
 */
export interface PublicJobProgress {
	id: number;
	jobId: number;
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
	resultSummary: PublicJobResultSummary;
	error: { code: string; message: string | null } | null;
	failureCount: number;
	retryableFailedCount: number;
	failures: PublicJobFailure[];
	hiddenFailureCount: number;
	createdAt: Date | string;
	startedAt: Date | string | null;
	finishedAt: Date | string | null;
	updatedAt: Date | string;
}

export function isTerminalJobStatus(status: string): status is TerminalJobStatus {
	return (TERMINAL_JOB_STATUSES as readonly string[]).includes(status);
}
