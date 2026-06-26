import { describe, it, expect } from 'vitest';
import {
	DEFAULT_COLLECTIONS,
	DEFAULT_COLLECTION_GROUPS,
	isKnownDefault,
	knownDefaults
} from './defaults-catalog';

describe('defaults-catalog', () => {
	it('accepts known catalog names', () => {
		for (const name of ['genre', 'studio', 'country', 'decade', 'franchise', 'network']) {
			expect(isKnownDefault(name)).toBe(true);
		}
	});

	it('rejects unknown names', () => {
		expect(isKnownDefault('not_a_real_default')).toBe(false);
		expect(isKnownDefault('')).toBe(false);
		// There is intentionally no bare `content_rating` file — only suffixed ones.
		expect(isKnownDefault('content_rating')).toBe(false);
		expect(isKnownDefault('content_rating_us')).toBe(true);
	});

	it('knownDefaults filters to recognized names, preserving order', () => {
		expect(knownDefaults(['genre', 'bogus', 'studio'])).toEqual(['genre', 'studio']);
	});

	it('has no duplicate names across groups', () => {
		const names = DEFAULT_COLLECTIONS.map((c) => c.name);
		expect(new Set(names).size).toBe(names.length);
	});

	it('every group has a stable id and at least one collection', () => {
		for (const g of DEFAULT_COLLECTION_GROUPS) {
			expect(g.id).toMatch(/^[a-z_]+$/);
			expect(g.collections.length).toBeGreaterThan(0);
		}
	});
});
