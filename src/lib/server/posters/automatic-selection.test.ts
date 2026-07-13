import { describe, expect, it } from 'vitest';
import { selectAutomaticArtwork, type AutomaticCandidateInput } from './automatic-selection';
import { DEFAULT_SCORE_WEIGHTS } from './score';

function candidate(
	id: number,
	overrides: Partial<AutomaticCandidateInput> = {}
): AutomaticCandidateInput {
	return {
		id,
		provider: 'tmdb',
		setId: `set-${id}`,
		setAuthor: null,
		url: `https://example.test/${id}.jpg`,
		kind: 'poster',
		season: null,
		episode: null,
		width: 1000,
		height: 1500,
		...overrides
	};
}

describe('selectAutomaticArtwork', () => {
	it('selects root poster and background independently', () => {
		const result = selectAutomaticArtwork([
			candidate(1),
			candidate(2, { provider: 'mediux' }),
			candidate(3, { kind: 'background', width: 1920, height: 1080 })
		]);

		expect(result.poster?.candidateId).toBe(2);
		expect(result.background?.candidateId).toBe(3);
		expect(result.children).toEqual([]);
	});

	it('selects a deterministic winner for every child slot', () => {
		const result = selectAutomaticArtwork([
			candidate(1, { kind: 'season', season: 1 }),
			candidate(2, { kind: 'season', season: 1, provider: 'mediux' }),
			candidate(3, { kind: 'background', season: 1, width: 1920, height: 1080 }),
			candidate(4, { kind: 'title_card', season: 1, episode: 1, width: 1920, height: 1080 })
		]);

		expect(result.children.map((entry) => [entry.slot.kind, entry.candidateId])).toEqual([
			['background', 3],
			['poster', 2],
			['title_card', 4]
		]);
	});

	it('uses explicit scoring inputs rather than stored database order', () => {
		const weights = {
			...DEFAULT_SCORE_WEIGHTS,
			providerWeights: { ...DEFAULT_SCORE_WEIGHTS.providerWeights, tmdb: 5, mediux: 0 }
		};
		const result = selectAutomaticArtwork(
			[candidate(1, { provider: 'mediux' }), candidate(2, { provider: 'tmdb' })],
			{ weights }
		);

		expect(result.poster?.candidateId).toBe(2);
		expect(result.poster?.score).toBeGreaterThan(5);
	});

	it('uses configured provider priority for exact numeric ties', () => {
		const weights = {
			providerWeights: { alpha: 1, beta: 1 },
			resolutionWeight: 0,
			aspectWeight: 0
		};
		const result = selectAutomaticArtwork(
			[candidate(1, { provider: 'alpha' }), candidate(2, { provider: 'beta' })],
			{ weights, providerPriority: ['beta', 'alpha'] }
		);

		expect(result.poster?.provider).toBe('beta');
	});

	it('rejects candidates that cannot identify a complete slot', () => {
		const result = selectAutomaticArtwork([
			candidate(1, { kind: 'season', season: null }),
			candidate(2, { kind: 'title_card', season: 1, episode: null }),
			candidate(3, { kind: 'poster', episode: 1 })
		]);

		expect(result).toEqual({ poster: null, background: null, children: [] });
	});
});
