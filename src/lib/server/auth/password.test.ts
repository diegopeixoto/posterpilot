import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword, HASH_PREFIX } from './password';

describe('auth/password', () => {
	it('round-trips a correct password', async () => {
		const hash = await hashPassword('correct horse battery staple');
		expect(hash.startsWith(HASH_PREFIX)).toBe(true);
		expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
	});

	it('rejects a wrong password', async () => {
		const hash = await hashPassword('s3cret');
		expect(await verifyPassword('s3cr3t', hash)).toBe(false);
	});

	it('embeds the params and does not contain the plaintext', async () => {
		const hash = await hashPassword('hunter2');
		expect(hash).toMatch(/^scrypt:v1:16384,8,1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
		expect(hash).not.toContain('hunter2');
	});

	it('produces a different hash each time (random salt)', async () => {
		const a = await hashPassword('same');
		const b = await hashPassword('same');
		expect(a).not.toBe(b);
		expect(await verifyPassword('same', a)).toBe(true);
		expect(await verifyPassword('same', b)).toBe(true);
	});

	it('never throws on a malformed verifier — returns false', async () => {
		expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
		expect(await verifyPassword('x', 'scrypt:v1:')).toBe(false);
		expect(await verifyPassword('x', 'scrypt:v1:bad:params:here')).toBe(false);
		expect(await verifyPassword('x', '')).toBe(false);
	});
});
