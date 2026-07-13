import { describe, expect, it } from 'vitest';
import { galleryAutoAdvanceAllowed } from './fun-gallery-playback';

describe('galleryAutoAdvanceAllowed', () => {
	const base = {
		active: true,
		paused: false,
		reducedMotion: false,
		reducedMotionPlaybackEnabled: false,
		slideCount: 2
	};

	it('advances normally when the gallery is playing', () => {
		expect(galleryAutoAdvanceAllowed(base)).toBe(true);
	});

	it('requires an explicit playback opt-in under reduced motion', () => {
		expect(galleryAutoAdvanceAllowed({ ...base, reducedMotion: true })).toBe(false);
		expect(
			galleryAutoAdvanceAllowed({
				...base,
				reducedMotion: true,
				reducedMotionPlaybackEnabled: true
			})
		).toBe(true);
	});

	it('does not advance while paused or with fewer than two slides', () => {
		expect(galleryAutoAdvanceAllowed({ ...base, paused: true })).toBe(false);
		expect(galleryAutoAdvanceAllowed({ ...base, slideCount: 1 })).toBe(false);
	});
});
