import { describe, expect, it } from 'vitest';
import {
	canConfirmApplyAndNext,
	canRetryApplyNextCompletion,
	completesReviewRun,
	isFullySuccessfulApply,
	reviewAdvanceTarget,
	shouldAutoConfirmApply
} from './review-apply-next';

describe('Apply and next client decisions', () => {
	it('advances only after a non-empty terminal result with no failed, skipped, or interrupted work', () => {
		expect(
			isFullySuccessfulApply('completed', {
				succeeded: 2,
				failed: 0,
				skipped: 0,
				interrupted: 0
			})
		).toBe(true);
		for (const [status, summary] of [
			['partial_failed', { succeeded: 1, failed: 1, skipped: 0, interrupted: 0 }],
			['completed', { succeeded: 1, failed: 0, skipped: 1, interrupted: 0 }],
			['completed', { succeeded: 0, failed: 0, skipped: 0, interrupted: 0 }]
		] as const) {
			expect(isFullySuccessfulApply(status, summary)).toBe(false);
		}
	});

	it('does not confirm a preview that already discloses skipped or empty work', () => {
		const preview = {
			planId: 'plan-a',
			digest: 'digest-a',
			summary: { skipCount: 0, destinations: { server: 1, kometa: 0 } }
		};
		expect(canConfirmApplyAndNext(preview)).toBe(true);
		expect(
			canConfirmApplyAndNext({ ...preview, summary: { ...preview.summary, skipCount: 1 } })
		).toBe(false);
		expect(
			canConfirmApplyAndNext({
				...preview,
				summary: { skipCount: 0, destinations: { server: 0, kometa: 0 } }
			})
		).toBe(false);
	});

	it('offers completion retry only for a lost response or transient server state', () => {
		expect(canRetryApplyNextCompletion(null)).toBe(true);
		expect(canRetryApplyNextCompletion('internal_error')).toBe(true);
		expect(canRetryApplyNextCompletion('job_not_completed')).toBe(true);
		expect(canRetryApplyNextCompletion('selection_changed')).toBe(false);
		expect(canRetryApplyNextCompletion('job_not_verified')).toBe(false);
	});
});

describe('One-click apply decision', () => {
	const preview = (skipCount: number, server: number, kometa: number) => ({
		planId: 'plan-1',
		digest: 'digest-1',
		summary: { skipCount, destinations: { server, kometa } }
	});

	it('auto-confirms only a warning-free plan with at least one write', () => {
		expect(shouldAutoConfirmApply(preview(0, 1, 0))).toBe(true);
		expect(shouldAutoConfirmApply(preview(0, 0, 1))).toBe(true);
	});

	it('keeps the dialog when anything is skipped or nothing would be written', () => {
		expect(shouldAutoConfirmApply(preview(1, 1, 0))).toBe(false);
		expect(shouldAutoConfirmApply(preview(0, 0, 0))).toBe(false);
		expect(shouldAutoConfirmApply({ ...preview(0, 1, 0), digest: null })).toBe(false);
		expect(shouldAutoConfirmApply(null)).toBe(false);
	});
});

describe('reviewAdvanceTarget', () => {
	const next = { next: { href: '/item/2?returnTo=%2Freview' } };

	it('goes to the next item when the run has one', () => {
		expect(reviewAdvanceTarget(next, '/review')).toBe('/item/2?returnTo=%2Freview');
	});

	it('finishes to the list on the last item, which is what left it actionable', () => {
		// The regression in #100: no next item meant no completion at all, so the
		// artwork was applied but the review was never recorded and the library kept
		// reporting one outstanding title.
		expect(reviewAdvanceTarget({ next: null }, '/review?library=3')).toBe('/review?library=3');
	});

	it('returns null outside a review context, where nothing should be marked reviewed', () => {
		expect(reviewAdvanceTarget(null, '/library')).toBeNull();
	});
});

describe('completesReviewRun', () => {
	it('is true only on the last item of a run', () => {
		expect(completesReviewRun({ next: null })).toBe(true);
		expect(completesReviewRun({ next: { href: '/item/2' } })).toBe(false);
		expect(completesReviewRun(null)).toBe(false);
	});
});
