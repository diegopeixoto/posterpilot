import { describe, expect, it } from 'vitest';
import {
	parseTmdbImages,
	parseFanart,
	parseThePosterDb,
	parseThePosterDbAssets,
	parseThePosterDbSearchResults,
	bestThePosterDbResultId
} from './parse';

describe('parseTmdbImages', () => {
	it('builds poster + backdrop candidates in one set', () => {
		const sets = parseTmdbImages({
			posters: [
				{ file_path: '/p.jpg', width: 2000, height: 3000, iso_639_1: 'pt-BR' },
				{ file_path: '/untagged.jpg', iso_639_1: null },
				{ file_path: '/legacy-shape.jpg' }
			],
			backdrops: [{ file_path: '/b.jpg', width: 3840, height: 2160, iso_639_1: 'en' }]
		});
		expect(sets).toHaveLength(1);
		const c = sets[0].candidates;
		expect(c.find((x) => x.providerAssetId === '/p.jpg')).toMatchObject({
			url: 'https://image.tmdb.org/t/p/original/p.jpg',
			previewUrl: 'https://image.tmdb.org/t/p/w500/p.jpg',
			width: 2000,
			height: 3000,
			language: 'pt',
			languageProvenance: 'tagged'
		});
		expect(c.find((x) => x.providerAssetId === '/b.jpg')).toMatchObject({
			url: 'https://image.tmdb.org/t/p/original/b.jpg',
			previewUrl: 'https://image.tmdb.org/t/p/w1280/b.jpg',
			width: 3840,
			height: 2160,
			language: 'en',
			languageProvenance: 'tagged'
		});
		expect(c.find((x) => x.providerAssetId === '/untagged.jpg')).toMatchObject({
			language: null,
			languageProvenance: 'untagged'
		});
		expect(c.find((x) => x.providerAssetId === '/legacy-shape.jpg')).toMatchObject({
			language: null,
			languageProvenance: 'unknown'
		});
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
			{
				movieposter: [{ id: '41', url: 'http://f/p.png', lang: 'en' }],
				moviebackground: [{ url: 'http://f/b.png', lang: null }]
			},
			'movie'
		);
		const c = sets[0].candidates;
		expect(c.find((x) => x.kind === 'poster')).toMatchObject({
			providerAssetId: '41',
			url: 'http://f/p.png',
			previewUrl: null,
			language: 'en',
			languageProvenance: 'tagged'
		});
		expect(c.find((x) => x.kind === 'background')).toMatchObject({
			providerAssetId: null,
			url: 'http://f/b.png',
			previewUrl: null,
			language: null,
			languageProvenance: 'untagged'
		});
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
		expect(sets[0].candidates.map((c) => c.providerAssetId)).toEqual(['111', '222']);
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

	it('returns null when the only same-title hit lists a different year (a remake is another film)', () => {
		const html = hit('1', 'Dune', '1984');
		expect(bestThePosterDbResultId(html, { title: 'Dune', year: 2021 })).toBeNull();
	});

	it('accepts a hit that lists no year when the wanted year has no exact match', () => {
		const yearless = (id: string, title: string) =>
			`<a href="https://theposterdb.com/posters/${id}" class="x"><strong>${title}</strong></a>`;
		const html = hit('1', 'Dune', '1984') + yearless('3', 'Dune');
		expect(bestThePosterDbResultId(html, { title: 'Dune', year: 2021 })).toBe('3');
	});
});

describe('parseThePosterDbAssets', () => {
	const assetA =
		'https://images.theposterdb.com/prod/public/images/posters/optimized/movies/2578/psOBkRYwJVfMjLXtMQ9YJ36aOekJPMWs9Vv7PL0P.webp';
	const assetB =
		'https://images.theposterdb.com/prod/public/images/posters/optimized/movies/2578/anotherFileNameHere1234.jpg';

	// Two genuine cards taken from a real (authenticated) ThePosterDB title page — a
	// <picture> with webp + jpeg <source> variants of the same poster, a numeric
	// data-poster-id, an "uploaded by <user>" byline, and a link to that user's set.
	function realCard(posterId: string, fileName: string, author: string, setId: string): string {
		return `
			<div class="col-6 col-lg-2 p-1">
			<div class="hovereffect rounded-poster">
				<picture>
					<source class="w-100 rounded-poster" type="image/webp" srcset="https://images.theposterdb.com/prod/public/images/posters/optimized/movies/3624/${fileName}.webp">
					<source class="w-100 rounded-poster" type="image/jpeg" srcset="https://images.theposterdb.com/prod/public/images/posters/optimized/movies/3624/${fileName}.jpg">
					<img class="w-100 rounded-poster tpdb-poster" loading="lazy" src="/images/defaults/missing_poster.jpg">
				</picture>
				<div class="overlay rounded-poster" data-poster-id='${posterId}' data-poster-type='movie'>
					<div class="row m-0 h-100 p-3">
						<div class="col-11 p-0 pr-1 poster-title-correction">
							<p class="p-0 mb-1 text-break">Final Destination (2000)</p>
							<p class="uploaded-by text-white d-inline-block text-truncate w-100">by <a href="https://theposterdb.com/user/${author}">${author}</a></p>
						</div>
						<div class="col-1 p-0 d-flex flex-column align-items-center">
							<a href="https://theposterdb.com/set/${setId}" class="badge badge-pill badge-primary mt-2 set_poster_count" title="Posters in Set">7</a>
						</div>
					</div>
				</div>
			</div>
			</div>`;
	}

	it('groups real cards by contributor set and takes only the webp variant', () => {
		const html =
			realCard('883', 'lbzoHxi7bDQ3b6Ly3XK9wolkosbPhx2CPHQEj6Fg', 'cinemoire', '254') +
			realCard('165947', '5zbUrqku3HOP6KCrXStZsgiV240EMAbnpMHRfIcV', 'XDM', '101438');
		const sets = parseThePosterDbAssets(html);
		expect(sets).toHaveLength(2);
		expect(sets.map((s) => s.author)).toEqual(['cinemoire', 'XDM']);
		// One candidate per set (the webp source only — not also the jpeg variant of the
		// same poster, which is what previously showed up as a visual duplicate).
		expect(sets.every((s) => s.candidates.length === 1)).toBe(true);
		expect(sets[0].candidates[0].url).toBe(
			'https://images.theposterdb.com/prod/public/images/posters/optimized/movies/3624/lbzoHxi7bDQ3b6Ly3XK9wolkosbPhx2CPHQEj6Fg.webp'
		);
		expect(sets[0].candidates[0].setAuthor).toBe('cinemoire');
		expect(sets[0].candidates[0].providerAssetId).toBe('883');
	});

	it('keys the set by the real ThePosterDB set id, not the individual poster id', () => {
		const sets = parseThePosterDbAssets(
			realCard('883', 'lbzoHxi7bDQ3b6Ly3XK9wolkosbPhx2CPHQEj6Fg', 'MBF', '13035')
		);
		expect(sets[0].setId).toBe('theposterdb-13035');
		expect(sets[0].candidates[0].setId).toBe('theposterdb-13035');
	});

	it('produces the same setId for the same creator set across different titles', () => {
		// Same contributor's set (13035), two different movies from that set's franchise —
		// this is what lets the collection "suggested visual family" grouping recognize it's
		// the same set covering multiple members, exactly like it already does for MediUX.
		const batmanBegins = parseThePosterDbAssets(
			realCard('2578', 'batmanBeginsFile', 'MBF', '13035')
		)[0];
		const darkKnight = parseThePosterDbAssets(
			realCard('3844', 'darkKnightFile', 'MBF', '13035')
		)[0];
		expect(batmanBegins.setId).toBe(darkKnight.setId);
		expect(batmanBegins.author).toBe(darkKnight.author);
	});

	it('falls back to the flat unattributed scrape when the card structure does not match', () => {
		const html = `<img class="tpdb-poster" src="${assetA}">
			<img class="tpdb-poster" src="${assetB}">
			<a href="${assetA}">dup</a>`;
		const sets = parseThePosterDbAssets(html);
		expect(sets[0].candidates.map((c) => c.url)).toEqual([assetA, assetB]);
		expect(sets[0].candidates.every((c) => c.kind === 'poster')).toBe(true);
		expect(sets[0].author).toBeNull();
	});

	it('ignores the anonymous placeholder image', () => {
		const html = `<img class="tpdb-poster" src="/images/defaults/missing_poster.jpg">`;
		expect(parseThePosterDbAssets(html)).toEqual([]);
	});

	it('returns [] when no assets are present', () => {
		expect(parseThePosterDbAssets('<html>nothing</html>')).toEqual([]);
	});
});

describe('parseThePosterDbSearchResults', () => {
	it('extracts title, year and the poster-collection page URL, de-duplicated', () => {
		const html = `
			<div class="col-12 col-md-4 p-1">
				<div class="btn-group d-flex flex-row">
					<a class="btn btn-dark-lighter" href="https://theposterdb.com/posters/2578">
						<strong>Batman Begins</strong> (2005)
					</a>
				</div>
			</div>
			<div class="col-12 col-md-4 p-1">
				<div class="btn-group d-flex flex-row">
					<a class="btn btn-dark-lighter" href="https://theposterdb.com/posters/2168448">
						<strong>Batman: Operation Hamlet</strong> (2024)
					</a>
				</div>
			</div>
			<div class="col-12 col-md-4 p-1">
				<div class="btn-group d-flex flex-row">
					<a class="btn btn-dark-lighter" href="https://theposterdb.com/posters/2578">
						<strong>Batman Begins</strong> (2005)
					</a>
				</div>
			</div>`;
		expect(parseThePosterDbSearchResults(html)).toEqual([
			{ url: 'https://theposterdb.com/posters/2578', title: 'Batman Begins', year: 2005 },
			{
				url: 'https://theposterdb.com/posters/2168448',
				title: 'Batman: Operation Hamlet',
				year: 2024
			}
		]);
	});

	it('returns [] when no results are present', () => {
		expect(parseThePosterDbSearchResults('<html>no results</html>')).toEqual([]);
	});
});
