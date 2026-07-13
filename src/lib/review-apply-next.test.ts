import { describe, expect, it } from 'vitest';
import {
	canConfirmApplyAndNext,
	canRetryApplyNextCompletion,
	isFullySuccessfulApply
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
