import { describe, expect, it } from 'vitest';
import { parseLibraryFilter, parseOffset } from './library-filter';

describe('parseLibraryFilter', () => {
	it('parses the complete supported filter surface', () => {
		const params = new URLSearchParams({
			type: 'movie',
			ignored: 'active',
			missing: '1',
			covers: '1',
			mediux: '1',
			unchanged: '1',
			minRating: '7.5',
			genre: 'Drama',
			sort: 'rating',
			dir: 'desc',
			q: 'Arrival'
		});

		expect(parseLibraryFilter(params)).toEqual({
			type: 'movie',
			ignored: 'active',
			missingPoster: true,
			hasCandidates: true,
			hasMediux: true,
			unchanged: true,
			minRating: 7.5,
			genre: 'Drama',
			sort: 'rating',
			dir: 'desc',
			q: 'Arrival'
		});
	});

	it('accepts ignored-only view and rejects unknown ignored values', () => {
		expect(parseLibraryFilter(new URLSearchParams({ ignored: 'ignored' })).ignored).toBe('ignored');
		expect(parseLibraryFilter(new URLSearchParams({ ignored: 'all' })).ignored).toBeUndefined();
		expect(parseLibraryFilter(new URLSearchParams({ ignored: 'yes' })).ignored).toBeUndefined();
	});

	it('drops invalid enumerations and unsafe numeric filters', () => {
		const parsed = parseLibraryFilter(
			new URLSearchParams({ type: 'episode', sort: 'popular', dir: 'sideways', minRating: 'NaN' })
		);

		expect(parsed.type).toBeUndefined();
		expect(parsed.sort).toBeUndefined();
		expect(parsed.dir).toBeUndefined();
		expect(parsed.minRating).toBeUndefined();
	});
});

describe('parseOffset', () => {
	it('accepts positive integer offsets', () => {
		expect(parseOffset('60')).toBe(60);
	});

	it('normalizes missing, negative, fractional, and invalid offsets to zero', () => {
		expect(parseOffset(null)).toBe(0);
		expect(parseOffset('-1')).toBe(0);
		expect(parseOffset('1.5')).toBe(0);
		expect(parseOffset('nope')).toBe(0);
	});
});
