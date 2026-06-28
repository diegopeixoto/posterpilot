import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret, ENC_PREFIX, isEncrypted } from './crypto';

const key = randomBytes(32);

describe('secrets/crypto', () => {
	it('round-trips a secret', () => {
		const secret = 'plex-token-abc123';
		const enc = encryptSecret(secret, key);
		expect(enc.startsWith(ENC_PREFIX)).toBe(true);
		expect(enc).not.toContain(secret);
		expect(decryptSecret(enc, key)).toBe(secret);
	});

	it('produces a different ciphertext each time (random IV)', () => {
		const a = encryptSecret('same', key);
		const b = encryptSecret('same', key);
		expect(a).not.toBe(b);
		expect(decryptSecret(a, key)).toBe('same');
		expect(decryptSecret(b, key)).toBe('same');
	});

	it('flags encrypted vs plaintext values', () => {
		expect(isEncrypted(encryptSecret('x', key))).toBe(true);
		expect(isEncrypted('plain-token')).toBe(false);
	});

	it('passes legacy plaintext through decrypt unchanged', () => {
		expect(decryptSecret('legacy-plaintext', key)).toBe('legacy-plaintext');
	});

	it('throws when decrypting with the wrong key', () => {
		const enc = encryptSecret('secret', key);
		expect(() => decryptSecret(enc, randomBytes(32))).toThrow();
	});

	it('throws when the ciphertext is tampered', () => {
		const enc = encryptSecret('secret', key);
		// Flip a character in the base64 payload.
		const tampered = ENC_PREFIX + enc.slice(ENC_PREFIX.length).split('').reverse().join('');
		expect(() => decryptSecret(tampered, key)).toThrow();
	});
});
