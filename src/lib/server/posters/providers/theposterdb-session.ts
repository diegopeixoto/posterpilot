import { loginToThePosterDb } from './theposterdb-auth';

/**
 * In-memory ThePosterDB session cache, keyed by credentials so a settings change picks
 * up a fresh session automatically instead of reusing a stale one. Login is a scraped
 * form POST (not a cheap API call) and ThePosterDB's own cookies live ~2h, so callers
 * share one session across discoveries instead of logging in per item.
 */

const SESSION_TTL_MS = 90 * 60 * 1000; // refresh before the observed ~2h cookie lifetime

interface CachedSession {
	key: string;
	cookie: string;
	expiresAt: number;
}

let cached: CachedSession | null = null;
let inflight: { key: string; promise: Promise<string | null> } | null = null;

function sessionKey(username: string, password: string): string {
	return JSON.stringify([username, password]);
}

/** Get a cached (or freshly logged-in) session cookie, or null when unconfigured/failed. */
export async function getThePosterDbSession(
	username: string | null,
	password: string | null
): Promise<string | null> {
	if (!username || !password) return null;
	const key = sessionKey(username, password);
	if (cached && cached.key === key && cached.expiresAt > Date.now()) return cached.cookie;
	if (inflight && inflight.key === key) return inflight.promise;

	const promise = (async () => {
		try {
			const cookie = await loginToThePosterDb(username, password);
			cached = { key, cookie, expiresAt: Date.now() + SESSION_TTL_MS };
			return cookie;
		} catch {
			cached = null;
			return null;
		} finally {
			inflight = null;
		}
	})();
	inflight = { key, promise };
	return promise;
}

/** Force the next call to log in again (e.g. a request came back looking logged-out). */
export function invalidateThePosterDbSession(): void {
	cached = null;
}
