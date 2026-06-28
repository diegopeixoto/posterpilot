import { describe, expect, it } from 'vitest';
import { defaultExpanded, providerKey, setKey, seasonKey } from './collapse';

describe('collapse keys', () => {
	it('builds stable distinct keys', () => {
		expect(providerKey('mediux')).toBe('p:mediux');
		expect(setKey('8472')).toBe('s:8472');
		expect(seasonKey('8472', 2)).toBe('season:8472:2');
	});
});

describe('defaultExpanded', () => {
	it('expands the first provider and its first set only', () => {
		const expanded = defaultExpanded([
			{ provider: 'mediux', sets: [{ setId: 'a' }, { setId: 'b' }] },
			{ provider: 'tmdb', sets: [{ setId: 'c' }] }
		]);
		expect([...expanded].sort()).toEqual(['p:mediux', 's:a']);
	});

	it('expands the provider even when it has no sets', () => {
		const expanded = defaultExpanded([{ provider: 'mediux', sets: [] }]);
		expect([...expanded]).toEqual(['p:mediux']);
	});

	it('returns an empty set when there are no providers', () => {
		expect(defaultExpanded([]).size).toBe(0);
	});
});
