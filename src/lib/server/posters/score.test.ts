import { describe, expect, it } from 'vitest';
import {
	DEFAULT_SCORE_WEIGHTS,
	parseProviderPriority,
	parseScoreWeights,
	scorePoster,
	scoreWeightsFromConfig,
	type ScoreWeights
} from './score';

/** A small, explicit weight set so term contributions are easy to reason about. */
const weights: ScoreWeights = {
	providerWeights: { mediux: 1.0, theposterdb: 0.8, fanarttv: 0.7, tmdb: 0.6 },
	resolutionWeight: 0.5,
	aspectWeight: 0.3
};

describe('scorePoster', () => {
	it('ranks a higher-weight provider above a lower-weight one when other factors match', () => {
		const dims = { width: 1000, height: 1500, kind: 'poster' };
		const mediux = scorePoster({ provider: 'mediux', ...dims }, weights);
		const tmdb = scorePoster({ provider: 'tmdb', ...dims }, weights);
		expect(mediux).toBeGreaterThan(tmdb);
	});

	it('ranks higher resolution above lower resolution for the same provider', () => {
		const big = scorePoster(
			{ provider: 'mediux', width: 2000, height: 3000, kind: 'poster' },
			weights
		);
		const small = scorePoster(
			{ provider: 'mediux', width: 400, height: 600, kind: 'poster' },
			weights
		);
		expect(big).toBeGreaterThan(small);
	});

	it('ranks an ideal 2:3 poster above a badly-shaped one (same provider + resolution)', () => {
		// Both ~600k px, same provider; only the aspect differs.
		const ideal = scorePoster(
			{ provider: 'mediux', width: 632, height: 948, kind: 'poster' },
			weights
		);
		const square = scorePoster(
			{ provider: 'mediux', width: 774, height: 774, kind: 'poster' },
			weights
		);
		expect(ideal).toBeGreaterThan(square);
	});

	it('scores a 16:9 image well as a background but poorly as a poster', () => {
		const wide = { provider: 'mediux', width: 1920, height: 1080 };
		const asBackground = scorePoster({ ...wide, kind: 'background' }, weights);
		const asPoster = scorePoster({ ...wide, kind: 'poster' }, weights);
		expect(asBackground).toBeGreaterThan(asPoster);
	});

	it('scores a title_card against the 16:9 ideal', () => {
		const good = scorePoster(
			{ provider: 'mediux', width: 1920, height: 1080, kind: 'title_card' },
			weights
		);
		const tall = scorePoster(
			{ provider: 'mediux', width: 1080, height: 1920, kind: 'title_card' },
			weights
		);
		expect(good).toBeGreaterThan(tall);
	});

	it('degrades gracefully when dimensions are null (no NaN, only provider term)', () => {
		const score = scorePoster(
			{ provider: 'mediux', width: null, height: null, kind: 'poster' },
			weights
		);
		expect(Number.isNaN(score)).toBe(false);
		expect(score).toBe(weights.providerWeights.mediux);
	});

	it('treats a missing height like null dimensions', () => {
		const score = scorePoster(
			{ provider: 'tmdb', width: 1000, height: null, kind: 'poster' },
			weights
		);
		expect(Number.isNaN(score)).toBe(false);
		expect(score).toBe(weights.providerWeights.tmdb);
	});

	it('gives 0 for an unknown provider but still adds resolution/aspect terms', () => {
		const score = scorePoster(
			{ provider: 'nope', width: 2000, height: 3000, kind: 'poster' },
			weights
		);
		// Provider term 0, full resolution (0.5) + perfect aspect (0.3).
		expect(score).toBeCloseTo(0.8, 10);
	});

	it('DEFAULT_SCORE_WEIGHTS ranks mediux above tmdb', () => {
		const dims = { width: 1000, height: 1500, kind: 'poster' };
		const mediux = scorePoster({ provider: 'mediux', ...dims }, DEFAULT_SCORE_WEIGHTS);
		const tmdb = scorePoster({ provider: 'tmdb', ...dims }, DEFAULT_SCORE_WEIGHTS);
		expect(mediux).toBeGreaterThan(tmdb);
	});

	it('uses DEFAULT_SCORE_WEIGHTS when no weights argument is given', () => {
		const dims = { provider: 'mediux', width: 1000, height: 1500, kind: 'poster' };
		expect(scorePoster(dims)).toBe(scorePoster(dims, DEFAULT_SCORE_WEIGHTS));
	});
});

describe('artwork ranking configuration', () => {
	it('accepts only a complete unique provider order', () => {
		expect(parseProviderPriority('tmdb,mediux,fanarttv,theposterdb')).toEqual([
			'tmdb',
			'mediux',
			'fanarttv',
			'theposterdb'
		]);
		expect(parseProviderPriority(['mediux', 'mediux', 'fanarttv', 'tmdb'])).toBeNull();
		expect(parseProviderPriority(['mediux', 'tmdb'])).toBeNull();
	});

	it('strictly rejects missing, non-numeric, and out-of-range write values', () => {
		expect(parseScoreWeights(weights)).toEqual(weights);
		expect(parseScoreWeights({ ...weights, aspectWeight: 11 })).toBeNull();
		expect(
			parseScoreWeights({ ...weights, providerWeights: { ...weights.providerWeights, tmdb: '1' } })
		).toBeNull();
	});

	it('falls back field-by-field for invalid persisted runtime values', () => {
		const resolved = scoreWeightsFromConfig({
			scoreProviderMediux: 4,
			scoreProviderTmdb: 99,
			scoreResolution: Number.NaN,
			scoreAspect: 2
		});
		expect(resolved.providerWeights.mediux).toBe(4);
		expect(resolved.providerWeights.tmdb).toBe(DEFAULT_SCORE_WEIGHTS.providerWeights.tmdb);
		expect(resolved.resolutionWeight).toBe(DEFAULT_SCORE_WEIGHTS.resolutionWeight);
		expect(resolved.aspectWeight).toBe(2);
	});
});
