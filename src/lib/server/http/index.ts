import { eq } from 'drizzle-orm';
import pRetry, { AbortError } from 'p-retry';
import pLimit, { type LimitFunction } from 'p-limit';
import { db } from '$lib/server/db';
import { httpCache } from '$lib/server/db/schema';

const DAY_MS = 86_400_000;

export interface FetchOptions {
	headers?: Record<string, string>;
	/** Cache TTL in days; omit or 0 disables caching. */
	cacheTtlDays?: number;
	/** Bypass the cache read (a fresh response is still written back). */
	forceRefresh?: boolean;
	/**
	 * Serve a stale cached value immediately and refresh it in the background,
	 * so the call never blocks on the network past the first fetch and the next
	 * call sees fresh data. Use for non-critical, frequently-polled endpoints
	 * (e.g. the update check) where a slightly stale answer is fine.
	 */
	staleWhileRevalidate?: boolean;
	/** Retry attempts for transient failures (429 / 5xx / network). */
	retries?: number;
	/** Per-attempt timeout in milliseconds. */
	timeoutMs?: number;
}

async function readCacheRow(url: string): Promise<{ body: string; ageMs: number } | null> {
	const row = (await db.select().from(httpCache).where(eq(httpCache.url, url)).limit(1))[0];
	if (!row) return null;
	return { body: row.body, ageMs: Date.now() - row.fetchedAt.getTime() };
}

async function writeCache(url: string, body: string): Promise<void> {
	const now = new Date();
	await db
		.insert(httpCache)
		.values({ url, body, fetchedAt: now })
		.onConflictDoUpdate({ target: httpCache.url, set: { body, fetchedAt: now } });
}

/** Run the network fetch with retry/backoff. Retries 429/5xx + network; fails fast on other 4xx. */
function fetchFresh(
	url: string,
	headers: Record<string, string> | undefined,
	retries: number,
	timeoutMs: number
): Promise<string> {
	return pRetry(
		async () => {
			const ac = new AbortController();
			const timer = setTimeout(() => ac.abort(), timeoutMs);
			try {
				const res = await fetch(url, { headers, signal: ac.signal });
				if (!res.ok) {
					if (res.status === 429 || res.status >= 500) {
						throw new Error(`HTTP ${res.status} for ${url}`);
					}
					// 4xx (other than 429) is a permanent failure — do not retry.
					throw new AbortError(`HTTP ${res.status} for ${url}`);
				}
				return await res.text();
			} finally {
				clearTimeout(timer);
			}
		},
		{ retries, minTimeout: 500, factor: 2 }
	);
}

// URLs currently being revalidated in the background, to avoid duplicate refreshes.
const revalidating = new Set<string>();

/** Refresh a URL's cached body in the background. Never throws. */
function revalidate(
	url: string,
	headers: Record<string, string> | undefined,
	retries: number,
	timeoutMs: number
): void {
	if (revalidating.has(url)) return;
	revalidating.add(url);
	void fetchFresh(url, headers, retries, timeoutMs)
		.then((body) => writeCache(url, body))
		.catch(() => {})
		.finally(() => revalidating.delete(url));
}

/**
 * Fetch a URL as text with retry-with-backoff and optional SQLite response caching.
 * Retries on 429/5xx and network errors; fails fast (no retry) on other 4xx.
 */
export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
	const {
		cacheTtlDays = 0,
		forceRefresh = false,
		staleWhileRevalidate = false,
		headers,
		retries = 3,
		timeoutMs = 20_000
	} = opts;

	if (cacheTtlDays > 0 && !forceRefresh) {
		const row = await readCacheRow(url);
		if (row) {
			if (row.ageMs <= cacheTtlDays * DAY_MS) return row.body; // fresh
			if (staleWhileRevalidate) {
				revalidate(url, headers, retries, timeoutMs); // refresh for next time
				return row.body; // serve stale now, never blocking
			}
		}
	}

	const body = await fetchFresh(url, headers, retries, timeoutMs);
	if (cacheTtlDays > 0) await writeCache(url, body);
	return body;
}

/** Fetch and parse JSON, with the same retry/cache behavior as fetchText. */
export async function fetchJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
	const text = await fetchText(url, opts);
	return JSON.parse(text) as T;
}

/** Create a concurrency limiter (wraps p-limit) for bounded fan-out. */
export function createLimiter(concurrency: number): LimitFunction {
	return pLimit(Math.max(1, concurrency));
}

/** Await a fixed delay — used to space out polite scraping requests. */
export function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
