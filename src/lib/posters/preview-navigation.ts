/**
 * Pure sequence maths for the enlarged artwork preview: where next and previous
 * land, and where an open preview lands after the sequence it was opened from
 * changes underneath it.
 *
 * The dialog walks the item page's *currently filtered and disclosed* candidate
 * sequence, never the retained inventory, so the page owns the array and this
 * module owns only the arithmetic over it. Keeping the arithmetic here means the
 * clamping and re-anchoring rules are unit-tested directly instead of through a
 * browser, the same split `candidate-disclosure` uses for the grids themselves.
 */

/** All the sequence maths needs from an entry; a `PosterCandidate` satisfies it. */
export interface PreviewIdentity {
	id: number;
}

/**
 * One previewable candidate as the dialog renders it.
 *
 * `url` is the canonical destination asset, deliberately: grids render the
 * optimized `previewUrl` thumbnail, and the whole point of the enlarged preview
 * is to show the asset that would actually be applied.
 */
export interface PreviewArtwork extends PreviewIdentity {
	provider: string;
	url: string;
	width: number | null;
	height: number | null;
	language: string | null;
}

/** Position and bounds for the dialog's controls and its localized announcement. */
export interface PreviewBounds {
	/** 1-based, for `item_preview_position`. Zero when the sequence is empty. */
	position: number;
	total: number;
	hasPrevious: boolean;
	hasNext: boolean;
}

/**
 * Clamp any index into `[0, length)`; `-1` when there is nothing to point at.
 *
 * The index arrives from component state and from the parent's opening request,
 * so a stale, negative or fractional value is a real input rather than a
 * theoretical one — a reveal that shrank the sequence leaves the cursor past the
 * end, and a candidate id that no longer resolves leaves it at `-1`.
 */
export function clampPreviewIndex(index: number, length: number): number {
	if (!Number.isFinite(length) || length <= 0) return -1;
	if (!Number.isFinite(index)) return 0;
	return Math.min(Math.max(Math.trunc(index), 0), Math.trunc(length) - 1);
}

/**
 * The index `step` positions away, clamped at both ends.
 *
 * Deliberately no wraparound. The dialog announces "3 of 12" beside these
 * controls, and a Next that silently jumps back to 1 contradicts the position
 * the user is reading; the disabled bound is the honest end of the sequence.
 */
export function stepPreviewIndex(index: number, length: number, step: number): number {
	const current = clampPreviewIndex(index, length);
	if (current < 0) return -1;
	return clampPreviewIndex(current + Math.trunc(step), length);
}

/** What the position announcement says and which navigation controls are live. */
export function previewBounds(index: number, length: number): PreviewBounds {
	const current = clampPreviewIndex(index, length);
	if (current < 0) return { position: 0, total: 0, hasPrevious: false, hasNext: false };
	const total = Math.trunc(length);
	return {
		position: current + 1,
		total,
		hasPrevious: current > 0,
		hasNext: current < total - 1
	};
}

/**
 * Where an open preview lands after its sequence changed underneath it.
 *
 * The sequence is the page's filtered and disclosed view, so it moves for
 * reasons that have nothing to do with the dialog: revealing another batch
 * appends, a changed artwork-language preference refilters, and an
 * `invalidateAll()` after a background job replaces it wholesale.
 *
 * Following the anchored candidate's id keeps the same artwork on screen across
 * an append or a reorder. When that candidate is gone the previous ordinal is
 * clamped rather than closing the dialog: the sequence is still a valid one to
 * browse, and dropping someone out of a modal they did not dismiss is the more
 * disruptive outcome. Only an empty sequence has nothing left to show.
 *
 * Returns `null` when the dialog has to close.
 */
export function resolvePreviewIndex<T extends PreviewIdentity>(
	sequence: readonly T[],
	anchorId: number | null,
	previousIndex: number
): number | null {
	if (sequence.length === 0) return null;
	const anchored = anchorId === null ? -1 : sequence.findIndex((entry) => entry.id === anchorId);
	return anchored >= 0 ? anchored : clampPreviewIndex(previousIndex, sequence.length);
}
