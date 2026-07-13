import { describe, expect, it } from 'vitest';
import { isPosterGridKey, nextPosterGridIndex } from './library-grid-navigation';

describe('library poster-grid navigation', () => {
	it('moves horizontally and vertically using the rendered column count', () => {
		expect(nextPosterGridIndex(5, 'ArrowLeft', 4, 10)).toBe(4);
		expect(nextPosterGridIndex(5, 'ArrowRight', 4, 10)).toBe(6);
		expect(nextPosterGridIndex(5, 'ArrowUp', 4, 10)).toBe(1);
		expect(nextPosterGridIndex(5, 'ArrowDown', 4, 10)).toBe(9);
	});

	it('keeps focus inside partial rows and outer grid bounds', () => {
		expect(nextPosterGridIndex(0, 'ArrowLeft', 4, 10)).toBe(0);
		expect(nextPosterGridIndex(2, 'ArrowUp', 4, 10)).toBe(0);
		expect(nextPosterGridIndex(8, 'ArrowDown', 4, 10)).toBe(9);
		expect(nextPosterGridIndex(9, 'ArrowRight', 4, 10)).toBe(9);
	});

	it('supports direct movement to the beginning and end', () => {
		expect(nextPosterGridIndex(5, 'Home', 4, 10)).toBe(0);
		expect(nextPosterGridIndex(5, 'End', 4, 10)).toBe(9);
	});

	it('only recognizes navigation keys', () => {
		expect(isPosterGridKey('ArrowDown')).toBe(true);
		expect(isPosterGridKey('Enter')).toBe(false);
	});
});
