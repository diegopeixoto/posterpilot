/**
 * Resolves the instance encryption key used to encrypt secret settings at rest.
 *
 * Precedence:
 *   1. `APP_SECRET` env var — key derived deterministically via scrypt, so the same
 *      secret decrypts across restarts and across replicas sharing that value.
 *   2. An auto-generated 32-byte key persisted (owner-only) at `APP_KEY_FILE`
 *      (default `./data/.app-key`), so a fresh install needs zero setup.
 *
 * Kept out of the unit-tested crypto module because it reads `$env` and the
 * filesystem; the crypto in `./crypto.ts` stays pure over the key for testing.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { scryptSync } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';

const KEY_BYTES = 32;
/** Fixed KDF salt — not secret; only ties the derivation to this application. */
const APP_SECRET_SALT = 'posterpilot:secrets:v1';
const DEFAULT_KEY_FILE = './data/.app-key';

let cachedKey: Buffer | null = null;

function keyFilePath(): string {
	return env.APP_KEY_FILE && env.APP_KEY_FILE !== '' ? env.APP_KEY_FILE : DEFAULT_KEY_FILE;
}

function loadOrCreateKeyFile(): Buffer {
	const path = keyFilePath();
	try {
		const existing = readFileSync(path);
		if (existing.length === KEY_BYTES) return existing;
	} catch {
		// not present yet — fall through to generate
	}
	const generated = randomBytes(KEY_BYTES);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, generated, { mode: 0o600 });
	return generated;
}

/** Return the cached 32-byte encryption key, resolving it on first use. */
export function getEncryptionKey(): Buffer {
	if (cachedKey) return cachedKey;
	const appSecret = env.APP_SECRET;
	cachedKey =
		appSecret && appSecret !== ''
			? scryptSync(appSecret, APP_SECRET_SALT, KEY_BYTES)
			: loadOrCreateKeyFile();
	return cachedKey;
}
