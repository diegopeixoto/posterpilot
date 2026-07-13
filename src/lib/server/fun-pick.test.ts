import { describe, expect, it } from 'vitest';
import {
	FUN_MAX_RECENT_EXCLUSIONS,
	funResultId,
	parseFunSharedItemIds,
	parsePickFilter,
	rankFunItems,
	validatePickFilter
} from './fun-pick';

function params(entries: Record<string, string> = {}): URLSearchParams {
	return new URLSearchParams(entries);
}

describe('validatePickFilter', () => {
	it('defaults to an unrestricted single standard choice', () => {
		expect(parsePickFilter(params())).toEqual({
			serverInstanceId: undefined,
			librarySectionKey: undefined,
			type: undefined,
			genre: undefined,
			yearMin: undefined,
			yearMax: undefined,
			runtimeMin: undefined,
			runtimeMax: undefined,
			ratingMin: undefined,
			addedWithinDays: undefined,
			excludeWatched: false,
			preset: undefined,
			count: 1,
			seed: undefined,
			excludeItemIds: [],
			mode: 'standard'
		});
	});

	it('parses the complete reusable filter surface', () => {
		const parsed = validatePickFilter(
			params({
				server: 'srv-a',
				library: 'movies',
				type: 'movie',
				genre: 'Drama',
				yearMin: '1990',
				yearMax: '1999',
				runtimeMin: '80',
				runtimeMax: '140',
				ratingMin: '7.5',
				addedWithinDays: '365',
				excludeWatched: '1',
				count: '3',
				seed: 'shareable-seed',
				exclude: '7,9,7',
				mode: 'blind'
			}),
			{ currentYear: 2026 }
		);

		expect(parsed.errors).toEqual({});
		expect(parsed.filter).toMatchObject({
			serverInstanceId: 'srv-a',
			librarySectionKey: 'movies',
			type: 'movie',
			genre: 'Drama',
			yearMin: 1990,
			yearMax: 1999,
			runtimeMin: 80,
			runtimeMax: 140,
			ratingMin: 7.5,
			addedWithinDays: 365,
			excludeWatched: true,
			count: 3,
			seed: 'shareable-seed',
			excludeItemIds: [7, 9],
			mode: 'blind'
		});
	});

	it('applies presets while allowing explicit fields to override them', () => {
		const filter = parsePickFilter(
			params({ preset: 'quick-watch', type: 'show', runtimeMax: '75' })
		);
		expect(filter).toMatchObject({ preset: 'quick-watch', type: 'show', runtimeMax: 75 });
	});

	it('reports field-level validation errors for malformed or reversed ranges', () => {
		const { filter, errors } = validatePickFilter(
			params({
				type: 'music',
				yearMin: '2035',
				yearMax: '1990',
				runtimeMin: '200',
				runtimeMax: '90',
				ratingMin: '11',
				count: '8',
				seed: 'spaces are invalid',
				mode: 'roulette'
			}),
			{ currentYear: 2026 }
		);

		expect(errors).toMatchObject({
			type: 'invalid',
			yearMin: 'out_of_range',
			runtimeMin: 'min_greater_than_max',
			ratingMin: 'out_of_range',
			count: 'out_of_range',
			seed: 'invalid',
			mode: 'invalid'
		});
		expect(filter.count).toBe(1);
		expect(filter.mode).toBe('standard');
	});

	it('bounds and deduplicates recent exclusions', () => {
		const ids = Array.from({ length: FUN_MAX_RECENT_EXCLUSIONS + 5 }, (_, i) => i + 1);
		const { filter, errors } = validatePickFilter(params({ exclude: `${ids.join(',')},bad,-1` }));
		expect(filter.excludeItemIds).toHaveLength(FUN_MAX_RECENT_EXCLUSIONS);
		// Values after the cap are deliberately ignored; bounded history cannot grow forever.
		expect(errors.exclude).toBeUndefined();
	});
});

describe('seeded FUN results', () => {
	it('accepts only one to three distinct positive shared result ids', () => {
		expect(parseFunSharedItemIds('9,4,7')).toEqual([9, 4, 7]);
		expect(parseFunSharedItemIds('9,9')).toEqual([]);
		expect(parseFunSharedItemIds('9,bad')).toEqual([]);
		expect(parseFunSharedItemIds('1,2,3,4')).toEqual([]);
	});

	it('ranks the same ids identically for the same seed regardless of input order', () => {
		const first = rankFunItems([{ id: 3 }, { id: 1 }, { id: 2 }], 'night');
		const second = rankFunItems([{ id: 2 }, { id: 3 }, { id: 1 }], 'night');
		expect(first.map((item) => item.id)).toEqual(second.map((item) => item.id));
	});

	it('creates a stable result id from the seed and selected ids', () => {
		expect(funResultId('night', [4, 7, 9])).toBe(funResultId('night', [4, 7, 9]));
		expect(funResultId('night', [4, 7, 9])).not.toBe(funResultId('night-2', [4, 7, 9]));
	});
});
