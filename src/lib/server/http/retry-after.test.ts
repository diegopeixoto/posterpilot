import { describe, expect, it } from 'vitest';
import { parseRetryAfter, DEFAULT_MAX_RETRY_AFTER_MS } from './retry-after';

const NOW = 1_700_000_000_000;

describe('http/retry-after · parseRetryAfter', () => {
	it('parses delta-seconds', () => {
		expect(parseRetryAfter('30', NOW)).toBe(30_000);
		expect(parseRetryAfter('  5 ', NOW)).toBe(5_000);
		expect(parseRetryAfter('0', NOW)).toBe(0);
	});

	it('parses an HTTP-date in the future', () => {
		const future = new Date(NOW + 10_000).toUTCString();
		expect(parseRetryAfter(future, NOW)).toBe(10_000);
	});

	it('returns 0 for a past date', () => {
		const past = new Date(NOW - 10_000).toUTCString();
		expect(parseRetryAfter(past, NOW)).toBe(0);
	});

	it('clamps to the max', () => {
		expect(parseRetryAfter('99999', NOW)).toBe(DEFAULT_MAX_RETRY_AFTER_MS);
		expect(parseRetryAfter('10', NOW, 5_000)).toBe(5_000);
	});

	it('returns null for missing or invalid values', () => {
		expect(parseRetryAfter(null, NOW)).toBeNull();
		expect(parseRetryAfter(undefined, NOW)).toBeNull();
		expect(parseRetryAfter('', NOW)).toBeNull();
		expect(parseRetryAfter('soon', NOW)).toBeNull();
		expect(parseRetryAfter('-5', NOW)).toBeNull();
	});
});
