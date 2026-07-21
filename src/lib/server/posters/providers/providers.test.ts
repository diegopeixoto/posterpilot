import { describe, expect, it } from 'vitest';
import { parseTmdbImages, parseFanart, parseThePosterDb, bestThePosterDbResultId } from './parse';

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

/**
 * The site no longer embeds `/api/assets/<id>` URLs. A poster page today serves its
 * images from the CDN as `images.theposterdb.com/.../posters/optimized/<section>/<id>/<hash>.jpg`,
 * each one twice — a .webp and a .jpg of the same image.
 */
describe('parseThePosterDb — CDN urls', () => {
	const cdn = (name: string, ext: string) =>
		`https://images.theposterdb.com/prod/public/images/posters/optimized/movies/17657/${name}.${ext}`;

	it('reads the CDN urls a poster page actually serves', () => {
		const html = `<img src="${cdn('aaa', 'jpg')}"><img src="${cdn('bbb', 'jpg')}">`;
		expect(parseThePosterDb(html)[0].candidates.map((c) => c.url)).toEqual([
			cdn('aaa', 'jpg'),
			cdn('bbb', 'jpg')
		]);
	});

	it('collapses the webp/jpg pair of one image into one candidate', () => {
		const html = `<source srcset="${cdn('aaa', 'webp')}"><img src="${cdn('aaa', 'jpg')}">`;
		const [set] = parseThePosterDb(html);
		expect(set.candidates).toHaveLength(1);
		expect(set.candidates[0].url).toBe(cdn('aaa', 'jpg'));
	});

	it('still reads the older /api/assets form', () => {
		const html = '<img src="https://theposterdb.com/api/assets/111">';
		expect(parseThePosterDb(html)[0].candidates[0].url).toBe(
			'https://theposterdb.com/api/assets/111'
		);
	});
});

/**
 * Discovery is a name search, and the top hit is regularly the wrong title: searching
 * "Saving Private Ryan 1998" ranks the documentary "Making 'Saving Private Ryan'"
 * first, whose page holds no posters at all. Picking a mismatched set would paint
 * another film's artwork onto the library, so no match yields null.
 */
describe('bestThePosterDbResultId', () => {
	const hit = (id: string, title: string, year: string) =>
		`<a href="https://theposterdb.com/posters/${id}" class="x"><strong>${title}</strong> (${year})</a>`;

	it('picks the hit whose title matches, not the first one', () => {
		const html =
			hit('26308', "Making 'Saving Private Ryan'", '2004') +
			hit('17657', 'Saving Private Ryan', '1998');
		expect(bestThePosterDbResultId(html, { title: 'Saving Private Ryan', year: 1998 })).toBe(
			'17657'
		);
	});

	it('prefers the right year when a title repeats', () => {
		const html = hit('1', 'Dune', '1984') + hit('2', 'Dune', '2021');
		expect(bestThePosterDbResultId(html, { title: 'Dune', year: 2021 })).toBe('2');
	});

	it('matches across accents and punctuation', () => {
		const html = hit('9', 'WALL·E', '2008');
		expect(bestThePosterDbResultId(html, { title: 'Wall-E', year: 2008 })).toBe('9');
	});

	it('returns null rather than a wrong set', () => {
		const html = hit('26308', "Making 'Saving Private Ryan'", '2004');
		expect(bestThePosterDbResultId(html, { title: 'Saving Private Ryan', year: 1998 })).toBeNull();
		expect(bestThePosterDbResultId('<html>no hits</html>', { title: 'X', year: null })).toBeNull();
	});
});
