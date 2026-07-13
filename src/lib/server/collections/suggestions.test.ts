import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORE_WEIGHTS } from '$lib/server/posters/score';
import { buildCollectionSuggestions, type CollectionSuggestionCandidateInput } from './suggestions';

function candidate(
	id: number,
	mediaItemId: number,
	kind: 'poster' | 'background',
	overrides: Partial<CollectionSuggestionCandidateInput> = {}
): CollectionSuggestionCandidateInput {
	return {
		id,
		mediaItemId,
		provider: 'mediux',
		setId: `set-${mediaItemId}`,
		setAuthor: 'curator',
		designFamily: null,
		language: 'en',
		url: `https://api.mediux.pro/assets/${id}`,
		kind,
		season: null,
		episode: null,
		width: kind === 'poster' ? 2000 : 3840,
		height: kind === 'poster' ? 3000 : 2160,
		stale: false,
		...overrides
	};
}

describe('collection family suggestions', () => {
	it('reports exact member and slot coverage with uncovered members', () => {
		const suggestions = buildCollectionSuggestions({
			memberIds: [1, 2, 3],
			candidates: [
				candidate(11, 1, 'poster', { designFamily: 'minimal' }),
				candidate(12, 1, 'background', { designFamily: 'minimal' }),
				candidate(21, 2, 'poster', { designFamily: 'minimal' }),
				candidate(22, 2, 'background', { designFamily: 'minimal' }),
				candidate(31, 3, 'poster', { designFamily: 'minimal' })
			],
			weights: DEFAULT_SCORE_WEIGHTS,
			providerPriority: ['mediux', 'theposterdb', 'fanarttv', 'tmdb']
		});

		expect(suggestions).toHaveLength(1);
		expect(suggestions[0]).toMatchObject({
			evidence: 'design_family',
			designFamily: 'minimal',
			coveredMemberIds: [1, 2, 3],
			uncoveredMemberIds: [],
			posterCoveredMemberIds: [1, 2, 3],
			posterUncoveredMemberIds: [],
			backgroundCoveredMemberIds: [1, 2],
			backgroundUncoveredMemberIds: [3],
			coveredSlots: 5,
			coveragePercentage: 100
		});
	});

	it('splits language and curator evidence instead of merging it', () => {
		const suggestions = buildCollectionSuggestions({
			memberIds: [1, 2, 3],
			candidates: [
				candidate(11, 1, 'poster'),
				candidate(21, 2, 'poster'),
				candidate(31, 3, 'poster', { language: 'fr' }),
				candidate(32, 3, 'background', { setAuthor: 'another-curator' })
			],
			weights: DEFAULT_SCORE_WEIGHTS,
			providerPriority: ['mediux', 'theposterdb', 'fanarttv', 'tmdb']
		});

		expect(suggestions).toHaveLength(1);
		expect(suggestions[0]).toMatchObject({
			evidence: 'author',
			coveredMemberIds: [1, 2]
		});
	});

	it('retains exact-set evidence when author metadata is also present', () => {
		const suggestions = buildCollectionSuggestions({
			memberIds: [1, 2],
			candidates: [
				candidate(11, 1, 'poster', { setId: 'franchise-set' }),
				candidate(21, 2, 'poster', { setId: 'franchise-set' })
			],
			weights: DEFAULT_SCORE_WEIGHTS,
			providerPriority: ['mediux', 'theposterdb', 'fanarttv', 'tmdb']
		});

		expect(suggestions).toHaveLength(1);
		expect(suggestions[0]).toMatchObject({
			evidence: 'exact_set',
			setId: 'franchise-set',
			setAuthor: 'curator',
			coveredMemberIds: [1, 2]
		});
	});

	it('keeps identical family labels isolated by provider', () => {
		const suggestions = buildCollectionSuggestions({
			memberIds: [1, 2],
			candidates: [
				candidate(11, 1, 'poster', { designFamily: 'minimal' }),
				candidate(21, 2, 'poster', {
					provider: 'theposterdb',
					designFamily: 'minimal'
				})
			],
			weights: DEFAULT_SCORE_WEIGHTS,
			providerPriority: ['mediux', 'theposterdb', 'fanarttv', 'tmdb']
		});

		expect(suggestions).toEqual([]);
	});

	it('ranks broader member coverage ahead of a higher-scoring partial family', () => {
		const suggestions = buildCollectionSuggestions({
			memberIds: [1, 2, 3],
			candidates: [
				candidate(11, 1, 'poster', {
					setAuthor: 'full-coverage',
					width: 300,
					height: 450
				}),
				candidate(21, 2, 'poster', {
					setAuthor: 'full-coverage',
					width: 300,
					height: 450
				}),
				candidate(31, 3, 'poster', {
					setAuthor: 'full-coverage',
					width: 300,
					height: 450
				}),
				candidate(12, 1, 'poster', { setAuthor: 'partial' }),
				candidate(22, 2, 'poster', { setAuthor: 'partial' })
			],
			weights: DEFAULT_SCORE_WEIGHTS,
			providerPriority: ['mediux', 'theposterdb', 'fanarttv', 'tmdb']
		});

		expect(suggestions.map((suggestion) => suggestion.setAuthor)).toEqual([
			'full-coverage',
			'partial'
		]);
		expect(suggestions[0].coveredMemberIds).toEqual([1, 2, 3]);
		expect(suggestions[0].averageScore).toBeLessThan(suggestions[1].averageScore);
	});

	it('does not fabricate a family from generic provider set ids', () => {
		const suggestions = buildCollectionSuggestions({
			memberIds: [1, 2],
			candidates: [
				candidate(11, 1, 'poster', {
					provider: 'tmdb',
					setId: 'tmdb',
					setAuthor: null,
					language: null,
					designFamily: null
				}),
				candidate(21, 2, 'poster', {
					provider: 'tmdb',
					setId: 'tmdb',
					setAuthor: null,
					language: null,
					designFamily: null
				})
			],
			weights: DEFAULT_SCORE_WEIGHTS,
			providerPriority: ['mediux', 'theposterdb', 'fanarttv', 'tmdb']
		});

		expect(suggestions).toEqual([]);
	});

	it('uses configured scoring to select one deterministic candidate per member slot', () => {
		const suggestions = buildCollectionSuggestions({
			memberIds: [1, 2],
			candidates: [
				candidate(10, 1, 'poster', { width: 400, height: 600 }),
				candidate(11, 1, 'poster', { width: 2000, height: 3000 }),
				candidate(20, 2, 'poster')
			],
			weights: DEFAULT_SCORE_WEIGHTS,
			providerPriority: ['mediux', 'theposterdb', 'fanarttv', 'tmdb']
		});

		expect(suggestions[0].selections.map((selection) => selection.candidateId)).toEqual([11, 20]);
	});
});
