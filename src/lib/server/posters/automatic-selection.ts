import {
	classifyCandidateLanguage,
	type ArtworkLanguageEligibility,
	type ArtworkLanguagePolicy
} from '$lib/tmdb-artwork-language';
import { DEFAULT_SCORE_WEIGHTS, scorePoster, type ScoreWeights } from './score';

export type AutomaticSlotKind = 'poster' | 'background' | 'title_card';

export interface AutomaticCandidateInput {
	id: number;
	provider: string;
	setId: string;
	setAuthor: string | null;
	url: string;
	kind: 'poster' | 'background' | 'season' | 'title_card';
	season: number | null;
	episode: number | null;
	width: number | null;
	height: number | null;
	/** ISO 639-1 base code recorded at discovery, or null when none was reported. */
	language?: string | null;
	/**
	 * How that language was obtained. Optional, defaulting to `unknown`, so the
	 * shape mirrors `poster_candidates.language_provenance` — a NOT NULL column
	 * whose own default is `unknown`, because every row written before provenance
	 * was recorded is exactly that: unknown, not neutral.
	 */
	languageProvenance?: 'tagged' | 'untagged' | 'unknown';
}

export interface AutomaticSelectionInputs {
	weights?: ScoreWeights;
	/** Earlier providers win a deterministic tie after the numeric score. */
	providerPriority?: readonly string[];
	/**
	 * Artwork-language preference, already resolved by the caller. Omitting it means
	 * `{ mode: 'all' }`, under which no tiering runs at all and the ranking is
	 * identical to the one produced before the preference existed.
	 */
	languagePolicy?: ArtworkLanguagePolicy;
}

/**
 * Why a winning candidate survived the artwork-language policy.
 *
 * Present only when a preference was actually in force, so its absence is a
 * meaningful "no language preference applied" rather than missing data. It rides
 * on the selection itself instead of a parallel per-slot map because every caller
 * already flattens `poster`/`background`/`children` into one list — a sibling map
 * would force each of them to rebuild slot keys just to rejoin the two halves.
 */
export interface AutomaticLanguageDecision {
	/** The candidate's own base code, so the UI can name the language it settled for. */
	language: string | null;
	eligibility: ArtworkLanguageEligibility;
	/**
	 * The preferred tier for this slot was empty and a foreign-language candidate
	 * won anyway. Surfacing this is what lets the UI label the pick rather than
	 * look like it ignored the preference.
	 */
	fallback: boolean;
}

export interface AutomaticCandidateSelection {
	candidateId: number;
	url: string;
	provider: string;
	setId: string;
	setAuthor: string | null;
	score: number;
	width: number | null;
	height: number | null;
	slot: {
		kind: AutomaticSlotKind;
		season: number | null;
		episode: number | null;
	};
	languageDecision?: AutomaticLanguageDecision;
}

export interface AutomaticArtworkSelection {
	poster: AutomaticCandidateSelection | null;
	background: AutomaticCandidateSelection | null;
	children: AutomaticCandidateSelection[];
}

function normalizeSlot(
	candidate: AutomaticCandidateInput
): AutomaticCandidateSelection['slot'] | null {
	if (candidate.kind === 'title_card') {
		if (candidate.season === null || candidate.episode === null) return null;
		return { kind: 'title_card', season: candidate.season, episode: candidate.episode };
	}

	if (candidate.kind === 'season') {
		if (candidate.season === null) return null;
		return { kind: 'poster', season: candidate.season, episode: null };
	}

	if (candidate.kind === 'background') {
		return { kind: 'background', season: candidate.season, episode: null };
	}

	if (candidate.episode !== null) return null;
	return { kind: 'poster', season: candidate.season, episode: null };
}

function slotKey(slot: AutomaticCandidateSelection['slot']): string {
	return `${slot.kind}:${slot.season ?? 'root'}:${slot.episode ?? 'root'}`;
}

function compareSlot(
	a: AutomaticCandidateSelection['slot'],
	b: AutomaticCandidateSelection['slot']
): number {
	const season = (a.season ?? -1) - (b.season ?? -1);
	if (season !== 0) return season;
	const episode = (a.episode ?? -1) - (b.episode ?? -1);
	if (episode !== 0) return episode;
	return a.kind.localeCompare(b.kind);
}

/** A ranked candidate plus the language facts that only the ranking needs. */
interface RankedCandidate extends AutomaticCandidateSelection {
	language: string | null;
	eligibility: ArtworkLanguageEligibility;
}

/**
 * Rank order of a candidate's language standing: 0 for anything that is not
 * provably foreign, 1 for a proven mismatch.
 *
 * Only artwork a provider explicitly tagged with a *different* language is demoted.
 * Three groups deliberately share the leading tier:
 *
 * - a matching tag — the preference is satisfied outright;
 * - explicitly untagged artwork — textless art is language-neutral by definition;
 * - artwork whose provenance was never recorded (`unknown`).
 *
 * That last group is the load-bearing one. MediUX and ThePosterDB report no
 * language at all, so *every* candidate they produce is permanently `unknown`, as
 * is every TMDB row stored before provenance existed. Ranking `unknown` below
 * `eligible` would mean that setting any preference silently replaces hand-curated
 * MediUX sets with whatever TMDB happens to tag in that language — the preference
 * is about which of TMDB's language-tagged images to take, not a licence to
 * re-order the providers on a signal three of them never supply. So `unknown`
 * means "not provably foreign" here, and it is still reported on the winner so the
 * UI can offer refreshed discovery instead of implying the language was verified.
 */
function languageTier(eligibility: ArtworkLanguageEligibility): number {
	return eligibility === 'foreign' ? 1 : 0;
}

/**
 * Select one candidate for every artwork slot from frozen discovery inputs.
 *
 * Language tier is consulted first, then numeric score as the primary signal. Ties
 * are stable across database insertion order: configured provider priority,
 * provider id, set id, URL, then candidate id. The returned provenance is complete
 * enough for an operation plan to explain and later reproduce exactly why each
 * asset was chosen.
 */
export function selectAutomaticArtwork(
	candidates: readonly AutomaticCandidateInput[],
	inputs: AutomaticSelectionInputs = {}
): AutomaticArtworkSelection {
	const weights = inputs.weights ?? DEFAULT_SCORE_WEIGHTS;
	const policy: ArtworkLanguagePolicy = inputs.languagePolicy ?? { mode: 'all' };
	const priority = new Map(inputs.providerPriority?.map((provider, index) => [provider, index]));
	const ranked: RankedCandidate[] = [];

	for (const candidate of candidates) {
		const slot = normalizeSlot(candidate);
		if (!slot) continue;
		const language = candidate.language ?? null;
		ranked.push({
			candidateId: candidate.id,
			url: candidate.url,
			provider: candidate.provider,
			setId: candidate.setId,
			setAuthor: candidate.setAuthor,
			score: scorePoster(candidate, weights),
			width: candidate.width,
			height: candidate.height,
			slot,
			language,
			eligibility: classifyCandidateLanguage(
				{ language, languageProvenance: candidate.languageProvenance ?? 'unknown' },
				policy
			)
		});
	}

	ranked.sort((a, b) => {
		// Tiering runs ahead of the existing comparator rather than replacing it, so a
		// foreign-language candidate can only reach a slot the preferred tier left
		// empty. Under `{ mode: 'all' }` every tier is 0 and everything below this line
		// decides the order exactly as it did before the preference existed.
		const tier = languageTier(a.eligibility) - languageTier(b.eligibility);
		if (tier !== 0) return tier;
		const score = b.score - a.score;
		if (score !== 0) return score;
		const providerRank =
			(priority.get(a.provider) ?? Number.MAX_SAFE_INTEGER) -
			(priority.get(b.provider) ?? Number.MAX_SAFE_INTEGER);
		if (providerRank !== 0) return providerRank;
		return (
			a.provider.localeCompare(b.provider) ||
			a.setId.localeCompare(b.setId) ||
			a.url.localeCompare(b.url) ||
			a.candidateId - b.candidateId
		);
	});

	const winners = new Map<string, RankedCandidate>();
	for (const candidate of ranked) {
		const key = slotKey(candidate.slot);
		if (!winners.has(key)) winners.set(key, candidate);
	}

	/**
	 * Strip the ranking-only fields and, when a preference was in force, report how
	 * this slot was resolved.
	 *
	 * `fallback` needs no extra bookkeeping: the tier is the first term of the sort,
	 * so a foreign winner proves its slot held nothing better — any non-foreign
	 * candidate for the same slot would have been taken first.
	 */
	const decide = (winner: RankedCandidate): AutomaticCandidateSelection => {
		const { language, eligibility, ...selection } = winner;
		if (policy.mode === 'all') return selection;
		return {
			...selection,
			languageDecision: { language, eligibility, fallback: eligibility === 'foreign' }
		};
	};

	const poster = winners.get('poster:root:root');
	const background = winners.get('background:root:root');
	const children = [...winners.values()]
		.filter((candidate) => candidate.slot.season !== null)
		.sort((a, b) => compareSlot(a.slot, b.slot));

	return {
		poster: poster ? decide(poster) : null,
		background: background ? decide(background) : null,
		children: children.map(decide)
	};
}
