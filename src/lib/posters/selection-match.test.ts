import { describe, expect, it } from 'vitest';
import { stagedArtworkMatchesCandidate, toggleStagedArtworkCandidate } from './selection-match';

const tmdbCandidate = {
	id: 11,
	url: 'https://image.tmdb.org/t/p/original/poster.jpg',
	provider: 'tmdb'
};

describe('staged artwork matching', () => {
	it('matches a rediscovered TMDB candidate by canonical URL when its id changed', () => {
		expect(
			stagedArtworkMatchesCandidate(
				{
					url: 'https://image.tmdb.org/t/p/w500/poster.jpg',
					candidateId: 10,
					provider: 'tmdb'
				},
				tmdbCandidate
			)
		).toBe(true);
	});

	it.each([
		['different provider', 'mediux'],
		['custom selection', 'custom']
	])('does not match the same URL with %s provenance', (_case, provider) => {
		expect(
			stagedArtworkMatchesCandidate(
				{
					url: tmdbCandidate.url,
					candidateId: tmdbCandidate.id,
					provider
				},
				tmdbCandidate
			)
		).toBe(false);
	});

	it('clears the URL and both provenance fields for an equivalent rediscovered candidate', () => {
		expect(
			toggleStagedArtworkCandidate(
				{
					url: 'https://image.tmdb.org/t/p/w500/poster.jpg',
					candidateId: 10,
					provider: 'tmdb'
				},
				tmdbCandidate
			)
		).toEqual({ url: null, candidateId: null, provider: null });
	});
});
