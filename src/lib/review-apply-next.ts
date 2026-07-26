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

/**
 * A plain single-item apply skips the confirmation dialog only when the
 * materialized plan is warning-free: a confirmable plan id/digest, nothing
 * skipped, and at least one destination write — the same predicate that gates
 * apply-and-next, under a purpose-named alias. Any skip keeps the dialog so the
 * user sees what would not happen before anything is written.
 */
export const shouldAutoConfirmApply = canConfirmApplyAndNext;
