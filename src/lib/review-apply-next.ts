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

/**
 * Where an apply started from the review flow should land once the review is
 * completed.
 *
 * The last item of a run has no next item, and that used to mean no completing
 * button was offered at all: applying it wrote the artwork but never recorded the
 * review, so the title stayed actionable and every library reported one
 * outstanding item forever (#100). Completion never needed a next item — only the
 * navigation did — so the last item finishes to the list it came from.
 *
 * Returns null outside a review context, where an apply is just an apply and
 * nothing should be marked reviewed.
 */
export function reviewAdvanceTarget(
	navigation: { next: { href: string } | null } | null,
	returnTo: string
): string | null {
	if (!navigation) return null;
	return navigation.next?.href ?? returnTo;
}

/** True when completing here ends the run rather than moving to another item. */
export function completesReviewRun(navigation: { next: { href: string } | null } | null): boolean {
	return navigation !== null && navigation.next === null;
}
