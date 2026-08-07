export type RootArtworkKind = 'poster' | 'background';

export interface ArtworkPreviewCandidate {
	id: number;
	mediaItemId: number;
	url: string;
	previewUrl: string | null;
	kind: 'poster' | 'background' | 'season' | 'title_card';
}

export interface StagedArtworkSelection {
	mediaItemId: number;
	kind: RootArtworkKind;
	url: string | null;
	candidateId: number | null;
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
		candidate.url === selection.url;
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
