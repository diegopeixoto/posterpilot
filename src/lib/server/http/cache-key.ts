import { createHash } from 'node:crypto';

/**
 * One-way SQLite cache key. URL queries and authorization headers influence the
 * cache identity but are never persisted themselves.
 */
export function httpCacheKey(url: string, headers: Record<string, string> | undefined): string {
	const normalizedHeaders = Object.entries(headers ?? {})
		.map(([key, value]) => [key.toLowerCase(), value] as const)
		.sort(([left], [right]) => left.localeCompare(right));
	return createHash('sha256')
		.update(JSON.stringify({ url, headers: normalizedHeaders }))
		.digest('hex');
}

/** Query-free diagnostic target that cannot reveal API keys or search input. */
export function safeHttpTarget(url: string): string {
	try {
		const parsed = new URL(url);
		return `${parsed.origin}${parsed.pathname}`;
	} catch {
		return '[invalid URL]';
	}
}
