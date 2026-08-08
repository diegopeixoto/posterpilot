/**
 * Pure view-state for the item page's candidate grids: how much of a grid is
 * revealed, and which candidates the artwork-language preference lets it show.
 *
 * The item view renders every grid inline and the repo carries no DOM testing
 * library, so the arithmetic lives here and the component only wires it up.
 *
 * The progressive-disclosure arithmetic is reused from the Kometa migration
 * panel rather than re-derived: both surfaces reveal fixed batches over counts
 * they do not control and must clamp identically.
 */
import {
	disclosureState,
	nextDisclosureLimit,
	type DisclosureState
} from '$lib/components/kometa-migration-view-state';
import {
	ARTWORK_LANGUAGE_ANY,
	ARTWORK_LANGUAGE_UI,
	artworkLanguageCode,
	classifyCandidateLanguage,
	isArtworkLanguageEligible,
	type ArtworkLanguagePolicy,
	type TmdbArtworkLanguage
} from '$lib/tmdb-artwork-language';

export { disclosureState, nextDisclosureLimit };
export type { DisclosureState };

/**
 * Tiles revealed per grid, per reveal.
 *
 * Divides evenly into every candidate grid the item page renders — two columns
 * for backdrops, four for title cards, eight for season posters at `sm` — so a
 * reveal never leaves a ragged half-row. The design proposed 20, which divides
 * into none of them.
 *
 * Independent of the ingestion guard: this is a render cost, not a payload one.
 * The whole retained inventory ships in the item payload either way, measured at
 * ~735 B per candidate (≈289 KB at `TMDB_MAX_CANDIDATES_PER_KIND` across both
 * kinds), so raising this reveals more tiles without fetching anything.
 */
export const CANDIDATE_DISCLOSURE_BATCH_SIZE = 24;

/**
 * Stable identity for one candidate grid — provider × set × artwork kind (×
 * season) — so revealing more posters never reveals backdrops and two sets from
 * the same provider disclose independently. Doubles as the grid's DOM id for
 * `aria-controls`, hence the conservative character set.
 */
export function candidateDisclosureKey(
	provider: string,
	setId: string,
	kind: 'poster' | 'background' | 'season' | 'title_card',
	season: number | null = null
): string {
	const parts = [provider, setId, kind, season === null ? 'all' : String(season)];
	return `artwork-pane-${parts.map((part) => part.replace(/[^A-Za-z0-9_-]+/g, '_')).join('-')}`;
}

/**
 * The provenance a candidate carries (a `PosterCandidate` satisfies it). The
 * provider is part of it because the preference governs TMDB alone — see
 * `classifyCandidateLanguage`.
 */
export interface LanguageTaggedArtwork {
	provider: string;
	language: string | null;
	languageProvenance: 'tagged' | 'untagged' | 'unknown';
}

/**
 * Native names for the languages Settings offers, mirroring `LOCALE_NAMES` in
 * i18n/resolve: a language names itself, so the list reads identically whatever
 * the UI language is and needs no message catalog entries.
 */
export const ARTWORK_LANGUAGE_NAMES: Record<string, string> = {
	de: 'Deutsch',
	en: 'English',
	es: 'Español',
	fr: 'Français',
	it: 'Italiano',
	ja: '日本語',
	ko: '한국어',
	pt: 'Português',
	ru: 'Русский',
	zh: '中文'
};

/** The curated ISO 639-1 codes the Settings select offers, in stable order. */
export const ARTWORK_LANGUAGE_CHOICES: string[] = Object.keys(ARTWORK_LANGUAGE_NAMES).sort();

/** Name an artwork language for display; an uncurated code falls back to itself. */
export function artworkLanguageName(code: string | null | undefined): string {
	const base = artworkLanguageCode(code);
	if (!base) return '';
	return ARTWORK_LANGUAGE_NAMES[base] ?? base.toUpperCase();
}

/**
 * Option values for the Settings select.
 *
 * `TMDB_ARTWORK_LANGUAGE` accepts any well-formed base code, so a preference
 * outside the curated list is appended rather than dropped — otherwise the
 * select would render blank and the next save would silently rewrite it.
 */
export function artworkLanguageChoices(current: TmdbArtworkLanguage | undefined): string[] {
	const explicit =
		current === ARTWORK_LANGUAGE_ANY || current === ARTWORK_LANGUAGE_UI ? null : current;
	const base = artworkLanguageCode(explicit);
	return base && !ARTWORK_LANGUAGE_CHOICES.includes(base)
		? [...ARTWORK_LANGUAGE_CHOICES, base].sort()
		: ARTWORK_LANGUAGE_CHOICES;
}

/**
 * The candidates one grid may render: everything eligible under `policy`, plus
 * whatever `isPinned` keeps. Pinning is how an automatic language fallback stays
 * on screen — a selection the user has to be able to see and revoke must never
 * be filtered away by the preference that produced it.
 */
export function visibleArtworkCandidates<T extends LanguageTaggedArtwork>(
	candidates: readonly T[],
	policy: ArtworkLanguagePolicy,
	isPinned: (candidate: T) => boolean = () => false
): T[] {
	if (policy.mode === 'all') return [...candidates];
	return candidates.filter(
		(candidate) => isArtworkLanguageEligible(candidate, policy) || isPinned(candidate)
	);
}

/** True when a rendered candidate survives the policy only because it is pinned. */
export function isLanguageFallbackCandidate(
	candidate: LanguageTaggedArtwork,
	policy: ArtworkLanguagePolicy
): boolean {
	return classifyCandidateLanguage(candidate, policy) !== 'eligible';
}

/** What one inventory (an item, or a single provider's share of it) looks like under a policy. */
export interface CandidateLanguageSummary {
	eligible: number;
	foreign: number;
	unknown: number;
	/** The policy restricts artwork at all (i.e. it is not `all`). */
	restricted: boolean;
	/** Restricted, nothing matches the preference, yet artwork exists — the view owes an escape hatch. */
	emptyForPreference: boolean;
	/** Restricted over rows stored before provenance existed — prompt refreshed discovery. */
	needsRefresh: boolean;
}

/** Count how an inventory splits under `policy`, for the counts and prompts the view shows. */
export function summarizeCandidateLanguages(
	candidates: readonly LanguageTaggedArtwork[],
	policy: ArtworkLanguagePolicy
): CandidateLanguageSummary {
	let eligible = 0;
	let foreign = 0;
	let unknown = 0;
	for (const candidate of candidates) {
		const eligibility = classifyCandidateLanguage(candidate, policy);
		if (eligibility === 'eligible') eligible += 1;
		else if (eligibility === 'foreign') foreign += 1;
		else unknown += 1;
	}
	const restricted = policy.mode === 'preferred';
	return {
		eligible,
		foreign,
		unknown,
		restricted,
		emptyForPreference: restricted && eligible === 0 && foreign + unknown > 0,
		needsRefresh: restricted && unknown > 0
	};
}
