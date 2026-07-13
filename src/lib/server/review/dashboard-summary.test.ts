import { describe, expect, it } from 'vitest';
import { buildReviewDashboardSummary, emptyReviewStateCounts } from './dashboard-summary';

describe('review dashboard summary', () => {
	it('keeps exact state counts and ranks actionable libraries by exceptions', () => {
		const summary = buildReviewDashboardSummary(
			[
				{ state: 'new', count: 7 },
				{ state: 'partial_failure', count: 2 },
				{ state: 'completed', count: 10 }
			],
			[
				{ sectionKey: 'movies', state: 'new', count: 7 },
				{ sectionKey: 'shows', state: 'partial_failure', count: 2 },
				{ sectionKey: 'shows', state: 'completed', count: 10 }
			],
			3
		);
		expect(summary.counts).toMatchObject({ new: 7, partial_failure: 2, completed: 10 });
		expect(summary.libraries).toEqual([
			{ sectionKey: 'shows', actionable: 2, exceptions: 2 },
			{ sectionKey: 'movies', actionable: 7, exceptions: 0 }
		]);
		expect(summary.failedJobs).toBe(3);
	});

	it('provides every state at zero for an empty server', () => {
		expect(Object.values(emptyReviewStateCounts())).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
	});
});
