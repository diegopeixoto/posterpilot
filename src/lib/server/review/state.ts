export const REVIEW_STATES = [
	'new',
	'unresolved',
	'no_candidates',
	'suggestion_ready',
	'staged',
	'partial_failure',
	'externally_changed',
	'ignored',
	'completed'
] as const;

export type ReviewState = (typeof REVIEW_STATES)[number];

export interface ReviewFacts {
	ignored: boolean;
	partialFailure: boolean;
	externallyChanged: boolean;
	hasStagedSelection: boolean;
	resolved: boolean;
	reviewed: boolean;
	hasCandidates: boolean;
	discoveryStatus: string;
}

/** One deterministic actionable state, ordered from exceptions to ordinary work. */
export function deriveReviewState(facts: ReviewFacts): ReviewState {
	if (facts.ignored) return 'ignored';
	if (facts.partialFailure) return 'partial_failure';
	if (facts.externallyChanged) return 'externally_changed';
	if (facts.hasStagedSelection) return 'staged';
	if (!facts.resolved) return 'unresolved';
	if (facts.reviewed) return 'completed';
	if (facts.hasCandidates) return 'suggestion_ready';
	if (facts.discoveryStatus === 'empty' || facts.discoveryStatus === 'succeeded') {
		return 'no_candidates';
	}
	return 'new';
}
