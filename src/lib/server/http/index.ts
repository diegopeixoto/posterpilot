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
	/** Retry attempts for transient failures (429 / 5xx / network). */
	retries?: number;
	/** Per-attempt timeout in milliseconds. */
	timeoutMs?: number;
}

async function readCache(url: string, ttlDays: number): Promise<string | null> {
	const row = (await db.select().from(httpCache).where(eq(httpCache.url, url)).limit(1))[0];
	if (!row) return null;
	const age = Date.now() - row.fetchedAt.getTime();
	if (age > ttlDays * DAY_MS) return null;
	return row.body;
}

async function writeCache(url: string, body: string): Promise<void> {
	const now = new Date();
	await db
		.insert(httpCache)
		.values({ url, body, fetchedAt: now })
		.onConflictDoUpdate({ target: httpCache.url, set: { body, fetchedAt: now } });
}

/**
 * Fetch a URL as text with retry-with-backoff and optional SQLite response caching.
 * Retries on 429/5xx and network errors; fails fast (no retry) on other 4xx.
 */
export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
	const { cacheTtlDays = 0, forceRefresh = false, headers, retries = 3, timeoutMs = 20_000 } = opts;

	if (cacheTtlDays > 0 && !forceRefresh) {
		const cached = await readCache(url, cacheTtlDays);
		if (cached !== null) return cached;
	}

	const body = await pRetry(
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
