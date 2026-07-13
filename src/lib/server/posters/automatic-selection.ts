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
}

export interface AutomaticSelectionInputs {
	weights?: ScoreWeights;
	/** Earlier providers win a deterministic tie after the numeric score. */
	providerPriority?: readonly string[];
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

/**
 * Select one candidate for every artwork slot from frozen discovery inputs.
 *
 * Numeric score is the primary signal. Ties are stable across database insertion
 * order: configured provider priority, provider id, set id, URL, then candidate id.
 * The returned provenance is complete enough for an operation plan to explain and
 * later reproduce exactly why each asset was chosen.
 */
export function selectAutomaticArtwork(
	candidates: readonly AutomaticCandidateInput[],
	inputs: AutomaticSelectionInputs = {}
): AutomaticArtworkSelection {
	const weights = inputs.weights ?? DEFAULT_SCORE_WEIGHTS;
	const priority = new Map(inputs.providerPriority?.map((provider, index) => [provider, index]));
	const ranked: AutomaticCandidateSelection[] = [];

	for (const candidate of candidates) {
		const slot = normalizeSlot(candidate);
		if (!slot) continue;
		ranked.push({
			candidateId: candidate.id,
			url: candidate.url,
			provider: candidate.provider,
			setId: candidate.setId,
			setAuthor: candidate.setAuthor,
			score: scorePoster(candidate, weights),
			width: candidate.width,
			height: candidate.height,
			slot
		});
	}

	ranked.sort((a, b) => {
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

	const winners = new Map<string, AutomaticCandidateSelection>();
	for (const candidate of ranked) {
		const key = slotKey(candidate.slot);
		if (!winners.has(key)) winners.set(key, candidate);
	}

	const poster = winners.get('poster:root:root') ?? null;
	const background = winners.get('background:root:root') ?? null;
	const children = [...winners.values()]
		.filter((candidate) => candidate.slot.season !== null)
		.sort((a, b) => compareSlot(a.slot, b.slot));

	return { poster, background, children };
}
