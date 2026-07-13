import { scorePoster, type ScoreWeights } from '$lib/server/posters/score';

export type CollectionSuggestionKind = 'poster' | 'background';
export type CollectionFamilyEvidence = 'design_family' | 'exact_set' | 'author';

export interface CollectionSuggestionCandidateInput {
	id: number;
	mediaItemId: number;
	provider: string;
	setId: string;
	setAuthor: string | null;
	designFamily: string | null;
	language: string | null;
	url: string;
	kind: 'poster' | 'background' | 'season' | 'title_card';
	season: number | null;
	episode: number | null;
	width: number | null;
	height: number | null;
	stale: boolean;
}

export interface CollectionSuggestionCandidate {
	candidateId: number;
	mediaItemId: number;
	provider: string;
	setId: string;
	setAuthor: string | null;
	designFamily: string | null;
	language: string | null;
	url: string;
	kind: CollectionSuggestionKind;
	score: number;
	stale: boolean;
}

export interface CollectionFamilySuggestion {
	id: string;
	provider: string;
	evidence: CollectionFamilyEvidence;
	setAuthor: string | null;
	designFamily: string | null;
	setId: string | null;
	language: string | null;
	coveredMemberIds: number[];
	uncoveredMemberIds: number[];
	posterCoveredMemberIds: number[];
	posterUncoveredMemberIds: number[];
	backgroundCoveredMemberIds: number[];
	backgroundUncoveredMemberIds: number[];
	coveredSlots: number;
	coveragePercentage: number;
	averageScore: number;
	selections: CollectionSuggestionCandidate[];
	stale: boolean;
}

export interface BuildCollectionSuggestionsInput {
	memberIds: number[];
	candidates: CollectionSuggestionCandidateInput[];
	weights: ScoreWeights;
	providerPriority: readonly string[];
}

interface FamilyIdentity {
	key: string;
	provider: string;
	evidence: CollectionFamilyEvidence;
	setAuthor: string | null;
	designFamily: string | null;
	setId: string | null;
	language: string | null;
}

const GENERIC_SET_IDS = new Set(['tmdb', 'fanarttv', 'theposterdb', 'unknown', 'default']);

function text(value: string | null | undefined): string | null {
	const normalized = value?.trim();
	return normalized || null;
}

function identityText(value: string | null): string | null {
	return value?.normalize('NFKC').toLocaleLowerCase('en-US') ?? null;
}

function familyIdentities(candidate: CollectionSuggestionCandidateInput): FamilyIdentity[] {
	const normalizedProvider = text(candidate.provider);
	if (!normalizedProvider) return [];
	const provider: string = normalizedProvider;
	const author = text(candidate.setAuthor);
	const designFamily = text(candidate.designFamily);
	const setId = text(candidate.setId);
	const language = text(candidate.language);
	const identities: FamilyIdentity[] = [];

	function addIdentity(
		evidence: CollectionFamilyEvidence,
		evidenceValue: string,
		values: Pick<FamilyIdentity, 'setAuthor' | 'designFamily' | 'setId'>
	) {
		// Provider and language always scope the evidence. When supplied, the
		// credited author also scopes set/design metadata so two curators are not
		// silently presented as one coordinated visual family.
		identities.push({
			key: JSON.stringify([
				identityText(provider),
				evidence,
				identityText(evidenceValue),
				identityText(author),
				identityText(language)
			]),
			provider,
			evidence,
			...values,
			language
		});
	}

	if (designFamily) {
		addIdentity('design_family', designFamily, {
			setAuthor: author,
			designFamily,
			setId: null
		});
	}
	if (setId && !GENERIC_SET_IDS.has(setId.toLocaleLowerCase('en-US'))) {
		addIdentity('exact_set', setId, {
			setAuthor: author,
			designFamily: null,
			setId
		});
	}
	if (author) {
		addIdentity('author', author, {
			setAuthor: author,
			designFamily: null,
			setId: null
		});
	}

	return identities;
}

function candidateOrder(
	left: CollectionSuggestionCandidate,
	right: CollectionSuggestionCandidate,
	providerRank: Map<string, number>
): number {
	return (
		right.score - left.score ||
		(providerRank.get(left.provider) ?? Number.MAX_SAFE_INTEGER) -
			(providerRank.get(right.provider) ?? Number.MAX_SAFE_INTEGER) ||
		left.setId.localeCompare(right.setId) ||
		left.url.localeCompare(right.url) ||
		left.candidateId - right.candidateId
	);
}

function familySuggestionId(
	familyKey: string,
	memberIds: number[],
	selections: CollectionSuggestionCandidate[]
): string {
	return JSON.stringify([
		familyKey,
		memberIds,
		selections.map((selection) => [selection.mediaItemId, selection.kind, selection.candidateId])
	]);
}

/**
 * Group root candidates only when a provider supplied verifiable family evidence.
 * A suggestion must span at least two distinct local members; otherwise individual
 * candidates remain available without being described as a coordinated family.
 */
export function buildCollectionSuggestions(
	input: BuildCollectionSuggestionsInput
): CollectionFamilySuggestion[] {
	const memberIds = [...new Set(input.memberIds)].sort((left, right) => left - right);
	const memberSet = new Set(memberIds);
	const providerRank = new Map(
		input.providerPriority.map((provider, index) => [provider, index] as const)
	);
	const groups = new Map<
		string,
		{ identity: FamilyIdentity; candidates: CollectionSuggestionCandidate[] }
	>();

	for (const candidate of input.candidates) {
		if (
			!memberSet.has(candidate.mediaItemId) ||
			(candidate.kind !== 'poster' && candidate.kind !== 'background') ||
			candidate.season !== null ||
			candidate.episode !== null
		) {
			continue;
		}
		const identities = familyIdentities(candidate);
		if (!identities.length) continue;
		const rankedCandidate: CollectionSuggestionCandidate = {
			candidateId: candidate.id,
			mediaItemId: candidate.mediaItemId,
			provider: text(candidate.provider)!,
			setId: candidate.setId,
			setAuthor: text(candidate.setAuthor),
			designFamily: text(candidate.designFamily),
			language: text(candidate.language),
			url: candidate.url,
			kind: candidate.kind,
			score: scorePoster(candidate, input.weights),
			stale: candidate.stale
		};
		for (const identity of identities) {
			let group = groups.get(identity.key);
			if (!group) {
				group = { identity, candidates: [] };
				groups.set(identity.key, group);
			}
			group.candidates.push(rankedCandidate);
		}
	}

	const suggestions: CollectionFamilySuggestion[] = [];
	for (const [familyKey, group] of groups) {
		const winners = new Map<string, CollectionSuggestionCandidate>();
		for (const candidate of group.candidates.sort((left, right) =>
			candidateOrder(left, right, providerRank)
		)) {
			const key = `${candidate.mediaItemId}:${candidate.kind}`;
			if (!winners.has(key)) winners.set(key, candidate);
		}
		const selections = [...winners.values()].sort(
			(left, right) => left.mediaItemId - right.mediaItemId || left.kind.localeCompare(right.kind)
		);
		const coveredMemberIds = [
			...new Set(selections.map((selection) => selection.mediaItemId))
		].sort((left, right) => left - right);
		if (coveredMemberIds.length < 2) continue;
		const posterCoveredMemberIds = selections
			.filter((selection) => selection.kind === 'poster')
			.map((selection) => selection.mediaItemId);
		const backgroundCoveredMemberIds = selections
			.filter((selection) => selection.kind === 'background')
			.map((selection) => selection.mediaItemId);
		const uncoveredMemberIds = memberIds.filter((id) => !coveredMemberIds.includes(id));
		const posterUncoveredMemberIds = memberIds.filter((id) => !posterCoveredMemberIds.includes(id));
		const backgroundUncoveredMemberIds = memberIds.filter(
			(id) => !backgroundCoveredMemberIds.includes(id)
		);
		const averageScore = selections.length
			? selections.reduce((total, selection) => total + selection.score, 0) / selections.length
			: 0;
		suggestions.push({
			id: familySuggestionId(familyKey, memberIds, selections),
			provider: group.identity.provider,
			evidence: group.identity.evidence,
			setAuthor: group.identity.setAuthor,
			designFamily: group.identity.designFamily,
			setId: group.identity.setId,
			language: group.identity.language,
			coveredMemberIds,
			uncoveredMemberIds,
			posterCoveredMemberIds,
			posterUncoveredMemberIds,
			backgroundCoveredMemberIds,
			backgroundUncoveredMemberIds,
			coveredSlots: selections.length,
			coveragePercentage: memberIds.length
				? Math.round((coveredMemberIds.length / memberIds.length) * 100)
				: 0,
			averageScore,
			selections,
			stale: selections.some((selection) => selection.stale)
		});
	}

	const evidenceRank: Record<CollectionFamilyEvidence, number> = {
		design_family: 0,
		exact_set: 1,
		author: 2
	};
	const deduplicated = new Map<string, CollectionFamilySuggestion>();
	for (const suggestion of suggestions) {
		const selectionKey = JSON.stringify(
			suggestion.selections.map((selection) => [
				selection.mediaItemId,
				selection.kind,
				selection.candidateId
			])
		);
		const current = deduplicated.get(selectionKey);
		if (!current || evidenceRank[suggestion.evidence] < evidenceRank[current.evidence]) {
			deduplicated.set(selectionKey, suggestion);
		}
	}

	return [...deduplicated.values()].sort(
		(left, right) =>
			right.coveredMemberIds.length - left.coveredMemberIds.length ||
			right.coveredSlots - left.coveredSlots ||
			right.averageScore - left.averageScore ||
			(providerRank.get(left.provider) ?? Number.MAX_SAFE_INTEGER) -
				(providerRank.get(right.provider) ?? Number.MAX_SAFE_INTEGER) ||
			evidenceRank[left.evidence] - evidenceRank[right.evidence] ||
			left.id.localeCompare(right.id)
	);
}

export function rankIndividualCollectionCandidates(
	candidates: CollectionSuggestionCandidateInput[],
	weights: ScoreWeights,
	providerPriority: readonly string[]
): CollectionSuggestionCandidate[] {
	const providerRank = new Map(
		providerPriority.map((provider, index) => [provider, index] as const)
	);
	return candidates
		.filter(
			(candidate) =>
				(candidate.kind === 'poster' || candidate.kind === 'background') &&
				candidate.season === null &&
				candidate.episode === null
		)
		.map((candidate) => ({
			candidateId: candidate.id,
			mediaItemId: candidate.mediaItemId,
			provider: candidate.provider,
			setId: candidate.setId,
			setAuthor: text(candidate.setAuthor),
			designFamily: text(candidate.designFamily),
			language: text(candidate.language),
			url: candidate.url,
			kind: candidate.kind as CollectionSuggestionKind,
			score: scorePoster(candidate, weights),
			stale: candidate.stale
		}))
		.sort((left, right) => candidateOrder(left, right, providerRank));
}
