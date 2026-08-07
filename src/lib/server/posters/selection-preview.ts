import { storedArtworkMatchesCandidate } from '$lib/server/tmdb/artwork-url';

export type RootArtworkKind = 'poster' | 'background';

export interface ArtworkPreviewCandidate {
	id: number;
	mediaItemId: number;
	url: string;
	previewUrl: string | null;
	kind: 'poster' | 'background' | 'season' | 'title_card';
	provider: string;
}

export interface StagedArtworkSelection {
	mediaItemId: number;
	kind: RootArtworkKind;
	url: string | null;
	candidateId: number | null;
	provider: string | null;
}

/**
 * Resolve candidate display metadata only when it belongs to the staged item, slot,
 * and canonical URL. A candidate id is a hint rather than authority because older
 * clients can leave it null or stale while changing the selected URL.
 */
export function findStagedArtworkCandidate<T extends ArtworkPreviewCandidate>(
	candidates: readonly T[],
	selection: StagedArtworkSelection
): T | null {
	if (!selection.url) return null;
	const matchesSelection = (candidate: T) =>
		candidate.mediaItemId === selection.mediaItemId &&
		candidate.kind === selection.kind &&
		storedArtworkMatchesCandidate({
			storedUrl: selection.url as string,
			storedProvider: selection.provider,
			candidateUrl: candidate.url,
			candidateProvider: candidate.provider
		});
	const matchedById =
		selection.candidateId === null
			? null
			: candidates.find(
					(candidate) => candidate.id === selection.candidateId && matchesSelection(candidate)
				);
	return matchedById ?? candidates.find(matchesSelection) ?? null;
}

/** Keep review thumbnails efficient while preserving custom staged URLs as fallback. */
export function resolveStagedArtworkPreview(
	candidates: readonly ArtworkPreviewCandidate[],
	selection: StagedArtworkSelection
): string | null {
	if (!selection.url) return null;
	const matched = findStagedArtworkCandidate(candidates, selection);
	return matched?.previewUrl ?? selection.url;
}
