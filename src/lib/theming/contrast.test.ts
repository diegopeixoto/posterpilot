import { describe, expect, it } from 'vitest';
import { contrastOf, contrastRatio, parseColor, readableForeground } from './contrast';

describe('parseColor', () => {
	it('parses the hex forms the theme grammar accepts', () => {
		expect(parseColor('#fff')).toEqual([255, 255, 255]);
		// The fourth nibble is alpha, which is ignored rather than read as blue.
		expect(parseColor('#f00c')).toEqual([255, 0, 0]);
		expect(parseColor('#7c3aed')).toEqual([124, 58, 237]);
		expect(parseColor('#7c3aed80')).toEqual([124, 58, 237]);
	});

	it('parses functional colors and ignores alpha', () => {
		expect(parseColor('rgb(124, 58, 237)')).toEqual([124, 58, 237]);
		expect(parseColor('rgba(124, 58, 237, 0.5)')).toEqual([124, 58, 237]);
		expect(parseColor('hsl(0, 0%, 100%)')).toEqual([255, 255, 255]);
		expect(parseColor('hsl(0, 100%, 50%)')).toEqual([255, 0, 0]);
		expect(parseColor('hsl(120, 100%, 50%)')).toEqual([0, 255, 0]);
	});

	it('rejects out-of-range and unsupported values', () => {
		expect(parseColor('rgb(300, 0, 0)')).toBeNull();
		expect(parseColor('hsl(0, 200%, 50%)')).toBeNull();
		expect(parseColor('rebeccapurple')).toBeNull();
		expect(parseColor('var(--x)')).toBeNull();
	});
});

describe('contrastRatio', () => {
	it('spans the full WCAG range', () => {
		expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
		expect(contrastRatio([255, 255, 255], [255, 255, 255])).toBeCloseTo(1, 5);
	});

	it('is symmetric regardless of argument order', () => {
		expect(contrastOf('#0a0a0a', '#fafafa')).toBeCloseTo(contrastOf('#fafafa', '#0a0a0a')!, 10);
	});

	it('reports null when either color is unparseable', () => {
		expect(contrastOf('#000000', 'chartreuse')).toBeNull();
	});
});

describe('readableForeground', () => {
	it('picks the higher-contrast of black and white', () => {
		// The case that motivated it: a bright accent under a white foreground.
		expect(readableForeground('#fde047')).toBe('#000000');
		expect(readableForeground('#a6e22e')).toBe('#000000');
		expect(readableForeground('#4f46e5')).toBe('#ffffff');
		expect(readableForeground('#1d1b6b')).toBe('#ffffff');
	});

	it('always clears AA for text, whatever the accent', () => {
		for (const accent of ['#7c3aed', '#33ff33', '#fde047', '#4f46e5', '#808080', '#000000']) {
			expect(contrastOf(readableForeground(accent)!, accent)).toBeGreaterThanOrEqual(4.5);
		}
	});

	it('declines to guess for an unparseable color so the theme value stands', () => {
		expect(readableForeground('var(--whatever)')).toBeNull();
	});
});
