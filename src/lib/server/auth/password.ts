/**
 * Password hashing for the optional auth feature (server-side only).
 *
 * Pure and `$env`-free so it is unit-testable without SvelteKit. Uses Node's
 * built-in **async** scrypt (never `scryptSync`, which would block the event loop
 * on every login). The stored form is self-describing —
 * `scrypt:v1:<N,r,p>:<salt b64>:<hash b64>` — mirroring the `enc:v1:` convention in
 * `secrets/crypto.ts`, so the KDF parameters travel with the hash and can evolve
 * without a migration. `verifyPassword` is constant-time and never throws.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/** Marker prefix for a scrypt password verifier. Bump the version if the format changes. */
export const HASH_PREFIX = 'scrypt:v1:';

const SALT_BYTES = 16;
const KEY_BYTES = 32;
// scrypt cost parameters (N must be a power of two). 128 * N * r ≈ 16 MiB — under
// Node's 32 MiB default maxmem.
const N = 16384;
const R = 8;
const P = 1;

function scryptAsync(
	password: string,
	salt: Buffer,
	keylen: number,
	n: number,
	r: number,
	p: number
): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		scrypt(password, salt, keylen, { N: n, r, p }, (err, derived) => {
			if (err) reject(err);
			else resolve(derived as Buffer);
		});
	});
}

/** Hash a plaintext password into a self-describing `scrypt:v1:...` verifier. */
export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(SALT_BYTES);
	const derived = await scryptAsync(password, salt, KEY_BYTES, N, R, P);
	return `${HASH_PREFIX}${N},${R},${P}:${salt.toString('base64')}:${derived.toString('base64')}`;
}

/**
 * Verify a plaintext password against a stored verifier. Constant-time; never
 * throws — a malformed or non-matching verifier simply returns `false`.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	try {
		if (typeof stored !== 'string' || !stored.startsWith(HASH_PREFIX)) return false;
		const [params, saltB64, hashB64] = stored.slice(HASH_PREFIX.length).split(':');
		if (!params || !saltB64 || !hashB64) return false;
		const [nStr, rStr, pStr] = params.split(',');
		const n = Number(nStr);
		const r = Number(rStr);
		const p = Number(pStr);
		if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
		const salt = Buffer.from(saltB64, 'base64');
		const expected = Buffer.from(hashB64, 'base64');
		if (salt.length === 0 || expected.length === 0) return false;
		const derived = await scryptAsync(password, salt, expected.length, n, r, p);
		if (derived.length !== expected.length) return false;
		return timingSafeEqual(derived, expected);
	} catch {
		return false;
	}
}
