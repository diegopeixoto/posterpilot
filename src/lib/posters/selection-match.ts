import { storedArtworkMatchesCandidate } from './artwork-url';

export interface ArtworkCandidateIdentity {
	id: number;
	url: string;
	provider: string;
}

export interface StagedArtworkIdentity {
	url: string | null | undefined;
	candidateId: number | null | undefined;
	provider: string | null | undefined;
}

export interface NextStagedArtworkIdentity {
	url: string | null;
	candidateId: number | null;
	provider: string | null;
}

/**
 * Resolve a staged candidate with provider-aware URL equivalence. Candidate ids are
 * only a lookup hint because rediscovery can replace a row without changing its asset.
 */
export function findEquivalentStagedArtworkCandidate<T extends ArtworkCandidateIdentity>(
	candidates: readonly T[],
	selection: StagedArtworkIdentity
): T | null {
	const storedUrl = selection.url;
	if (!storedUrl) return null;
	const matchesSelection = (candidate: T) =>
		storedArtworkMatchesCandidate({
			storedUrl,
			storedProvider: selection.provider ?? null,
			candidateUrl: candidate.url,
			candidateProvider: candidate.provider
		});
	const matchedById =
		selection.candidateId === null || selection.candidateId === undefined
			? null
			: candidates.find(
					(candidate) => candidate.id === selection.candidateId && matchesSelection(candidate)
				);
	return matchedById ?? candidates.find(matchesSelection) ?? null;
}

export function stagedArtworkMatchesCandidate(
	selection: StagedArtworkIdentity,
	candidate: ArtworkCandidateIdentity
): boolean {
	return findEquivalentStagedArtworkCandidate([candidate], selection) !== null;
}

/** Toggle a candidate and clear every persisted identity field when it is already staged. */
export function toggleStagedArtworkCandidate(
	selection: StagedArtworkIdentity,
	candidate: ArtworkCandidateIdentity
): NextStagedArtworkIdentity {
	if (stagedArtworkMatchesCandidate(selection, candidate)) {
		return { url: null, candidateId: null, provider: null };
	}
	return { url: candidate.url, candidateId: candidate.id, provider: candidate.provider };
}
