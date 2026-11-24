/**
 * Read-through caching of a page's *parsed* result instead of its raw body.
 *
 * Scraped provider pages are large — a MediUX listing page embeds its whole Next.js
 * payload (~1 MB on average, up to ~12 MB) and a ThePosterDB page ~120 KB — while what
 * discovery keeps from them is a short list of poster sets. Caching the raw HTML grew the
 * SQLite cache to 4.4 GB across ~12,000 pages in three days and kept multi-megabyte
 * strings in memory on every cache hit. Caching the parsed value is the same lookup at a
 * small fraction of the size, and a cache hit no longer re-parses anything.
 *
 * Kept free of the database and network so it can be unit-tested; `http/index.ts` wires
 * it to the SQLite cache table and the retrying fetch.
 */

const DAY_MS = 86_400_000;

export interface ParsedCacheStore {
	read(key: string): Promise<{ body: string; ageMs: number } | null>;
	write(key: string, body: string): Promise<void>;
}

export interface ParsedCacheRequest<T> {
	key: string;
	/** Cache lifetime in days; 0 disables caching (fetch + parse every time). */
	ttlDays: number;
	/** Skip the cache read; the fresh value is still written back. */
	forceRefresh?: boolean;
	fetchBody: () => Promise<string>;
	/** Must return JSON-serializable data (plain objects, arrays, strings, numbers, null). */
	parse: (body: string) => T;
}

export async function readThroughParsed<T>(
	store: ParsedCacheStore,
	request: ParsedCacheRequest<T>
): Promise<T> {
	const { key, ttlDays, forceRefresh = false, fetchBody, parse } = request;
	if (ttlDays > 0 && !forceRefresh) {
		const row = await store.read(key);
		if (row && row.ageMs <= ttlDays * DAY_MS) {
			try {
				return JSON.parse(row.body) as T;
			} catch {
				// A corrupt or foreign row is a miss; it is overwritten below.
			}
		}
	}
	const value = parse(await fetchBody());
	if (ttlDays > 0) await store.write(key, JSON.stringify(value) ?? 'null');
	return value;
}

/**
 * Oldest `fetched_at` the HTTP cache keeps. Callers choose their own freshness (7 days by
 * default, 30 for slow-moving data such as release info or collection images), and stale
 * rows are still served by stale-while-revalidate callers, so pruning waits until a row
 * is past every caller's window: the longer of 30 days and the configured TTL.
 */
export function httpCachePruneCutoff(now: Date, configuredTtlDays: number): Date {
	const keepDays = Math.max(30, Number.isFinite(configuredTtlDays) ? configuredTtlDays : 0);
	return new Date(now.getTime() - keepDays * DAY_MS);
}
