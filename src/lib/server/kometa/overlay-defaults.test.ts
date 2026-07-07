import { describe, expect, it } from 'vitest';
import { OVERLAY_DEFAULTS, isKnownOverlay, knownOverlays } from './overlay-defaults';

describe('kometa/overlay-defaults', () => {
	it('reports whether a name is a known overlay', () => {
		expect(isKnownOverlay('ribbon')).toBe(true);
		expect(isKnownOverlay('__nope__')).toBe(false);
	});

	it('filters to known overlays, preserving order and dropping unknowns', () => {
		expect(knownOverlays(['ribbon', '__nope__', 'ratings'])).toEqual(['ribbon', 'ratings']);
		expect(knownOverlays([])).toEqual([]);
	});

	it('has unique overlay names', () => {
		const names = OVERLAY_DEFAULTS.map((o) => o.name);
		expect(new Set(names).size).toBe(names.length);
	});
});
