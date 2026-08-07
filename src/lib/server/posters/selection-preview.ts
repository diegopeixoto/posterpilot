import { findEquivalentStagedArtworkCandidate } from '$lib/posters/selection-match';

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
	return findEquivalentStagedArtworkCandidate(
		candidates.filter(
			(candidate) =>
				candidate.mediaItemId === selection.mediaItemId && candidate.kind === selection.kind
		),
		selection
	);
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
