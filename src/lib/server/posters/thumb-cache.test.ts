import { describe, expect, it, vi } from 'vitest';

// thumb-cache.ts imports the db (which loads $env at module init). The pure
// helpers under test never touch it, so stub the module to keep this test
// $env-free — mirrors the pattern in service.test.ts.
vi.mock('$lib/server/db', () => ({ db: {} }));

import { hashUrl, isExpired, selectEvictions } from './thumb-cache';

describe('hashUrl', () => {
	it('is stable for the same URL', () => {
		expect(hashUrl('https://example.com/a.jpg')).toBe(hashUrl('https://example.com/a.jpg'));
	});

	it('produces a 64-char sha256 hex digest', () => {
		expect(hashUrl('https://example.com/a.jpg')).toMatch(/^[0-9a-f]{64}$/);
	});

	it('differs per URL', () => {
		expect(hashUrl('https://example.com/a.jpg')).not.toBe(hashUrl('https://example.com/b.jpg'));
	});
});

describe('isExpired', () => {
	const fetchedAt = new Date('2026-01-01T00:00:00Z');
	const ttlMs = 1000;

	it('is false within the TTL window', () => {
		expect(isExpired(fetchedAt, ttlMs, fetchedAt.getTime() + 500)).toBe(false);
	});

	it('is false exactly at the TTL boundary', () => {
		expect(isExpired(fetchedAt, ttlMs, fetchedAt.getTime() + ttlMs)).toBe(false);
	});

	it('is true once past the TTL', () => {
		expect(isExpired(fetchedAt, ttlMs, fetchedAt.getTime() + ttlMs + 1)).toBe(true);
	});
});

describe('selectEvictions', () => {
	const entries = [
		{ urlHash: 'old', sizeBytes: 100, accessedAt: new Date('2026-01-01T00:00:00Z') },
		{ urlHash: 'mid', sizeBytes: 100, accessedAt: new Date('2026-01-02T00:00:00Z') },
		{ urlHash: 'new', sizeBytes: 100, accessedAt: new Date('2026-01-03T00:00:00Z') }
	];

	it('returns [] when already under budget', () => {
		expect(selectEvictions(entries, 300)).toEqual([]);
		expect(selectEvictions(entries, 1000)).toEqual([]);
		expect(selectEvictions([], 0)).toEqual([]);
	});

	it('evicts the oldest-accessed entry to get under budget', () => {
		// total 300, budget 250 → drop just the oldest (100) → 200 <= 250.
		expect(selectEvictions(entries, 250)).toEqual(['old']);
	});

	it('evicts oldest-first until under budget', () => {
		// total 300, budget 150 → drop old (→200) then mid (→100) <= 150.
		expect(selectEvictions(entries, 150)).toEqual(['old', 'mid']);
	});

	it('evicts everything when the budget is zero', () => {
		expect(selectEvictions(entries, 0)).toEqual(['old', 'mid', 'new']);
	});

	it('ignores input ordering and always evicts by accessedAt', () => {
		const shuffled = [entries[2], entries[0], entries[1]];
		expect(selectEvictions(shuffled, 150)).toEqual(['old', 'mid']);
	});
});
