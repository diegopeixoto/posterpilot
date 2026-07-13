export const REVIEW_STATE_VALUES = [
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

export type ReviewStateValue = (typeof REVIEW_STATE_VALUES)[number];
export type ReviewAvailabilityValue = 'candidates' | 'mediux' | 'none';
export type ReviewSortValue = 'priority' | 'updated' | 'title' | 'year';

export interface ParsedReviewFilter {
	serverInstanceId: string;
	librarySectionKey?: string;
	state?: ReviewStateValue;
	attention: boolean;
	type?: 'movie' | 'show';
	availability?: ReviewAvailabilityValue;
	changedSince?: Date;
	jobId?: number;
	q?: string;
	sort: ReviewSortValue;
	offset: number;
}

export function parseReviewFilter(
	params: URLSearchParams,
	fallbackServerInstanceId: string
): ParsedReviewFilter {
	const rawState = params.get('state');
	const rawType = params.get('type');
	const rawAvailability = params.get('availability');
	const rawSort = params.get('sort');
	const rawChanged = params.get('changedSince');
	const changed = rawChanged ? new Date(rawChanged) : null;
	const offset = Number(params.get('offset'));
	const jobId = Number(params.get('job'));
	const q = params.get('q')?.normalize('NFKC').trim().slice(0, 200) || undefined;
	return {
		serverInstanceId: params.get('server')?.trim() || fallbackServerInstanceId,
		librarySectionKey: params.get('library')?.trim() || undefined,
		state: REVIEW_STATE_VALUES.includes(rawState as ReviewStateValue)
			? (rawState as ReviewStateValue)
			: undefined,
		attention: params.get('attention') === '1',
		type: rawType === 'movie' || rawType === 'show' ? rawType : undefined,
		availability:
			rawAvailability === 'candidates' || rawAvailability === 'mediux' || rawAvailability === 'none'
				? rawAvailability
				: undefined,
		changedSince: changed && !Number.isNaN(changed.getTime()) ? changed : undefined,
		jobId: Number.isSafeInteger(jobId) && jobId > 0 ? jobId : undefined,
		q,
		sort: rawSort === 'updated' || rawSort === 'title' || rawSort === 'year' ? rawSort : 'priority',
		offset: Number.isInteger(offset) && offset > 0 ? offset : 0
	};
}
