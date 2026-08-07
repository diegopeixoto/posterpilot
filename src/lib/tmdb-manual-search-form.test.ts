import { describe, expect, it } from 'vitest';
import {
	ManualTmdbSearchValidationError,
	prepareManualTmdbSearchParams,
	readManualTmdbSearchYear
} from './tmdb-manual-search-form';

describe('manual TMDB search form', () => {
	it('keeps the optional year consistently numeric or empty', () => {
		expect(readManualTmdbSearchYear('', Number.NaN)).toBeNull();
		expect(readManualTmdbSearchYear('2024', 2024)).toBe(2024);
	});

	it('uses the currently edited title, year, and media type', () => {
		const params = prepareManualTmdbSearchParams({
			query: '  Changed   title  ',
			year: 2024,
			mediaType: 'tv'
		});

		expect(Object.fromEntries(params)).toEqual({ q: 'Changed title', type: 'tv', year: '2024' });
	});

	it('supports restoring and clearing the year across repeated preparations', () => {
		const edited = prepareManualTmdbSearchParams({
			query: 'Example',
			year: 2025,
			mediaType: 'movie'
		});
		const restored = prepareManualTmdbSearchParams({
			query: 'Example',
			year: 1999,
			mediaType: 'movie'
		});
		const cleared = prepareManualTmdbSearchParams({
			query: 'Example',
			year: null,
			mediaType: 'movie'
		});

		expect(edited.get('year')).toBe('2025');
		expect(restored.get('year')).toBe('1999');
		expect(cleared.has('year')).toBe(false);
		expect(
			prepareManualTmdbSearchParams({ query: 'Example', year: null, mediaType: 'movie' }).toString()
		).toBe(cleared.toString());
	});

	it.each([1799, 2024.5, 10_000, Number.NaN])('rejects invalid year %s', (year) => {
		expect(() =>
			prepareManualTmdbSearchParams({ query: 'Example', year, mediaType: 'movie' })
		).toThrow(ManualTmdbSearchValidationError);
	});

	it('rejects an empty title without making a request possible', () => {
		expect(() =>
			prepareManualTmdbSearchParams({ query: '   ', year: null, mediaType: 'both' })
		).toThrow(ManualTmdbSearchValidationError);
	});
});
