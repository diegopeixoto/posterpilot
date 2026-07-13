import { describe, expect, it } from 'vitest';
import {
	isEditableReviewTarget,
	reviewShortcutForKey,
	reviewShortcutsBlocked
} from './review-shortcuts';

describe('review keyboard shortcuts', () => {
	it('maps the documented unmodified keys', () => {
		expect(reviewShortcutForKey({ key: 'K' })).toBe('previous');
		expect(reviewShortcutForKey({ key: 'j' })).toBe('next');
		expect(reviewShortcutForKey({ key: 'S' })).toBe('stage_suggestion');
		expect(reviewShortcutForKey({ key: 'i' })).toBe('ignore');
		expect(reviewShortcutForKey({ key: 'c' })).toBe('compare');
		expect(reviewShortcutForKey({ key: 'a' })).toBe('apply_next');
	});

	it('does not intercept repeats, modified keys, or unrelated input', () => {
		expect(reviewShortcutForKey({ key: 'j', repeat: true })).toBeNull();
		expect(reviewShortcutForKey({ key: 'j', metaKey: true })).toBeNull();
		expect(reviewShortcutForKey({ key: 'x' })).toBeNull();
	});

	it('recognizes editable controls', () => {
		for (const tagName of ['INPUT', 'textarea', 'SELECT']) {
			expect(isEditableReviewTarget({ tagName })).toBe(true);
		}
		expect(isEditableReviewTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
		expect(isEditableReviewTarget({ tagName: 'ARTICLE' })).toBe(false);
		expect(isEditableReviewTarget({ tagName: 'BUTTON' })).toBe(false);
	});

	it('blocks shortcuts during confirmations, undo and modal work', () => {
		expect(reviewShortcutsBlocked({})).toBe(false);
		for (const state of [
			{ busy: true },
			{ confirmationOpen: true },
			{ undoOpen: true },
			{ modalOpen: true }
		]) {
			expect(reviewShortcutsBlocked(state)).toBe(true);
		}
	});
});
