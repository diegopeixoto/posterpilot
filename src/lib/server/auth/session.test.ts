import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
	createSessionToken,
	deriveSessionKey,
	verifySessionToken,
	SESSION_TTL_MS,
	SESSION_REFRESH_MS
} from './session';

const master = randomBytes(32);
const key = deriveSessionKey(master);
const T0 = 1_700_000_000_000;

describe('auth/session', () => {
	it('derives a stable, domain-separated key from the master key', () => {
		expect(deriveSessionKey(master)).toEqual(key);
		expect(deriveSessionKey(master)).not.toEqual(master);
	});

	it('round-trips a valid token', () => {
		const token = createSessionToken('admin', 1, key, T0);
		const result = verifySessionToken(token, 1, key, T0 + 1000);
		expect(result?.payload.u).toBe('admin');
		expect(result?.needsRefresh).toBe(false);
	});

	it('rejects a tampered signature', () => {
		const token = createSessionToken('admin', 1, key, T0);
		const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa');
		expect(verifySessionToken(tampered, 1, key, T0)).toBeNull();
	});

	it('rejects a token signed with a different key', () => {
		const token = createSessionToken('admin', 1, key, T0);
		expect(verifySessionToken(token, 1, deriveSessionKey(randomBytes(32)), T0)).toBeNull();
	});

	it('rejects an expired token', () => {
		const token = createSessionToken('admin', 1, key, T0);
		expect(verifySessionToken(token, 1, key, T0 + SESSION_TTL_MS + 1)).toBeNull();
	});

	it('rejects a version-stale token', () => {
		const token = createSessionToken('admin', 1, key, T0);
		expect(verifySessionToken(token, 2, key, T0 + 1000)).toBeNull();
	});

	it('flags a token past the refresh threshold for re-issue', () => {
		const token = createSessionToken('admin', 1, key, T0);
		const result = verifySessionToken(token, 1, key, T0 + SESSION_REFRESH_MS + 1);
		expect(result?.needsRefresh).toBe(true);
	});

	it('rejects malformed input without throwing', () => {
		expect(verifySessionToken(null, 1, key, T0)).toBeNull();
		expect(verifySessionToken('a.b', 1, key, T0)).toBeNull();
		expect(verifySessionToken('v2.x.y', 1, key, T0)).toBeNull();
		expect(verifySessionToken('v1.!!!.???', 1, key, T0)).toBeNull();
	});
});
