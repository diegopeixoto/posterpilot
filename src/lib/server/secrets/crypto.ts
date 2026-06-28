/**
 * Authenticated encryption for secret settings values (server-side only).
 *
 * Pure over the key: every function takes the 32-byte key as an argument, so the
 * crypto is unit-testable without touching `$env` or the filesystem. Key resolution
 * (env var / generated key file) lives in `./key.ts`.
 *
 * Stored form is self-describing: `enc:v1:<base64(iv(12) | tag(16) | ciphertext)>`,
 * using AES-256-GCM. The version prefix lets readers distinguish encrypted values
 * from legacy plaintext (so existing secrets keep working until re-saved).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** Marker prefix for an encrypted value. Bump the version when the format changes. */
export const ENC_PREFIX = 'enc:v1:';

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** True when a stored value is in the encrypted `enc:v1:` form. */
export function isEncrypted(value: string): boolean {
	return value.startsWith(ENC_PREFIX);
}

/** Encrypt a plaintext secret with the given 32-byte key. Returns the `enc:v1:` string. */
export function encryptSecret(plaintext: string, key: Buffer): string {
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return ENC_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

/**
 * Decrypt a stored secret. Legacy plaintext (no `enc:v1:` prefix) is returned as-is
 * so unmigrated values keep working. Throws if an encrypted value cannot be
 * authenticated (wrong key or tampering) — callers treat that as "secret unset".
 */
export function decryptSecret(stored: string, key: Buffer): string {
	if (!isEncrypted(stored)) return stored;
	const raw = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64');
	const iv = raw.subarray(0, IV_BYTES);
	const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
	const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
	const decipher = createDecipheriv('aes-256-gcm', key, iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
