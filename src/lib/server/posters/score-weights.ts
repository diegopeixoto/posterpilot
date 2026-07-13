/**
 * Persisted poster-scoring weights (internal settings KV).
 *
 * Lives here rather than in `config/index.ts` so it can be imported by `service.ts`
 * without pulling in `$env` — the project keeps modules under test `$env`-free, and
 * `config` imports `$env/dynamic/private`. `config` re-exports these for callers that
 * already depend on it (e.g. the settings route). Only `db` is touched (mocked in tests).
 */
import { eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';
import {
	DEFAULT_PROVIDER_PRIORITY,
	DEFAULT_SCORE_WEIGHTS,
	parseProviderPriority,
	parseScoreWeights,
	scoreWeightsFromConfig,
	type ArtworkProviderId,
	type ScoreWeights
} from './score';

const SCORE_WEIGHTS_KEY = 'scoreWeights';
const PROVIDER_PRIORITY_KEY = 'providerPriority';

export interface ArtworkRankingSettings {
	providerPriority: ArtworkProviderId[];
	weights: ScoreWeights;
	source: {
		providerPriority: 'stored' | 'default';
		weights: 'stored' | 'default';
	};
}

function weightsFromStored(value: string | undefined): ScoreWeights {
	if (!value) return DEFAULT_SCORE_WEIGHTS;
	try {
		const stored = JSON.parse(value) as Partial<ScoreWeights>;
		return scoreWeightsFromConfig({
			scoreProviderMediux: stored.providerWeights?.mediux,
			scoreProviderThePosterDb: stored.providerWeights?.theposterdb,
			scoreProviderFanarttv: stored.providerWeights?.fanarttv,
			scoreProviderTmdb: stored.providerWeights?.tmdb,
			scoreResolution: stored.resolutionWeight,
			scoreAspect: stored.aspectWeight
		});
	} catch {
		return DEFAULT_SCORE_WEIGHTS;
	}
}

/** Resolve ranking inputs plus whether each value came from storage or defaults. */
export async function getArtworkRankingSettings(): Promise<ArtworkRankingSettings> {
	const rows = await db
		.select({ key: settings.key, value: settings.value })
		.from(settings)
		.where(inArray(settings.key, [SCORE_WEIGHTS_KEY, PROVIDER_PRIORITY_KEY]));
	const values = new Map(rows.map((row) => [row.key, row.value]));
	const storedPriority = parseProviderPriority(values.get(PROVIDER_PRIORITY_KEY));
	return {
		providerPriority: storedPriority ?? [...DEFAULT_PROVIDER_PRIORITY],
		weights: weightsFromStored(values.get(SCORE_WEIGHTS_KEY)),
		source: {
			providerPriority: storedPriority ? 'stored' : 'default',
			weights: values.has(SCORE_WEIGHTS_KEY) ? 'stored' : 'default'
		}
	};
}

/**
 * Read the tunable scoring weights. On missing/invalid data falls back to
 * {@link DEFAULT_SCORE_WEIGHTS}; a partially-stored object is merged over the defaults
 * so the result is always a full ScoreWeights (e.g. an old payload missing a
 * newly-added provider still resolves).
 */
export async function getScoreWeights(): Promise<ScoreWeights> {
	const row = (
		await db.select().from(settings).where(eq(settings.key, SCORE_WEIGHTS_KEY)).limit(1)
	)[0];
	if (!row?.value) return DEFAULT_SCORE_WEIGHTS;
	return weightsFromStored(row.value);
}

export async function getProviderPriority(): Promise<ArtworkProviderId[]> {
	const row = (
		await db.select().from(settings).where(eq(settings.key, PROVIDER_PRIORITY_KEY)).limit(1)
	)[0];
	return parseProviderPriority(row?.value) ?? [...DEFAULT_PROVIDER_PRIORITY];
}

/** Atomically persist one complete deterministic ranking definition. */
export async function setArtworkRankingSettings(input: {
	providerPriority: unknown;
	weights: unknown;
}): Promise<ArtworkRankingSettings> {
	const providerPriority = parseProviderPriority(input.providerPriority);
	const weights = parseScoreWeights(input.weights);
	if (!providerPriority || !weights) throw new TypeError('invalid_artwork_ranking');
	await db.transaction(async (tx) => {
		for (const [key, value] of [
			[PROVIDER_PRIORITY_KEY, JSON.stringify(providerPriority)],
			[SCORE_WEIGHTS_KEY, JSON.stringify(weights)]
		] as const) {
			await tx
				.insert(settings)
				.values({ key, value })
				.onConflictDoUpdate({ target: settings.key, set: { value } });
		}
	});
	return {
		providerPriority,
		weights,
		source: { providerPriority: 'stored', weights: 'stored' }
	};
}
