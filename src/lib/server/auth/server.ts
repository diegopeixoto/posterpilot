/**
 * Server-only auth glue: bridges the pure `$env`-free auth modules to the instance
 * key, the request cookies, and the shared login throttle. Kept separate from the
 * pure modules (which stay unit-testable) and from `hooks.server.ts` (which wires
 * the guard).
 */
import type { Cookies } from '@sveltejs/kit';
import { getEncryptionKey } from '$lib/server/secrets/key';
import { deriveSessionKey, createSessionToken, SESSION_TTL_MS } from './session';
import { LoginThrottle } from './login-throttle';

/** Session cookie name. */
export const SESSION_COOKIE = 'pp_session';

let cachedSessionKey: Buffer | null = null;

/** The domain-separated session-signing key, derived once from the instance master key. */
export function getSessionKey(): Buffer {
	if (!cachedSessionKey) cachedSessionKey = deriveSessionKey(getEncryptionKey());
	return cachedSessionKey;
}

/** Process-wide login throttle (in-memory; cleared on restart). */
export const loginThrottle = new LoginThrottle();

/** Issue a fresh session cookie for `username` at version `version`. */
export function issueSessionCookie(
	cookies: Cookies,
	username: string,
	version: number,
	isHttps: boolean,
	now: number
): void {
	const token = createSessionToken(username, version, getSessionKey(), now);
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		// HTTP LAN installs are common; an unconditional Secure flag would make the
		// cookie never stick there. Match it to the request protocol.
		secure: isHttps,
		maxAge: Math.floor(SESSION_TTL_MS / 1000)
	});
}

/** Clear the session cookie (logout). */
export function clearSessionCookie(cookies: Cookies, isHttps: boolean): void {
	cookies.set(SESSION_COOKIE, '', {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: isHttps,
		maxAge: 0
	});
}
