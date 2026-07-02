import { describe, expect, it } from 'vitest';
import { parsePickFilter } from './fun-pick';

function params(entries: Record<string, string>): URLSearchParams {
	return new URLSearchParams(entries);
}

describe('parsePickFilter', () => {
	it('defaults to unrestricted when no params are present', () => {
		expect(parsePickFilter(params({}))).toEqual({
			type: undefined,
			genre: undefined,
			yearMin: undefined,
			yearMax: undefined,
			excludeWatched: false
		});
	});

	it('parses a fully-specified filter', () => {
		expect(
			parsePickFilter(
				params({
					type: 'show',
					genre: 'Drama',
					yearMin: '1990',
					yearMax: '1999',
					excludeWatched: '1'
				})
			)
		).toEqual({
			type: 'show',
			genre: 'Drama',
			yearMin: 1990,
			yearMax: 1999,
			excludeWatched: true
		});
	});

	it('ignores unknown media types', () => {
		expect(parsePickFilter(params({ type: 'music' })).type).toBeUndefined();
	});

	it('drops malformed or non-positive years', () => {
		expect(parsePickFilter(params({ yearMin: 'abc' })).yearMin).toBeUndefined();
		expect(parsePickFilter(params({ yearMax: '-5' })).yearMax).toBeUndefined();
		expect(parsePickFilter(params({ yearMin: '0' })).yearMin).toBeUndefined();
	});

	it('treats an empty genre as unset', () => {
		expect(parsePickFilter(params({ genre: '' })).genre).toBeUndefined();
	});

	it('only honors excludeWatched=1', () => {
		expect(parsePickFilter(params({ excludeWatched: 'true' })).excludeWatched).toBe(false);
		expect(parsePickFilter(params({ excludeWatched: '1' })).excludeWatched).toBe(true);
	});
});
