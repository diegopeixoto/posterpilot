import { REVIEW_STATES, type ReviewState } from './state';

export interface ReviewCountRow {
	state: ReviewState;
	count: number;
}

export interface ReviewLibraryCountRow extends ReviewCountRow {
	sectionKey: string;
}

export function emptyReviewStateCounts(): Record<ReviewState, number> {
	return Object.fromEntries(REVIEW_STATES.map((state) => [state, 0])) as Record<
		ReviewState,
		number
	>;
}

export function buildReviewDashboardSummary(
	stateRows: ReviewCountRow[],
	libraryRows: ReviewLibraryCountRow[],
	failedJobs: number
) {
	const counts = emptyReviewStateCounts();
	for (const row of stateRows) {
		if (REVIEW_STATES.includes(row.state)) counts[row.state] += Number(row.count) || 0;
	}
	const byLibrary = new Map<string, { actionable: number; exceptions: number }>();
	for (const row of libraryRows) {
		if (row.state === 'completed' || row.state === 'ignored') continue;
		const current = byLibrary.get(row.sectionKey) ?? { actionable: 0, exceptions: 0 };
		current.actionable += Number(row.count) || 0;
		if (row.state === 'partial_failure' || row.state === 'externally_changed') {
			current.exceptions += Number(row.count) || 0;
		}
		byLibrary.set(row.sectionKey, current);
	}
	return {
		counts,
		failedJobs: Math.max(0, Number(failedJobs) || 0),
		libraries: [...byLibrary.entries()]
			.map(([sectionKey, values]) => ({ sectionKey, ...values }))
			.sort(
				(a, b) =>
					b.exceptions - a.exceptions ||
					b.actionable - a.actionable ||
					a.sectionKey.localeCompare(b.sectionKey)
			)
	};
}
