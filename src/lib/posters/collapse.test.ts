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

	it('also expands theposterdb even when it is not the first provider', () => {
		const expanded = defaultExpanded([
			{ provider: 'mediux', sets: [{ setId: 'a' }] },
			{ provider: 'tmdb', sets: [{ setId: 'b' }] },
			{ provider: 'theposterdb', sets: [{ setId: 'theposterdb' }] }
		]);
		expect([...expanded].sort()).toEqual(['p:mediux', 'p:theposterdb', 's:a', 's:theposterdb']);
	});

	it('does not fail when theposterdb is present but has no sets', () => {
		const expanded = defaultExpanded([{ provider: 'theposterdb', sets: [] }]);
		expect([...expanded]).toEqual(['p:theposterdb']);
	});
});
