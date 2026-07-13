import { describe, expect, it } from 'vitest';
import { parseTmdbManualSearchResults, parseVerifiedTmdbCandidate } from './manual-search';

describe('manual TMDB candidate parsing', () => {
	it('returns disambiguating movie metadata and skips malformed entries', () => {
		expect(
			parseTmdbManualSearchResults(
				{
					results: [
						{
							id: 550,
							title: 'Fight Club',
							original_title: 'Fight Club',
							release_date: '1999-10-15',
							overview: 'An insomniac meets a soap maker.',
							poster_path: '/poster.jpg'
						},
						{ id: 0, title: 'Invalid' },
						{ id: 1 }
					]
				},
				'movie'
			)
		).toEqual([
			{
				tmdbId: '550',
				mediaType: 'movie',
				title: 'Fight Club',
				originalTitle: 'Fight Club',
				year: 1999,
				overview: 'An insomniac meets a soap maker.',
				posterUrl: 'https://image.tmdb.org/t/p/w342/poster.jpg'
			}
		]);
	});

	it('uses TV naming/date fields and tolerates missing optional metadata', () => {
		expect(
			parseTmdbManualSearchResults(
				{ results: [{ id: '1399', name: 'Game of Thrones', first_air_date: '' }] },
				'tv'
			)
		).toEqual([
			{
				tmdbId: '1399',
				mediaType: 'tv',
				title: 'Game of Thrones',
				originalTitle: null,
				year: null,
				overview: null,
				posterUrl: null
			}
		]);
	});

	it('rejects a detail payload whose identity does not match the requested candidate', () => {
		expect(parseVerifiedTmdbCandidate({ id: 551, title: 'Other' }, 'movie', '550')).toBeNull();
		expect(
			parseVerifiedTmdbCandidate({ id: 550, title: 'Fight Club' }, 'movie', '550')
		).toMatchObject({
			tmdbId: '550',
			mediaType: 'movie'
		});
	});
});
