import { describe, expect, it } from 'vitest';
import { httpCachePruneCutoff, readThroughParsed, type ParsedCacheStore } from './parsed-cache';

const DAY_MS = 86_400_000;

function memoryStore(initial: Record<string, { body: string; ageMs: number }> = {}) {
	const rows = new Map(Object.entries(initial));
	const writes: Array<[string, string]> = [];
	const store: ParsedCacheStore = {
		read: async (key) => rows.get(key) ?? null,
		write: async (key, body) => {
			writes.push([key, body]);
			rows.set(key, { body, ageMs: 0 });
		}
	};
	return { store, writes, rows };
}

describe('readThroughParsed', () => {
	it('fetches, parses and caches only the parsed value on a miss', async () => {
		const { store, writes } = memoryStore();
		let fetches = 0;
		const value = await readThroughParsed(store, {
			key: 'k',
			ttlDays: 7,
			fetchBody: async () => {
				fetches++;
				return `<html>${'x'.repeat(100_000)}<sets>a,b</sets></html>`;
			},
			parse: (html) => html.match(/<sets>(.*)<\/sets>/)![1].split(',')
		});
		expect(value).toEqual(['a', 'b']);
		expect(fetches).toBe(1);
		expect(writes).toEqual([['k', '["a","b"]']]);
	});

	it('serves a fresh cached value without fetching or parsing', async () => {
		const { store } = memoryStore({ k: { body: '{"setId":"1"}', ageMs: DAY_MS } });
		const value = await readThroughParsed(store, {
			key: 'k',
			ttlDays: 7,
			fetchBody: async () => {
				throw new Error('should not fetch');
			},
			parse: () => {
				throw new Error('should not parse');
			}
		});
		expect(value).toEqual({ setId: '1' });
	});

	it('refetches an expired, unreadable or force-refreshed entry and overwrites it', async () => {
		for (const [row, forceRefresh] of [
			[{ body: '["old"]', ageMs: 8 * DAY_MS }, false],
			[{ body: '<!DOCTYPE html> raw page from before', ageMs: 0 }, false],
			[{ body: '["old"]', ageMs: 0 }, true]
		] as const) {
			const { store, writes } = memoryStore({ k: row });
			const value = await readThroughParsed(store, {
				key: 'k',
				ttlDays: 7,
				forceRefresh,
				fetchBody: async () => 'new',
				parse: (body) => [body]
			});
			expect(value).toEqual(['new']);
			expect(writes).toEqual([['k', '["new"]']]);
		}
	});

	it('caches a null result so a known miss is not refetched', async () => {
		const { store, writes } = memoryStore();
		const request = {
			key: 'k',
			ttlDays: 7,
			fetchBody: async () => 'no match here',
			parse: (): string | null => null
		};
		expect(await readThroughParsed(store, request)).toBeNull();
		expect(writes).toEqual([['k', 'null']]);
		expect(
			await readThroughParsed(store, {
				...request,
				fetchBody: async () => {
					throw new Error('should not fetch');
				}
			})
		).toBeNull();
	});

	it('neither reads nor writes the cache when caching is off', async () => {
		const { store, writes } = memoryStore({ k: { body: '["cached"]', ageMs: 0 } });
		const value = await readThroughParsed(store, {
			key: 'k',
			ttlDays: 0,
			fetchBody: async () => 'live',
			parse: (body) => [body]
		});
		expect(value).toEqual(['live']);
		expect(writes).toEqual([]);
	});
});

describe('httpCachePruneCutoff', () => {
	const now = new Date('2026-11-24T12:00:00Z');

	it('keeps at least 30 days so every caller’s freshness window survives', () => {
		expect(httpCachePruneCutoff(now, 7).toISOString()).toBe('2026-10-25T12:00:00.000Z');
	});

	it('keeps longer when the configured TTL is longer', () => {
		expect(now.getTime() - httpCachePruneCutoff(now, 90).getTime()).toBe(90 * DAY_MS);
	});

	it('falls back to 30 days for an unusable TTL', () => {
		expect(now.getTime() - httpCachePruneCutoff(now, Number.NaN).getTime()).toBe(30 * DAY_MS);
	});
});
