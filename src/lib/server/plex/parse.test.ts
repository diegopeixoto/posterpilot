import { describe, expect, it } from 'vitest';
import { buildPosterUrl, parseGuids, parseUpdatedAt, type PlexRawGuid } from './parse';

describe('parseGuids', () => {
	it('extracts tmdb, imdb, and tvdb ids', () => {
		const guids: PlexRawGuid[] = [
			{ id: 'tmdb://603' },
			{ id: 'imdb://tt0133093' },
			{ id: 'tvdb://12345' }
		];
		expect(parseGuids(guids)).toEqual({
			tmdb: '603',
			imdb: 'tt0133093',
			tvdb: '12345'
		});
	});

	it('returns an empty object when no known guids are present', () => {
		const guids: PlexRawGuid[] = [{ id: 'plex://movie/abc' }, { id: 'local://42' }];
		expect(parseGuids(guids)).toEqual({});
	});

	it('returns an empty object for an empty array', () => {
		expect(parseGuids([])).toEqual({});
	});

	it('returns an empty object for null or undefined input', () => {
		expect(parseGuids(null)).toEqual({});
		expect(parseGuids(undefined)).toEqual({});
	});

	it('ignores unknown sources while keeping known ones', () => {
		const guids: PlexRawGuid[] = [
			{ id: 'plex://movie/5d77' },
			{ id: 'tmdb://550' },
			{ id: 'anidb://999' }
		];
		expect(parseGuids(guids)).toEqual({ tmdb: '550' });
	});

	it('keeps the first value seen for a duplicated source', () => {
		const guids: PlexRawGuid[] = [{ id: 'tmdb://111' }, { id: 'tmdb://222' }];
		expect(parseGuids(guids)).toEqual({ tmdb: '111' });
	});

	it('skips malformed entries (no separator, empty value, non-string id)', () => {
		const guids = [
			{ id: 'tmdbnoseparator' },
			{ id: 'imdb://' },
			{ id: 42 as unknown as string },
			{ id: 'tvdb://777' }
		] as PlexRawGuid[];
		expect(parseGuids(guids)).toEqual({ tvdb: '777' });
	});
});

describe('parseUpdatedAt', () => {
	it('converts epoch seconds to a Date', () => {
		expect(parseUpdatedAt(1700000000)).toEqual(new Date(1700000000 * 1000));
	});

	it('returns null when the value is absent', () => {
		expect(parseUpdatedAt(undefined)).toBeNull();
		expect(parseUpdatedAt(null)).toBeNull();
	});

	it('returns null for zero or negative values', () => {
		expect(parseUpdatedAt(0)).toBeNull();
		expect(parseUpdatedAt(-5)).toBeNull();
	});
});

describe('buildPosterUrl', () => {
	it('builds an absolute, token-bearing URL from a relative thumb', () => {
		expect(
			buildPosterUrl('http://plex.local:32400', '/library/metadata/42/thumb/168', 'abc123')
		).toBe('http://plex.local:32400/library/metadata/42/thumb/168?X-Plex-Token=abc123');
	});

	it('strips a trailing slash from the base url', () => {
		expect(buildPosterUrl('http://plex.local:32400/', '/thumb/9', 'tok')).toBe(
			'http://plex.local:32400/thumb/9?X-Plex-Token=tok'
		);
	});

	it('prefixes a leading slash when the thumb path lacks one', () => {
		expect(buildPosterUrl('http://plex.local:32400', 'thumb/9', 'tok')).toBe(
			'http://plex.local:32400/thumb/9?X-Plex-Token=tok'
		);
	});

	it('uses & when the thumb path already has a query string', () => {
		expect(buildPosterUrl('http://plex.local:32400', '/photo?w=200', 'tok')).toBe(
			'http://plex.local:32400/photo?w=200&X-Plex-Token=tok'
		);
	});

	it('url-encodes the token', () => {
		expect(buildPosterUrl('http://plex.local:32400', '/thumb/1', 'a b/c=')).toBe(
			'http://plex.local:32400/thumb/1?X-Plex-Token=a%20b%2Fc%3D'
		);
	});

	it('returns null when no thumb is available', () => {
		expect(buildPosterUrl('http://plex.local:32400', null, 'tok')).toBeNull();
		expect(buildPosterUrl('http://plex.local:32400', undefined, 'tok')).toBeNull();
		expect(buildPosterUrl('http://plex.local:32400', '', 'tok')).toBeNull();
	});
});
