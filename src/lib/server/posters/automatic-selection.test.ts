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

	it('lets an unequal score beat the configured provider order', () => {
		// The order governs presentation and equal-score ties only. A better
		// candidate still wins from a provider ordered last, so reordering the
		// list can never quietly override ranking.
		const weights = {
			providerWeights: { alpha: 1, beta: 4 },
			resolutionWeight: 0,
			aspectWeight: 0
		};
		const result = selectAutomaticArtwork(
			[candidate(1, { provider: 'alpha' }), candidate(2, { provider: 'beta' })],
			{ weights, providerPriority: ['alpha', 'beta'] }
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

	it('reports no language decision at all when no preference is configured', () => {
		const result = selectAutomaticArtwork([
			candidate(1, { language: 'de', languageProvenance: 'tagged' }),
			candidate(2, { language: 'en', languageProvenance: 'tagged', width: 2000, height: 3000 })
		]);

		// Absence is the signal: nothing about language was decided, so the ranking is
		// pure score and the winner carries no explanation to render.
		expect(result.poster?.candidateId).toBe(2);
		expect(result.poster?.languageDecision).toBeUndefined();
	});
});

describe('selectAutomaticArtwork language policy', () => {
	const preferred = { mode: 'preferred', language: 'en' } as const;

	it('prefers a matching language over a higher-scoring foreign candidate', () => {
		const result = selectAutomaticArtwork(
			[
				candidate(1, {
					language: 'de',
					languageProvenance: 'tagged',
					width: 2000,
					height: 3000
				}),
				candidate(2, { language: 'en', languageProvenance: 'tagged', width: 400, height: 600 })
			],
			{ languagePolicy: preferred }
		);

		expect(result.poster?.candidateId).toBe(2);
		expect(result.poster?.score).toBeLessThan(1);
		expect(result.poster?.languageDecision).toEqual({
			language: 'en',
			eligibility: 'eligible',
			fallback: false
		});
	});

	it('keeps explicitly untagged artwork in the preferred tier', () => {
		const result = selectAutomaticArtwork(
			[
				candidate(1, { language: 'es', languageProvenance: 'tagged', width: 2000, height: 3000 }),
				candidate(2, { language: null, languageProvenance: 'untagged' })
			],
			{ languagePolicy: preferred }
		);

		expect(result.poster?.candidateId).toBe(2);
		expect(result.poster?.languageDecision).toEqual({
			language: null,
			eligibility: 'eligible',
			fallback: false
		});
	});

	it('falls back to a foreign candidate only when the preferred tier is empty', () => {
		const foreign = [
			candidate(1, { language: 'ja', languageProvenance: 'tagged' }),
			candidate(2, { language: 'de', languageProvenance: 'tagged', width: 2000, height: 3000 })
		];
		const withPreferred = selectAutomaticArtwork(
			[...foreign, candidate(3, { language: 'en', languageProvenance: 'tagged' })],
			{ languagePolicy: preferred }
		);
		const withoutPreferred = selectAutomaticArtwork(foreign, { languagePolicy: preferred });

		expect(withPreferred.poster?.candidateId).toBe(3);
		expect(withPreferred.poster?.languageDecision?.fallback).toBe(false);
		expect(withoutPreferred.poster?.candidateId).toBe(2);
		expect(withoutPreferred.poster?.languageDecision).toEqual({
			language: 'de',
			eligibility: 'foreign',
			fallback: true
		});
	});

	it('never demotes a provider the preference does not govern', () => {
		// MediUX and ThePosterDB always store `unknown`. If a preference pushed them
		// below TMDB, setting one would quietly swap every curated set for a TMDB
		// image. They are outside this TMDB preference entirely, so they rank as
		// eligible and keep their score advantage — reporting them as `unknown`
		// would send the UI offering a refresh that could never change the answer.
		const result = selectAutomaticArtwork(
			[
				candidate(1, { provider: 'mediux' }),
				candidate(2, { provider: 'tmdb', language: 'en', languageProvenance: 'tagged' })
			],
			{ languagePolicy: preferred }
		);

		expect(result.poster?.provider).toBe('mediux');
		expect(result.poster?.languageDecision).toEqual({
			language: null,
			eligibility: 'eligible',
			fallback: false
		});
	});

	it('does not tier a provider that tags languages but is not TMDB', () => {
		// Fanart.tv records tagged provenance, but this setting governs TMDB art.
		// Without the provider check its higher score would lose to a TMDB match.
		const result = selectAutomaticArtwork(
			[
				candidate(1, { provider: 'fanarttv', language: 'de', languageProvenance: 'tagged' }),
				candidate(2, { provider: 'tmdb', language: 'en', languageProvenance: 'tagged' })
			],
			{ languagePolicy: preferred }
		);

		expect(result.poster?.provider).toBe('fanarttv');
		expect(result.poster?.languageDecision?.fallback).toBe(false);
	});

	it('treats an omitted provenance field as unrecorded rather than neutral', () => {
		const result = selectAutomaticArtwork([candidate(1, { language: 'en' })], {
			languagePolicy: preferred
		});

		// The language column alone proves nothing about how it got there, so a row
		// with no provenance reports `unknown` even when the code happens to match.
		expect(result.poster?.languageDecision?.eligibility).toBe('unknown');
	});

	it('resolves each slot independently', () => {
		const result = selectAutomaticArtwork(
			[
				candidate(1, { language: 'fr', languageProvenance: 'tagged' }),
				candidate(2, {
					kind: 'background',
					width: 1920,
					height: 1080,
					language: 'en',
					languageProvenance: 'tagged'
				})
			],
			{ languagePolicy: preferred }
		);

		expect(result.poster?.languageDecision).toMatchObject({
			eligibility: 'foreign',
			fallback: true
		});
		expect(result.background?.languageDecision).toMatchObject({
			eligibility: 'eligible',
			fallback: false
		});
	});

	it('keeps the established ordering inside a tier', () => {
		const weights = {
			providerWeights: { alpha: 1, beta: 1 },
			resolutionWeight: 0,
			aspectWeight: 0
		};
		const result = selectAutomaticArtwork(
			[
				candidate(1, { provider: 'alpha', language: 'en', languageProvenance: 'tagged' }),
				candidate(2, { provider: 'beta', language: 'en', languageProvenance: 'tagged' })
			],
			{ weights, providerPriority: ['beta', 'alpha'], languagePolicy: preferred }
		);

		expect(result.poster?.provider).toBe('beta');
	});

	it('ignores the tiering entirely under an unrestricted policy', () => {
		const candidates = [
			candidate(1, { language: 'de', languageProvenance: 'tagged', width: 2000, height: 3000 }),
			candidate(2, { language: 'en', languageProvenance: 'tagged' })
		];

		expect(selectAutomaticArtwork(candidates, { languagePolicy: { mode: 'all' } })).toEqual(
			selectAutomaticArtwork(candidates)
		);
	});
});
