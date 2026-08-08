import { describe, expect, it } from 'vitest';
import {
	clampPreviewIndex,
	previewBounds,
	resolvePreviewIndex,
	stepPreviewIndex
} from './preview-navigation';

/** A sequence of the given ids, standing in for the page's visible candidates. */
function sequence(...ids: number[]): { id: number }[] {
	return ids.map((id) => ({ id }));
}

describe('clampPreviewIndex', () => {
	it('keeps an in-range index', () => {
		expect(clampPreviewIndex(2, 5)).toBe(2);
	});

	it('pulls an out-of-range index back to the nearest end', () => {
		expect(clampPreviewIndex(-3, 5)).toBe(0);
		expect(clampPreviewIndex(9, 5)).toBe(4);
	});

	it('reports no valid index for an empty sequence', () => {
		expect(clampPreviewIndex(0, 0)).toBe(-1);
		expect(clampPreviewIndex(3, -1)).toBe(-1);
	});

	it('survives the non-integers a stale cursor can carry', () => {
		expect(clampPreviewIndex(1.9, 5)).toBe(1);
		expect(clampPreviewIndex(Number.NaN, 5)).toBe(0);
		expect(clampPreviewIndex(2, Number.NaN)).toBe(-1);
	});
});

describe('stepPreviewIndex', () => {
	it('moves one position in either direction', () => {
		expect(stepPreviewIndex(2, 5, 1)).toBe(3);
		expect(stepPreviewIndex(2, 5, -1)).toBe(1);
	});

	it('clamps at both ends instead of wrapping around', () => {
		// Wrapping would contradict the "5 of 5" the dialog is announcing.
		expect(stepPreviewIndex(4, 5, 1)).toBe(4);
		expect(stepPreviewIndex(0, 5, -1)).toBe(0);
	});

	it('clamps a step that overshoots the sequence', () => {
		expect(stepPreviewIndex(1, 5, 40)).toBe(4);
		expect(stepPreviewIndex(3, 5, -40)).toBe(0);
	});

	it('has nowhere to step in an empty sequence', () => {
		expect(stepPreviewIndex(0, 0, 1)).toBe(-1);
	});
});

describe('previewBounds', () => {
	it('reports a 1-based position and both bounds open in the middle', () => {
		expect(previewBounds(1, 3)).toEqual({
			position: 2,
			total: 3,
			hasPrevious: true,
			hasNext: true
		});
	});

	it('closes the matching bound at each end', () => {
		expect(previewBounds(0, 3)).toMatchObject({ hasPrevious: false, hasNext: true });
		expect(previewBounds(2, 3)).toMatchObject({ hasPrevious: true, hasNext: false });
	});

	it('closes both bounds for a single candidate', () => {
		expect(previewBounds(0, 1)).toEqual({
			position: 1,
			total: 1,
			hasPrevious: false,
			hasNext: false
		});
	});

	it('announces nothing for an empty sequence', () => {
		expect(previewBounds(0, 0)).toEqual({
			position: 0,
			total: 0,
			hasPrevious: false,
			hasNext: false
		});
	});
});

describe('resolvePreviewIndex', () => {
	it('follows the anchored candidate when a reveal appends more', () => {
		expect(resolvePreviewIndex(sequence(1, 2, 3, 4, 5), 3, 2)).toBe(2);
	});

	it('follows the anchored candidate when the sequence is reordered', () => {
		// Provider order changed while the dialog was open: same artwork, new slot.
		expect(resolvePreviewIndex(sequence(5, 3, 1), 3, 2)).toBe(1);
	});

	it('follows the anchored candidate when earlier entries are filtered away', () => {
		expect(resolvePreviewIndex(sequence(3, 4), 3, 2)).toBe(0);
	});

	it('clamps to the previous ordinal when the anchor is filtered away', () => {
		// Staying in place beats ejecting the user from a modal they never dismissed.
		expect(resolvePreviewIndex(sequence(1, 2, 4, 5), 3, 2)).toBe(2);
	});

	it('clamps past the end when the sequence shrank under the cursor', () => {
		expect(resolvePreviewIndex(sequence(1, 2), 9, 7)).toBe(1);
	});

	it('closes only when the sequence has nothing left to show', () => {
		expect(resolvePreviewIndex([], 3, 2)).toBeNull();
	});

	it('falls back to the ordinal when no candidate is anchored yet', () => {
		expect(resolvePreviewIndex(sequence(1, 2, 3), null, 1)).toBe(1);
	});
});
