import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ fetchJson: vi.fn() }));
vi.mock('$lib/server/http', () => ({ fetchJson: h.fetchJson }));

import {
	resolveTmdb,
	resolveTmdbStrict,
	searchTmdbCandidates,
	verifyTmdbCandidate
} from './client';

describe('manual TMDB client', () => {
	beforeEach(() => h.fetchJson.mockReset());

	it('searches movie and TV independently with localized year filters', async () => {
		h.fetchJson
			.mockResolvedValueOnce({
				results: [{ id: 550, title: 'Clube da Luta', release_date: '1999-10-15' }]
			})
			.mockResolvedValueOnce({
				results: [{ id: 123, name: 'Fight Club TV', first_air_date: '1999-01-01' }]
			});

		const results = await searchTmdbCandidates(
			{ query: 'Fight Club', year: 1999, mediaType: 'both', language: 'pt-BR' },
			'Bearer test-key'
		);

		expect(results.map((result) => result.mediaType)).toEqual(['movie', 'tv']);
		const [movieUrl, tvUrl] = h.fetchJson.mock.calls.map(([url]) => new URL(url));
		expect(movieUrl.pathname).toBe('/3/search/movie');
		expect(movieUrl.searchParams.get('query')).toBe('Fight Club');
		expect(movieUrl.searchParams.get('year')).toBe('1999');
		expect(movieUrl.searchParams.get('language')).toBe('pt-BR');
		expect(tvUrl.pathname).toBe('/3/search/tv');
		expect(tvUrl.searchParams.get('first_air_date_year')).toBe('1999');
	});

	it('restricts search to the requested media type', async () => {
		h.fetchJson.mockResolvedValue({ results: [] });
		await searchTmdbCandidates({ query: 'The Matrix', mediaType: 'movie' }, 'Bearer test-key');
		expect(h.fetchJson).toHaveBeenCalledTimes(1);
		expect(new URL(h.fetchJson.mock.calls[0][0]).pathname).toBe('/3/search/movie');
	});

	it('force-refreshes exact identity validation and distinguishes not-found from outage', async () => {
		h.fetchJson.mockResolvedValueOnce({ id: 550, title: 'Fight Club' });
		await expect(verifyTmdbCandidate('550', 'movie', 'Bearer test-key')).resolves.toMatchObject({
			tmdbId: '550',
			mediaType: 'movie'
		});
		expect(h.fetchJson).toHaveBeenLastCalledWith(
			expect.stringContaining('/movie/550'),
			expect.objectContaining({ cacheTtlDays: 0, forceRefresh: true })
		);

		h.fetchJson.mockRejectedValueOnce(new Error('HTTP 404 for candidate'));
		await expect(verifyTmdbCandidate('550', 'movie', 'Bearer test-key')).resolves.toBeNull();

		h.fetchJson.mockRejectedValueOnce(new Error('HTTP 503 upstream unavailable'));
		await expect(verifyTmdbCandidate('550', 'movie', 'Bearer test-key')).rejects.toThrow('503');
	});

	it('keeps strict automatic-resolution outages distinct from deterministic no-match', async () => {
		h.fetchJson.mockRejectedValueOnce(new Error('HTTP 503 TMDB unavailable'));
		await expect(resolveTmdbStrict({ imdb: 'tt0000100' }, 'Bearer test-key')).rejects.toThrow(
			'503'
		);

		h.fetchJson.mockRejectedValueOnce(new Error('HTTP 503 TMDB unavailable'));
		await expect(resolveTmdb({ imdb: 'tt0000100' }, 'Bearer test-key')).resolves.toBeNull();

		h.fetchJson.mockRejectedValueOnce(new Error('HTTP 404 no match'));
		await expect(resolveTmdbStrict({ imdb: 'tt404' }, 'Bearer test-key')).resolves.toBeNull();

		h.fetchJson
			.mockRejectedValueOnce(new Error('HTTP 404 not a movie'))
			.mockResolvedValueOnce({ id: 1399, name: 'Game of Thrones' });
		await expect(resolveTmdbStrict({ tmdb: '1399' }, 'Bearer test-key')).resolves.toEqual({
			tmdbId: '1399',
			mediaType: 'tv'
		});
	});
});
