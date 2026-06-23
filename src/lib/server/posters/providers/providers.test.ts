import { describe, expect, it } from 'vitest';
import { parseTmdbImages, parseFanart, parseThePosterDb } from './parse';

describe('parseTmdbImages', () => {
	it('builds poster + backdrop candidates in one set', () => {
		const sets = parseTmdbImages({
			posters: [{ file_path: '/p.jpg' }],
			backdrops: [{ file_path: '/b.jpg' }]
		});
		expect(sets).toHaveLength(1);
		const c = sets[0].candidates;
		expect(c.find((x) => x.kind === 'poster')?.url).toBe('https://image.tmdb.org/t/p/w500/p.jpg');
		expect(c.find((x) => x.kind === 'background')?.url).toBe(
			'https://image.tmdb.org/t/p/w1280/b.jpg'
		);
		expect(c.every((x) => x.setId === 'tmdb')).toBe(true);
	});

	it('returns [] when there are no images', () => {
		expect(parseTmdbImages({})).toEqual([]);
		expect(parseTmdbImages({ posters: [], backdrops: [] })).toEqual([]);
	});
});

describe('parseFanart', () => {
	it('maps movie posters and backgrounds', () => {
		const sets = parseFanart(
			{ movieposter: [{ url: 'http://f/p.png' }], moviebackground: [{ url: 'http://f/b.png' }] },
			'movie'
		);
		const c = sets[0].candidates;
		expect(c.find((x) => x.kind === 'poster')?.url).toBe('http://f/p.png');
		expect(c.find((x) => x.kind === 'background')?.url).toBe('http://f/b.png');
	});

	it('maps tv posters, backgrounds, and season posters', () => {
		const sets = parseFanart(
			{
				tvposter: [{ url: 'http://f/tp.png' }],
				showbackground: [{ url: 'http://f/sb.png' }],
				seasonposter: [
					{ url: 'http://f/s1.png', season: '1' },
					{ url: 'http://f/all.png', season: 'all' }
				]
			},
			'tv'
		);
		const c = sets[0].candidates;
		expect(c.find((x) => x.kind === 'poster')?.url).toBe('http://f/tp.png');
		const seasons = c.filter((x) => x.kind === 'season');
		expect(seasons.find((x) => x.url.endsWith('s1.png'))?.season).toBe(1);
		expect(seasons.find((x) => x.url.endsWith('all.png'))?.season).toBeNull();
	});

	it('ignores movie keys for tv and vice versa', () => {
		expect(parseFanart({ movieposter: [{ url: 'x' }] }, 'tv')).toEqual([]);
	});

	it('returns [] for an empty response', () => {
		expect(parseFanart({}, 'movie')).toEqual([]);
	});
});

describe('parseThePosterDb', () => {
	it('extracts and de-duplicates asset URLs', () => {
		const html = `<img src="https://theposterdb.com/api/assets/111">
			<img src="https://theposterdb.com/api/assets/222">
			<a href="https://theposterdb.com/api/assets/111">dup</a>`;
		const sets = parseThePosterDb(html);
		expect(sets[0].candidates.map((c) => c.url)).toEqual([
			'https://theposterdb.com/api/assets/111',
			'https://theposterdb.com/api/assets/222'
		]);
		expect(sets[0].candidates.every((c) => c.kind === 'poster')).toBe(true);
	});

	it('returns [] when no assets are present', () => {
		expect(parseThePosterDb('<html>nothing</html>')).toEqual([]);
	});
});
