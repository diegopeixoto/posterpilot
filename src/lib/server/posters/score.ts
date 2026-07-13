/**
 * Pure poster-scoring model. Ranks artwork candidates so the UI can pre-select the
 * best one as a suggestion. Kept free of `$env`, DB and config imports so it is fully
 * deterministic and unit-testable in isolation.
 */

/** Tunable weights for the three scoring terms. */
export interface ScoreWeights {
	/** Per-provider base score, keyed by provider id (mediux, theposterdb, fanarttv, tmdb). */
	providerWeights: Record<string, number>;
	/** Multiplier applied to the normalized 0..1 resolution score. */
	resolutionWeight: number;
	/** Multiplier applied to the normalized 0..1 aspect-fit score. */
	aspectWeight: number;
}

const ARTWORK_PROVIDER_IDS = ['mediux', 'theposterdb', 'fanarttv', 'tmdb'] as const;
export type ArtworkProviderId = (typeof ARTWORK_PROVIDER_IDS)[number];

/** Deterministic tie-break order used when no valid override exists. */
export const DEFAULT_PROVIDER_PRIORITY: ArtworkProviderId[] = [...ARTWORK_PROVIDER_IDS];

/** Settings/config fields kept flat so every scalar can have its own env override. */
export interface ScoreWeightConfigFields {
	scoreProviderMediux: number;
	scoreProviderThePosterDb: number;
	scoreProviderFanarttv: number;
	scoreProviderTmdb: number;
	scoreResolution: number;
	scoreAspect: number;
}

const SCORE_WEIGHT_MIN = 0;
const SCORE_WEIGHT_MAX = 10;

/**
 * Default weights, tuned for PosterPilot's provider preference order.
 *
 * Provider weights follow the project's quality ranking: MediUX sets are
 * hand-curated and image-forward, so they win ties; ThePosterDB is community
 * curated and usually strong; Fanart.tv is solid but more variable; TMDB is the
 * broad fallback. The four values stay within a 0.6..1.0 band so that a large
 * resolution or aspect advantage can still let a lower-ranked provider overtake a
 * higher-ranked one — provider is a tie-breaker, not an override.
 *
 * Resolution outranks aspect (0.5 vs 0.3): an off-ideal but sharp image is usually
 * preferable to a perfectly-shaped but tiny one. Both stay below the top provider
 * weight so provider remains the dominant signal when everything else is equal.
 */
export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
	providerWeights: {
		mediux: 1.0,
		theposterdb: 0.8,
		fanarttv: 0.7,
		tmdb: 0.6
	},
	resolutionWeight: 0.5,
	aspectWeight: 0.3
};

const DEFAULT_SCORE_CONFIG_FIELDS: ScoreWeightConfigFields = {
	scoreProviderMediux: DEFAULT_SCORE_WEIGHTS.providerWeights.mediux,
	scoreProviderThePosterDb: DEFAULT_SCORE_WEIGHTS.providerWeights.theposterdb,
	scoreProviderFanarttv: DEFAULT_SCORE_WEIGHTS.providerWeights.fanarttv,
	scoreProviderTmdb: DEFAULT_SCORE_WEIGHTS.providerWeights.tmdb,
	scoreResolution: DEFAULT_SCORE_WEIGHTS.resolutionWeight,
	scoreAspect: DEFAULT_SCORE_WEIGHTS.aspectWeight
};

function finiteOrDefault(value: unknown, fallback: number): number {
	return typeof value === 'number' &&
		Number.isFinite(value) &&
		value >= SCORE_WEIGHT_MIN &&
		value <= SCORE_WEIGHT_MAX
		? value
		: fallback;
}

/** Convert effective flat runtime config into the scorer's neutral shape. */
export function scoreWeightsFromConfig(config: Partial<ScoreWeightConfigFields>): ScoreWeights {
	return {
		providerWeights: {
			mediux: finiteOrDefault(
				config.scoreProviderMediux,
				DEFAULT_SCORE_CONFIG_FIELDS.scoreProviderMediux
			),
			theposterdb: finiteOrDefault(
				config.scoreProviderThePosterDb,
				DEFAULT_SCORE_CONFIG_FIELDS.scoreProviderThePosterDb
			),
			fanarttv: finiteOrDefault(
				config.scoreProviderFanarttv,
				DEFAULT_SCORE_CONFIG_FIELDS.scoreProviderFanarttv
			),
			tmdb: finiteOrDefault(config.scoreProviderTmdb, DEFAULT_SCORE_CONFIG_FIELDS.scoreProviderTmdb)
		},
		resolutionWeight: finiteOrDefault(
			config.scoreResolution,
			DEFAULT_SCORE_CONFIG_FIELDS.scoreResolution
		),
		aspectWeight: finiteOrDefault(config.scoreAspect, DEFAULT_SCORE_CONFIG_FIELDS.scoreAspect)
	};
}

/** Strict parser for Settings/API writes; unlike runtime fallback, rejects any bad field. */
export function parseScoreWeights(value: unknown): ScoreWeights | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const input = value as Record<string, unknown>;
	if (!input.providerWeights || typeof input.providerWeights !== 'object') return null;
	const providerWeights = input.providerWeights as Record<string, unknown>;
	const valid = (entry: unknown): entry is number =>
		typeof entry === 'number' &&
		Number.isFinite(entry) &&
		entry >= SCORE_WEIGHT_MIN &&
		entry <= SCORE_WEIGHT_MAX;
	if (
		!ARTWORK_PROVIDER_IDS.every((provider) => valid(providerWeights[provider])) ||
		!valid(input.resolutionWeight) ||
		!valid(input.aspectWeight)
	) {
		return null;
	}
	return {
		providerWeights: Object.fromEntries(
			ARTWORK_PROVIDER_IDS.map((provider) => [provider, providerWeights[provider] as number])
		),
		resolutionWeight: input.resolutionWeight,
		aspectWeight: input.aspectWeight
	};
}

/** Parse JSON-array or comma-separated provider priority, requiring exact parity. */
export function parseProviderPriority(value: unknown): ArtworkProviderId[] | null {
	let entries: unknown = value;
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (!trimmed) return null;
		if (trimmed.startsWith('[')) {
			try {
				entries = JSON.parse(trimmed);
			} catch {
				return null;
			}
		} else {
			entries = trimmed.split(',').map((entry) => entry.trim());
		}
	}
	if (!Array.isArray(entries) || entries.length !== ARTWORK_PROVIDER_IDS.length) return null;
	if (
		entries.some(
			(entry) =>
				typeof entry !== 'string' || !(ARTWORK_PROVIDER_IDS as readonly string[]).includes(entry)
		)
	) {
		return null;
	}
	const priority = entries as ArtworkProviderId[];
	return new Set(priority).size === ARTWORK_PROVIDER_IDS.length ? [...priority] : null;
}

/**
 * Pixel area (width x height) at which the resolution term saturates to 1. Chosen as
 * a high-res 2000x3000 poster — anything at or above this is treated as "full marks".
 */
const RESOLUTION_SATURATION_AREA = 2000 * 3000;

/** Ideal aspect ratio (width / height) per candidate kind. */
const IDEAL_ASPECT: Record<string, number> = {
	// Portrait posters: standard 2:3 movie-poster shape.
	poster: 2 / 3,
	season: 2 / 3,
	// Landscape art: 16:9 to match backdrops and episode stills.
	background: 16 / 9,
	title_card: 16 / 9
};

/** Clamp a number into the inclusive [0, 1] range. */
function clamp01(n: number): number {
	if (n < 0) return 0;
	if (n > 1) return 1;
	return n;
}

/**
 * Score a single artwork candidate. Higher is better. Pure and deterministic.
 *
 * The total is the sum of three independent terms:
 *
 * - **Provider term:** `weights.providerWeights[provider] ?? 0`. Unknown providers
 *   contribute nothing.
 * - **Resolution term:** a normalized 0..1 score that rises with pixel area and
 *   saturates at {@link RESOLUTION_SATURATION_AREA}, multiplied by `resolutionWeight`.
 *   Contributes 0 when dimensions are unknown.
 * - **Aspect term:** how close the candidate's aspect ratio is to the ideal for its
 *   kind, expressed as `1 - clampedRelativeError`, multiplied by `aspectWeight`.
 *   Contributes 0 when dimensions are unknown or the kind has no defined ideal.
 *
 * Missing/invalid dimensions (null, zero or negative) degrade gracefully: the
 * resolution and aspect terms become 0 and only the provider term applies. The result
 * is always a finite number (never NaN).
 */
export function scorePoster(
	candidate: { provider: string; width: number | null; height: number | null; kind: string },
	weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS
): number {
	const providerTerm = weights.providerWeights[candidate.provider] ?? 0;

	const { width, height, kind } = candidate;
	const hasDims = width != null && height != null && width > 0 && height > 0;

	let resolutionTerm = 0;
	let aspectTerm = 0;

	if (hasDims) {
		// Resolution: normalized pixel area, capped at the saturation point.
		const area = width * height;
		resolutionTerm = clamp01(area / RESOLUTION_SATURATION_AREA) * weights.resolutionWeight;

		// Aspect: closeness of width/height to the ideal for this kind.
		const ideal = IDEAL_ASPECT[kind];
		if (ideal != null) {
			const aspect = width / height;
			const relativeError = Math.abs(aspect - ideal) / ideal;
			aspectTerm = (1 - clamp01(relativeError)) * weights.aspectWeight;
		}
	}

	return providerTerm + resolutionTerm + aspectTerm;
}
