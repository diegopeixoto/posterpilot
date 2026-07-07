/**
 * Signed, stateless session tokens for the optional auth feature (server-side only).
 *
 * Pure over the signing key and the current time, so it is unit-testable without
 * `$env` or a clock. The signing key is domain-separated from the AES secrets key
 * via HMAC (`deriveSessionKey`), so a session forgery never touches the encryption
 * key. Token form: `v1.<b64url(payload)>.<b64url(HMAC-SHA256 sig)>` with payload
 * `{ u, v, iat, exp }`. Sliding expiry: a token past the refresh threshold is still
 * valid but flagged for re-issue, so an active user never expires while an idle one
 * does. Bumping the session version (`v`) invalidates every outstanding token.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const TOKEN_VERSION = 'v1';
const SESSION_INFO = 'posterpilot:session:v1';

/** Absolute session lifetime (14 days). */
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** Re-issue the token once it is older than this (24h), giving active users a sliding window. */
export const SESSION_REFRESH_MS = 24 * 60 * 60 * 1000;

export interface SessionPayload {
	/** Username. */
	u: string;
	/** Session version — must match the persisted `authSessionVersion`. */
	v: number;
	/** Issued-at (ms since epoch). */
	iat: number;
	/** Expiry (ms since epoch). */
	exp: number;
}

/** Domain-separated session-signing key derived from the instance master key. */
export function deriveSessionKey(masterKey: Buffer): Buffer {
	return createHmac('sha256', masterKey).update(SESSION_INFO).digest();
}

function sign(payloadB64: string, key: Buffer): string {
	return createHmac('sha256', key).update(payloadB64).digest('base64url');
}

/** Create a signed session token for a user at time `now` (ms). */
export function createSessionToken(
	username: string,
	version: number,
	key: Buffer,
	now: number
): string {
	const payload: SessionPayload = { u: username, v: version, iat: now, exp: now + SESSION_TTL_MS };
	const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
	return `${TOKEN_VERSION}.${payloadB64}.${sign(payloadB64, key)}`;
}

export interface VerifyResult {
	payload: SessionPayload;
	/** True when the token is valid but old enough that the caller should re-issue it. */
	needsRefresh: boolean;
}

/**
 * Verify a token against the signing key, the current session version, and time.
 * Returns `null` when the token is malformed, tampered, expired, or version-stale.
 */
export function verifySessionToken(
	token: string | null | undefined,
	version: number,
	key: Buffer,
	now: number
): VerifyResult | null {
	if (typeof token !== 'string') return null;
	const parts = token.split('.');
	if (parts.length !== 3) return null;
	const [ver, payloadB64, sig] = parts;
	if (ver !== TOKEN_VERSION) return null;

	const expected = sign(payloadB64, key);
	const sigBuf = Buffer.from(sig);
	const expBuf = Buffer.from(expected);
	if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;

	let payload: SessionPayload;
	try {
		payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
	} catch {
		return null;
	}
	if (
		!payload ||
		typeof payload.u !== 'string' ||
		typeof payload.v !== 'number' ||
		typeof payload.iat !== 'number' ||
		typeof payload.exp !== 'number'
	) {
		return null;
	}
	if (payload.v !== version) return null;
	if (now >= payload.exp) return null;

	return { payload, needsRefresh: now - payload.iat > SESSION_REFRESH_MS };
}
