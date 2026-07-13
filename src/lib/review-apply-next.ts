import type { PublicJobResultSummary } from '$lib/job-progress';

export function isFullySuccessfulApply(status: string, summary: PublicJobResultSummary): boolean {
	return (
		status === 'completed' &&
		summary.succeeded > 0 &&
		summary.failed === 0 &&
		summary.skipped === 0 &&
		summary.interrupted === 0
	);
}

export function canConfirmApplyAndNext(
	preview: {
		planId: string | null;
		digest: string | null;
		summary: { skipCount: number; destinations: { server: number; kometa: number } };
	} | null
): boolean {
	if (!preview?.planId || !preview.digest || preview.summary.skipCount > 0) return false;
	return preview.summary.destinations.server + preview.summary.destinations.kometa > 0;
}

export function canRetryApplyNextCompletion(code: string | null): boolean {
	return code === null || code === 'internal_error' || code === 'job_not_completed';
}
