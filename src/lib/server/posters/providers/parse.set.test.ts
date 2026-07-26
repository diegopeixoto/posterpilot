import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseThePosterDbSet } from './parse';

const setHtml = readFileSync(
	fileURLToPath(new URL('./__fixtures__/theposterdb-set.html', import.meta.url)),
	'utf8'
);

describe('parseThePosterDbSet', () => {
	it('extracts one poster per set card with title, year, type, and shared set id', () => {
		const posters = parseThePosterDbSet(setHtml);
		expect(posters).toEqual([
			{
				posterId: '487329',
				type: 'movie',
				url: 'https://images.theposterdb.com/prod/public/images/posters/optimized/movies/2084864/7HXOEOYbje1pwYsjb6kRY1WPqnLhqdWXia6vkxeG.webp',
				title: 'Cash Out',
				year: 2024,
				setId: '324469'
			},
			{
				posterId: '583343',
				type: 'collection',
				url: 'https://images.theposterdb.com/prod/public/images/posters/optimized/collections/1896293/RQJTEtZU88uy0lssLSFZ5FsBQFOGfJIkgmgbPkB6.webp',
				title: 'Cash Out - Saga',
				year: null,
				setId: '324469'
			},
			{
				posterId: '583344',
				type: 'movie',
				url: 'https://images.theposterdb.com/prod/public/images/posters/optimized/movies/1901161/0OygtLoqJJopU7hV1a2xolpOhhx3LolVRCsxNGYp.webp',
				title: 'High Rollers',
				year: 2025,
				setId: '324469'
			},
			{
				posterId: '728477',
				type: 'movie',
				url: 'https://images.theposterdb.com/prod/public/images/posters/optimized/movies/2714729/3Z5qCj5lgM04MuBEQ3p1FoH7SGA4iRO5ZKYbSYad.webp',
				title: 'The Gentleman Thief',
				year: 2026,
				setId: '324469'
			}
		]);
	});

	it('returns [] on markup with no set cards', () => {
		expect(parseThePosterDbSet('<html><body>nothing</body></html>')).toEqual([]);
	});

	it('matches the live server markup that single-quotes data-poster attributes', () => {
		// The live /set/<id> page uses single quotes (browser "Save As" rewrites them to double).
		const singleQuoted = `
			<source class="w-100 rounded-poster" type="image/webp" srcset="https://images.theposterdb.com/prod/public/images/posters/optimized/movies/2084864/abc.webp">
			<div class="overlay rounded-poster" data-poster-id='487329' data-poster-type='movie' data-mobile-click="false">
				<p class="p-0 mb-1 text-break">Cash Out (2024)</p>
				<a href="https://theposterdb.com/set/324469" class="set_poster_count">4</a>
			</div>`;
		expect(parseThePosterDbSet(singleQuoted)).toEqual([
			{
				posterId: '487329',
				type: 'movie',
				url: 'https://images.theposterdb.com/prod/public/images/posters/optimized/movies/2084864/abc.webp',
				title: 'Cash Out',
				year: 2024,
				setId: '324469'
			}
		]);
	});
});
