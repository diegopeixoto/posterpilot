import { describe, expect, it } from 'vitest';
import { resolveStableReviewNeighbors, reviewItemPath, reviewReturnPath } from './context-core';

describe('stable review context', () => {
	it('keeps the frozen position while skipping entries that stopped matching', () => {
		expect(resolveStableReviewNeighbors([10, 20, 30, 40, 50], [10, 40, 50], 30)).toEqual({
			previousItemId: 10,
			nextItemId: 40
		});
		expect(resolveStableReviewNeighbors([10, 20, 30], [10, 20, 30], 20)).toEqual({
			previousItemId: 10,
			nextItemId: 30
		});
	});

	it('rejects an item that was never part of the opaque context', () => {
		expect(resolveStableReviewNeighbors([10, 20], [10, 20, 30], 30)).toBeNull();
	});

	it('validates inbox returns and updates focus without accepting other paths', () => {
		expect(reviewReturnPath('/review?state=new&offset=24&focus=1', 42)).toBe(
			'/review?state=new&offset=24&focus=42'
		);
		expect(reviewReturnPath('/library', 42)).toBeNull();
		expect(reviewReturnPath('//evil.test/review', 42)).toBeNull();
		expect(reviewReturnPath('/review\\evil', 42)).toBeNull();
	});

	it('encodes the validated return and opaque context in item links', () => {
		expect(reviewItemPath(3, '/review?focus=3', 'context-a')).toBe(
			'/item/3?returnTo=%2Freview%3Ffocus%3D3&reviewContext=context-a'
		);
	});
});
