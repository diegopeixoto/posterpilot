import { describe, expect, it } from 'vitest';
import { parseDetailMetadata, pickLogoUrl, tmdbImageUrl } from './metadata';

describe('tmdbImageUrl', () => {
	it('builds an absolute URL for a path + size', () => {
		expect(tmdbImageUrl('/abc.jpg', 'w500')).toBe('https://image.tmdb.org/t/p/w500/abc.jpg');
	});

	it('returns null for a missing path', () => {
		expect(tmdbImageUrl(null, 'w500')).toBeNull();
		expect(tmdbImageUrl(undefined, 'w500')).toBeNull();
	});
});

describe('parseDetailMetadata (movie)', () => {
	const detail = {
		overview: 'A blade runner unearths a secret.',
		tagline: 'There is an order to things.',
		genres: [
			{ id: 18, name: 'Drama' },
			{ id: 878, name: 'Science Fiction' }
		],
		runtime: 164,
		vote_average: 8.0,
		backdrop_path: '/bd.jpg',
		credits: {
			cast: [
				{ name: 'Ryan Gosling', character: 'K', profile_path: '/rg.jpg' },
				{ name: 'Harrison Ford', character: 'Deckard', profile_path: null }
			]
		}
	};

	it('extracts core fields', () => {
		const m = parseDetailMetadata(detail, 'movie');
		expect(m.overview).toBe('A blade runner unearths a secret.');
		expect(m.tagline).toBe('There is an order to things.');
		expect(m.genres).toEqual(['Drama', 'Science Fiction']);
		expect(m.runtime).toBe(164);
		expect(m.rating).toBe(8.0);
		expect(m.backdropUrl).toBe('https://image.tmdb.org/t/p/w1280/bd.jpg');
	});

	it('extracts top-billed cast with profile URLs', () => {
		const m = parseDetailMetadata(detail, 'movie');
		expect(m.cast).toEqual([
			{
				name: 'Ryan Gosling',
				character: 'K',
				profileUrl: 'https://image.tmdb.org/t/p/w185/rg.jpg'
			},
			{ name: 'Harrison Ford', character: 'Deckard', profileUrl: null }
		]);
	});

	it('leaves show counts null for a movie', () => {
		const m = parseDetailMetadata(detail, 'movie');
		expect(m.seasonCount).toBeNull();
		expect(m.episodeCount).toBeNull();
	});

	it('caps cast at 8 members', () => {
		const big = {
			...detail,
			credits: {
				cast: Array.from({ length: 20 }, (_, i) => ({
					name: `Actor ${i}`,
					character: `C${i}`,
					profile_path: null
				}))
			}
		};
		expect(parseDetailMetadata(big, 'movie').cast).toHaveLength(8);
	});
});

describe('parseDetailMetadata (tv)', () => {
	const detail = {
		overview: 'A show.',
		genres: [{ id: 18, name: 'Drama' }],
		number_of_seasons: 5,
		number_of_episodes: 62,
		episode_run_time: [47],
		vote_average: 9.4,
		backdrop_path: '/tv.jpg',
		credits: { cast: [] }
	};

	it('extracts season and episode counts', () => {
		const m = parseDetailMetadata(detail, 'tv');
		expect(m.seasonCount).toBe(5);
		expect(m.episodeCount).toBe(62);
	});

	it('uses the first episode run time as runtime', () => {
		expect(parseDetailMetadata(detail, 'tv').runtime).toBe(47);
	});
});

describe('parseDetailMetadata (missing fields)', () => {
	it('maps missing optionals to null/empty without throwing', () => {
		const m = parseDetailMetadata({ overview: '' }, 'movie');
		expect(m.overview).toBeNull();
		expect(m.tagline).toBeNull();
		expect(m.genres).toEqual([]);
		expect(m.runtime).toBeNull();
		expect(m.rating).toBeNull();
		expect(m.backdropUrl).toBeNull();
		expect(m.cast).toEqual([]);
	});

	it('treats an unrated (vote_average 0) item as no rating', () => {
		expect(parseDetailMetadata({ vote_average: 0 }, 'movie').rating).toBeNull();
	});
});

describe('pickLogoUrl', () => {
	it('prefers an English logo', () => {
		const json = {
			logos: [
				{ iso_639_1: 'fr', file_path: '/fr.png' },
				{ iso_639_1: 'en', file_path: '/en.png' }
			]
		};
		expect(pickLogoUrl(json)).toBe('https://image.tmdb.org/t/p/w500/en.png');
	});

	it('falls back to the first logo when no English one exists', () => {
		const json = { logos: [{ iso_639_1: 'ja', file_path: '/ja.png' }] };
		expect(pickLogoUrl(json)).toBe('https://image.tmdb.org/t/p/w500/ja.png');
	});

	it('returns null when there are no logos', () => {
		expect(pickLogoUrl({ logos: [] })).toBeNull();
		expect(pickLogoUrl({})).toBeNull();
	});
});
