import { describe, expect, it } from 'vitest';
import { buildGallerySlides } from './fun-gallery';

const items = [
	{ id: 1, title: 'Both', hasPoster: true, hasBackground: true },
	{ id: 2, title: 'Poster', hasPoster: true, hasBackground: false },
	{ id: 3, title: 'Background', hasPoster: false, hasBackground: true },
	{ id: 4, title: 'None', hasPoster: false, hasBackground: false }
];

describe('buildGallerySlides', () => {
	it('keeps only posters in poster mode', () => {
		const slides = buildGallerySlides(items, 'poster', 'posters');
		expect(slides.every((slide) => slide.kind === 'poster')).toBe(true);
		expect(slides.map((slide) => slide.itemId).sort()).toEqual([1, 2]);
	});

	it('keeps only backgrounds in background mode', () => {
		const slides = buildGallerySlides(items, 'background', 'backgrounds');
		expect(slides.every((slide) => slide.kind === 'background')).toBe(true);
		expect(slides.map((slide) => slide.itemId).sort()).toEqual([1, 3]);
	});

	it('uses one available artwork per item with stable unique slide ids in mixed mode', () => {
		const first = buildGallerySlides(items, 'mixed', 'ambient');
		const second = buildGallerySlides([...items].reverse(), 'mixed', 'ambient');
		expect(first).toEqual(second);
		expect(new Set(first.map((slide) => slide.id)).size).toBe(first.length);
		expect(first).toHaveLength(3);
	});
});
