/**
 * Persisted poster-scoring weights (internal settings KV).
 *
 * Lives here rather than in `config/index.ts` so it can be imported by `service.ts`
 * without pulling in `$env` — the project keeps modules under test `$env`-free, and
 * `config` imports `$env/dynamic/private`. `config` re-exports these for callers that
 * already depend on it (e.g. the settings route). Only `db` is touched (mocked in tests).
 */
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';
import { DEFAULT_SCORE_WEIGHTS, type ScoreWeights } from './score';

const SCORE_WEIGHTS_KEY = 'scoreWeights';

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
	try {
		const obj = JSON.parse(row.value);
		if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return DEFAULT_SCORE_WEIGHTS;
		const stored = obj as Partial<ScoreWeights>;
		// Keep only finite numeric provider weights — a stray string/NaN would turn
		// scorePoster() into string concatenation and corrupt ranking.
		const providerWeights = { ...DEFAULT_SCORE_WEIGHTS.providerWeights };
		if (stored.providerWeights && typeof stored.providerWeights === 'object') {
			for (const [k, v] of Object.entries(stored.providerWeights)) {
				if (typeof v === 'number' && Number.isFinite(v)) providerWeights[k] = v;
			}
		}
		return {
			providerWeights,
			// Gate scalars on Number.isFinite so a stored NaN/Infinity/string can't
			// propagate into scorePoster() and produce NaN scores that break ranking.
			resolutionWeight: Number.isFinite(stored.resolutionWeight as number)
				? (stored.resolutionWeight as number)
				: DEFAULT_SCORE_WEIGHTS.resolutionWeight,
			aspectWeight: Number.isFinite(stored.aspectWeight as number)
				? (stored.aspectWeight as number)
				: DEFAULT_SCORE_WEIGHTS.aspectWeight
		};
	} catch {
		return DEFAULT_SCORE_WEIGHTS;
	}
}

/** Persist the tunable scoring weights. */
export async function setScoreWeights(weights: ScoreWeights): Promise<void> {
	await db
		.insert(settings)
		.values({ key: SCORE_WEIGHTS_KEY, value: JSON.stringify(weights) })
		.onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(weights) } });
}
