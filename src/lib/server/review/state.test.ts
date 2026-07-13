import { describe, expect, it } from 'vitest';
import { deriveReviewState, type ReviewFacts } from './state';

const base: ReviewFacts = {
	ignored: false,
	partialFailure: false,
	externallyChanged: false,
	hasStagedSelection: false,
	resolved: true,
	reviewed: false,
	hasCandidates: false,
	discoveryStatus: 'not_started'
};

describe('deriveReviewState', () => {
	it('derives ordinary new, discovery, unresolved, staged, and completed work', () => {
		expect(deriveReviewState(base)).toBe('new');
		expect(deriveReviewState({ ...base, resolved: false })).toBe('unresolved');
		expect(deriveReviewState({ ...base, discoveryStatus: 'empty' })).toBe('no_candidates');
		expect(deriveReviewState({ ...base, hasCandidates: true })).toBe('suggestion_ready');
		expect(deriveReviewState({ ...base, hasStagedSelection: true })).toBe('staged');
		expect(deriveReviewState({ ...base, reviewed: true, hasCandidates: true })).toBe('completed');
	});

	it('gives explicit exceptions and ignore state precedence', () => {
		expect(
			deriveReviewState({
				...base,
				partialFailure: true,
				externallyChanged: true,
				hasStagedSelection: true
			})
		).toBe('partial_failure');
		expect(deriveReviewState({ ...base, externallyChanged: true, reviewed: true })).toBe(
			'externally_changed'
		);
		expect(deriveReviewState({ ...base, ignored: true, partialFailure: true })).toBe('ignored');
	});
});
