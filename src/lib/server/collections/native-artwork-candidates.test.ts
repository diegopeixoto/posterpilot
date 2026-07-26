import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORE_WEIGHTS } from '$lib/server/posters/score';
import {
	buildThePosterDbCollectionArtworkCandidates,
	nativeCollectionCandidateSetFingerprint,
	parseTmdbCollectionArtworkCandidates
} from './native-artwork-candidates';

describe('native collection TMDB artwork candidates', () => {
	it('parses credentials-free poster and background candidates deterministically', () => {
		const input = {
			posters: [
				{ file_path: '/small.jpg', width: 300, height: 450, iso_639_1: 'en' },
				{ file_path: '/large.jpg', width: 2000, height: 3000, iso_639_1: null },
				{ file_path: '/large.jpg', width: 2000, height: 3000, iso_639_1: null }
			],
			backdrops: [{ file_path: '/wide.webp', width: 3840, height: 2160, iso_639_1: 'pt-BR' }]
		};
		const first = parseTmdbCollectionArtworkCandidates(input, '726871', DEFAULT_SCORE_WEIGHTS);
		const second = parseTmdbCollectionArtworkCandidates(input, '726871', DEFAULT_SCORE_WEIGHTS);

		expect(first).toEqual(second);
		expect(first).toHaveLength(3);
		expect(first[0]).toMatchObject({
			provider: 'tmdb',
			providerAssetId: '/large.jpg',
			kind: 'poster',
			tmdbCollectionId: '726871'
		});
		expect(first[0].url).toBe('https://image.tmdb.org/t/p/original/large.jpg');
		expect(first[0].previewUrl).toBe('https://image.tmdb.org/t/p/w500/large.jpg');
		expect(JSON.stringify(first)).not.toMatch(/api_key|authorization|bearer/i);
		expect(nativeCollectionCandidateSetFingerprint(first)).toMatch(/^[a-f0-9]{64}$/);
	});

	it('rejects unsafe paths, malformed dimensions, and invalid collection ids', () => {
		const input = {
			posters: [
				{ file_path: 'https://internal.test/a.jpg', width: 1000, height: 1500 },
				{ file_path: '/../secret.jpg', width: 1000, height: 1500 },
				{ file_path: '/valid.jpg?token=secret', width: 1000, height: 1500 }
			],
			backdrops: [{ file_path: '/valid.jpg', width: -1, height: 'bad' }]
		};
		const candidates = parseTmdbCollectionArtworkCandidates(input, '42', DEFAULT_SCORE_WEIGHTS);
		expect(candidates).toHaveLength(1);
		expect(candidates[0]).toMatchObject({ width: null, height: null });
		expect(parseTmdbCollectionArtworkCandidates(input, '../42', DEFAULT_SCORE_WEIGHTS)).toEqual([]);
	});
});

describe('native collection ThePosterDB artwork candidates', () => {
	function set(setId: string, author: string, url: string) {
		return {
			setId,
			author,
			candidates: [
				{ setId, setAuthor: author, url, kind: 'poster' as const, season: null, episode: null }
			]
		};
	}

	it('converts poster-only sets, deduplicates by url, and drops non-poster/season entries', () => {
		const sets = [
			set(
				'theposterdb-1',
				'creator-a',
				'https://images.theposterdb.com/prod/public/images/posters/optimized/movies/1/a.webp'
			),
			set(
				'theposterdb-1',
				'creator-a',
				'https://images.theposterdb.com/prod/public/images/posters/optimized/movies/1/a.webp'
			),
			set(
				'theposterdb-2',
				'creator-b',
				'https://images.theposterdb.com/prod/public/images/posters/optimized/movies/2/b.webp'
			),
			{
				setId: 'theposterdb-3',
				author: 'creator-c',
				candidates: [
					{
						setId: 'theposterdb-3',
						setAuthor: 'creator-c',
						url: 'https://images.theposterdb.com/prod/public/images/posters/optimized/movies/3/c.webp',
						kind: 'poster' as const,
						season: 1,
						episode: null
					}
				]
			}
		];
		const candidates = buildThePosterDbCollectionArtworkCandidates(
			sets,
			'900',
			DEFAULT_SCORE_WEIGHTS
		);
		expect(candidates).toHaveLength(2);
		expect(candidates.every((c) => c.provider === 'theposterdb')).toBe(true);
		expect(candidates.every((c) => c.kind === 'poster')).toBe(true);
		expect(candidates.every((c) => c.tmdbCollectionId === '900')).toBe(true);
		expect(candidates.every((c) => c.width === null && c.height === null)).toBe(true);
	});

	it('rejects an invalid collection id', () => {
		const sets = [
			set(
				'theposterdb-1',
				'creator-a',
				'https://images.theposterdb.com/prod/public/images/posters/optimized/movies/1/a.webp'
			)
		];
		expect(
			buildThePosterDbCollectionArtworkCandidates(sets, '../900', DEFAULT_SCORE_WEIGHTS)
		).toEqual([]);
	});
});
