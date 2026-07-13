import { describe, expect, it } from 'vitest';
import { parseReviewFilter } from './review-filter';

describe('parseReviewFilter', () => {
	it('normalizes a complete valid server-side query', () => {
		const parsed = parseReviewFilter(
			new URLSearchParams({
				server: 'server-b',
				library: 'movies',
				state: 'unresolved',
				type: 'movie',
				availability: 'none',
				changedSince: '2026-07-01T00:00:00Z',
				job: '44',
				q: ' Matrix ',
				sort: 'updated',
				offset: '24'
			}),
			'server-a'
		);
		expect(parsed).toMatchObject({
			serverInstanceId: 'server-b',
			librarySectionKey: 'movies',
			state: 'unresolved',
			type: 'movie',
			availability: 'none',
			q: 'Matrix',
			jobId: 44,
			sort: 'updated',
			offset: 24
		});
		expect(parsed.changedSince?.toISOString()).toBe('2026-07-01T00:00:00.000Z');
	});

	it('falls back safely for unknown state, sort, dates, and offsets', () => {
		expect(
			parseReviewFilter(
				new URLSearchParams({
					state: 'secret',
					sort: 'random',
					changedSince: 'bad',
					offset: '-1',
					job: 'not-a-job'
				}),
				'server-a'
			)
		).toEqual({ serverInstanceId: 'server-a', attention: false, sort: 'priority', offset: 0 });
	});

	it('recognizes the actionable virtual view without inventing a persisted state', () => {
		expect(parseReviewFilter(new URLSearchParams({ attention: '1' }), 'server-a')).toMatchObject({
			serverInstanceId: 'server-a',
			attention: true,
			state: undefined
		});
	});
});
