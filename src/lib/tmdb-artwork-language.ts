/**
 * TMDB artwork-language preference as a pure, $env-free module shared by server
 * code (config, discovery, automatic selection) and client components, so the
 * preference vocabulary, the base-code normalization, and the eligibility rule
 * have one source of truth.
 *
 * Deliberately NOT built on `normalizeLocale` from `$lib/i18n/resolve`: that
 * normalizes *toward the supported UI locale set*, so `pt` becomes `pt-BR`.
 * TMDB tags images with ISO 639-1 base codes, so artwork needs the opposite
 * direction — `pt-BR` becomes `pt`.
 */

/** Browse and auto-select across every language TMDB returned. */
export const ARTWORK_LANGUAGE_ANY = 'any';
/** Follow the application's UI language, normalized to its base code. */
export const ARTWORK_LANGUAGE_UI = 'ui';

/**
 * The persisted preference: `any`, `ui`, or an explicit ISO 639-1 base code.
 *
 * Any well-formed two-letter code is accepted rather than only the six UI
 * locales — TMDB tags artwork in far more languages than PosterPilot is
 * translated into, and someone running an English UI may well want German
 * posters. The Settings select offers a curated list; the environment variable
 * accepts the wider set.
 */
export type TmdbArtworkLanguage =
	| typeof ARTWORK_LANGUAGE_ANY
	| typeof ARTWORK_LANGUAGE_UI
	| (string & {});

/** The resolved policy discovery, selection, and the UI all filter against. */
export type ArtworkLanguagePolicy = { mode: 'all' } | { mode: 'preferred'; language: string };

/** How one candidate stands against a policy. */
export type ArtworkLanguageEligibility = 'eligible' | 'foreign' | 'unknown';

/**
 * The provider this preference governs. Kept as a literal rather than imported
 * from the server provider registry so this module stays `$env`-free.
 */
const TMDB_PROVIDER = 'tmdb';

/** The provenance recorded per candidate at discovery time, plus its provider. */
type CandidateLanguageFields = {
	provider: string;
	language: string | null;
	languageProvenance: 'tagged' | 'untagged' | 'unknown';
};

/**
 * Normalize an arbitrary language tag to an ISO 639-1 base code, or `null`.
 *
 * `pt-BR` → `pt`, `EN` → `en`, `zh-Hans` → `zh`. Returns `null` for anything
 * that is not a well-formed two-letter primary subtag, so callers never build a
 * filter out of junk.
 */
export function artworkLanguageCode(tag: string | null | undefined): string | null {
	if (!tag) return null;
	const base = tag.trim().toLowerCase().split('-')[0];
	return /^[a-z]{2}$/.test(base) ? base : null;
}

/**
 * Parse a stored or environment-supplied preference, or `undefined` for
 * absent/invalid values so callers can distinguish "unset" from an explicit
 * choice and apply their own fallback.
 *
 * An invalid value must never become a filter: returning `undefined` lets the
 * caller fall back to `any` and preserve prior browsing behavior.
 */
export function parseTmdbArtworkLanguage(
	value: string | null | undefined
): TmdbArtworkLanguage | undefined {
	const v = value?.trim().toLowerCase();
	if (!v) return undefined;
	if (v === ARTWORK_LANGUAGE_ANY || v === ARTWORK_LANGUAGE_UI) return v;
	return artworkLanguageCode(v) ?? undefined;
}

/**
 * Resolve the effective policy from the preference and the active UI locale.
 *
 * `ui` with an unresolvable locale degrades to `all` rather than inventing a
 * language — an unattended job with no persisted UI language must not silently
 * restrict artwork.
 */
export function resolveArtworkLanguagePolicy(
	preference: TmdbArtworkLanguage | undefined,
	uiLocale: string | null | undefined
): ArtworkLanguagePolicy {
	if (!preference || preference === ARTWORK_LANGUAGE_ANY) return { mode: 'all' };
	if (preference === ARTWORK_LANGUAGE_UI) {
		const language = artworkLanguageCode(uiLocale);
		return language ? { mode: 'preferred', language } : { mode: 'all' };
	}
	const language = artworkLanguageCode(preference);
	return language ? { mode: 'preferred', language } : { mode: 'all' };
}

/**
 * Classify one candidate against a policy.
 *
 * This is a *TMDB* artwork-language preference, so every other provider is
 * always eligible. That is not a shortcut — it is the whole rule:
 *
 * - MediUX and ThePosterDB record `unknown` for every candidate they will ever
 *   produce, so treating `unknown` as ineligible would erase their grids
 *   entirely the moment any preference was set, and refreshed discovery could
 *   never bring them back because it records `unknown` again.
 * - Fanart.tv *does* tag languages, so it would be filtered on a signal this
 *   setting was never meant to govern, silently losing a higher-ranked asset.
 *
 * Within TMDB: explicitly untagged artwork counts as language-neutral and stays
 * eligible, while `unknown` is genuinely legacy — rows stored before provenance
 * was recorded. Those are reported as `unknown` so the caller can offer
 * refreshed discovery, which now does record provenance, rather than silently
 * including or excluding them.
 */
export function classifyCandidateLanguage(
	candidate: CandidateLanguageFields,
	policy: ArtworkLanguagePolicy
): ArtworkLanguageEligibility {
	if (policy.mode === 'all') return 'eligible';
	if (candidate.provider !== TMDB_PROVIDER) return 'eligible';
	if (candidate.languageProvenance === 'untagged') return 'eligible';
	if (candidate.languageProvenance === 'unknown') return 'unknown';
	return artworkLanguageCode(candidate.language) === policy.language ? 'eligible' : 'foreign';
}

/** True when the candidate may be shown/selected under `policy`. */
export function isArtworkLanguageEligible(
	candidate: CandidateLanguageFields,
	policy: ArtworkLanguagePolicy
): boolean {
	return classifyCandidateLanguage(candidate, policy) === 'eligible';
}
