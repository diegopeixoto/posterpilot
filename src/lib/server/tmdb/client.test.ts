import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ fetchJson: vi.fn() }));
vi.mock('$lib/server/http', () => ({ fetchJson: h.fetchJson }));

import {
	resolveTmdb,
	resolveTmdbStrict,
	searchTmdbCandidates,
	verifyTmdbCandidate
} from './client';

describe('TMDB client', () => {
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
		await expect(
			resolveTmdbStrict({ imdb: 'tt0000100' }, 'Bearer test-key', {
				expectedMediaType: 'movie'
			})
		).rejects.toThrow('503');

		h.fetchJson.mockRejectedValueOnce(new Error('HTTP 503 TMDB unavailable'));
		await expect(
			resolveTmdb({ imdb: 'tt0000100' }, 'Bearer test-key', { expectedMediaType: 'movie' })
		).resolves.toBeNull();

		h.fetchJson.mockRejectedValueOnce(new Error('HTTP 404 no match'));
		await expect(
			resolveTmdbStrict({ imdb: 'tt404' }, 'Bearer test-key', { expectedMediaType: 'movie' })
		).resolves.toBeNull();

		h.fetchJson
			.mockRejectedValueOnce(new Error('HTTP 404 not a TV show'))
			.mockRejectedValueOnce(new Error('HTTP 404 not a movie either'));
		await expect(
			resolveTmdbStrict({ tmdb: '1399' }, 'Bearer test-key', { expectedMediaType: 'tv' })
		).resolves.toBeNull();
		expect(h.fetchJson).toHaveBeenCalledTimes(5);
	});

	it('validates a direct id only in the expected namespace, including equal numeric ids', async () => {
		h.fetchJson.mockResolvedValue({ id: 42 });

		await expect(
			resolveTmdbStrict({ tmdb: '42' }, 'Bearer test-key', { expectedMediaType: 'movie' })
		).resolves.toEqual({ tmdbId: '42', mediaType: 'movie' });
		await expect(
			resolveTmdbStrict({ tmdb: '42' }, 'Bearer test-key', { expectedMediaType: 'tv' })
		).resolves.toEqual({ tmdbId: '42', mediaType: 'tv' });

		const [movieCall, tvCall] = h.fetchJson.mock.calls;
		expect(new URL(movieCall[0]).pathname).toBe('/3/movie/42');
		expect(movieCall[1]).toMatchObject({ cacheNamespace: 'tmdb-resolution:movie' });
		expect(new URL(tvCall[0]).pathname).toBe('/3/tv/42');
		expect(tvCall[1]).toMatchObject({ cacheNamespace: 'tmdb-resolution:tv' });
		expect(h.fetchJson).toHaveBeenCalledTimes(2);
	});

	it('parses /find only from the expected bucket and namespaces its cache', async () => {
		const response = { movie_results: [{ id: 42 }], tv_results: [{ id: 42 }] };
		h.fetchJson.mockResolvedValue(response);

		await expect(
			resolveTmdbStrict({ imdb: 'tt42' }, 'Bearer test-key', { expectedMediaType: 'movie' })
		).resolves.toEqual({ tmdbId: '42', mediaType: 'movie' });
		await expect(
			resolveTmdbStrict({ imdb: 'tt42' }, 'Bearer test-key', { expectedMediaType: 'tv' })
		).resolves.toEqual({ tmdbId: '42', mediaType: 'tv' });

		expect(h.fetchJson.mock.calls[0][1]).toMatchObject({
			cacheNamespace: 'tmdb-resolution:movie'
		});
		expect(h.fetchJson.mock.calls[1][1]).toMatchObject({ cacheNamespace: 'tmdb-resolution:tv' });
	});

	it('accepts the opposite /find bucket when the expected one is empty', async () => {
		// A miniseries filed in a movie library — or the reverse — must not become
		// a permanent no-match: the id is accepted only where TMDB actually has
		// it, and the expected bucket still wins whenever it answers.
		h.fetchJson.mockResolvedValue({ movie_results: [{ id: 603 }], tv_results: [] });

		await expect(
			resolveTmdbStrict({ tvdb: '12345' }, 'Bearer test-key', { expectedMediaType: 'tv' })
		).resolves.toEqual({ tmdbId: '603', mediaType: 'movie' });
	});

	it('resolves a direct id through the other namespace when the expected one lacks it', async () => {
		h.fetchJson
			.mockRejectedValueOnce(new Error('HTTP 404 not a movie'))
			.mockResolvedValueOnce({ id: 1399, name: 'Sherlock' });

		await expect(
			resolveTmdbStrict({ tmdb: '1399' }, 'Bearer test-key', { expectedMediaType: 'movie' })
		).resolves.toEqual({ tmdbId: '1399', mediaType: 'tv' });
		const [movieCall, tvCall] = h.fetchJson.mock.calls;
		expect(new URL(movieCall[0]).pathname).toBe('/3/movie/1399');
		expect(new URL(tvCall[0]).pathname).toBe('/3/tv/1399');
	});
});
