import { describe, expect, it } from 'vitest';
import { httpCacheKey, safeHttpTarget } from './cache-key';

describe('HTTP cache secret handling', () => {
	it('uses a one-way key that changes with URL and header credentials', () => {
		const first = httpCacheKey('https://api.test/items?api_key=first', {
			Authorization: 'Bearer one'
		});
		const second = httpCacheKey('https://api.test/items?api_key=second', {
			Authorization: 'Bearer two'
		});
		expect(first).toMatch(/^[a-f0-9]{64}$/);
		expect(first).not.toBe(second);
		expect(first).not.toContain('first');
		expect(first).not.toContain('one');
	});

	it('omits the complete query from diagnostic labels', () => {
		expect(safeHttpTarget('https://api.test/items?api_key=secret&query=private')).toBe(
			'https://api.test/items'
		);
	});

	it('separates semantically distinct cache namespaces for the same request', () => {
		const movie = httpCacheKey('https://api.test/find/tt123', undefined, 'tmdb:movie');
		const tv = httpCacheKey('https://api.test/find/tt123', undefined, 'tmdb:tv');

		expect(movie).not.toBe(tv);
		expect(movie).not.toContain('movie');
		expect(tv).not.toContain('tv');
	});
});
