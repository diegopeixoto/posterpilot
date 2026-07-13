/**
 * Resolves the instance encryption key used to encrypt secret settings at rest.
 *
 * Precedence:
 *   1. `APP_SECRET` env var — key derived deterministically via scrypt, so the same
 *      secret decrypts across restarts and across replicas sharing that value.
 *   2. An auto-generated 32-byte key persisted (owner-only) at `APP_KEY_FILE`. When
 *      unset it defaults to `.app-key` alongside the SQLite database (derived from
 *      `DATABASE_URL`), so it always lands on the same persistent volume as the data
 *      it protects — losing it would make stored secrets undecryptable.
 *
 * Kept out of the unit-tested crypto module because it reads the process environment
 * and filesystem; the crypto in `./crypto.ts` stays pure over the key for testing.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { scryptSync } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { resolveDataPaths } from '$lib/server/data-paths';

const KEY_BYTES = 32;
/** Fixed KDF salt — not secret; only ties the derivation to this application. */
const APP_SECRET_SALT = 'posterpilot:secrets:v1';

let cachedKey: Buffer | null = null;

function keyFilePath(): string {
	return resolveDataPaths(process.env.DATABASE_URL, process.env.APP_KEY_FILE).appKeyFile;
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
	const appSecret = process.env.APP_SECRET;
	cachedKey =
		appSecret && appSecret !== ''
			? scryptSync(appSecret, APP_SECRET_SALT, KEY_BYTES)
			: loadOrCreateKeyFile();
	return cachedKey;
}

/**
 * Boot-time hygiene check: warn (never throw) if the key file exists with group- or
 * world-accessible permissions. This key protects every stored secret and should be
 * owner-only (`0600`). Advisory only — a missing file (fresh install, or an `APP_SECRET`
 * deployment with no file) is fine and silent.
 */
export function warnIfKeyFileInsecure(): void {
	// When APP_SECRET drives the key there is no file to guard.
	if (process.env.APP_SECRET && process.env.APP_SECRET !== '') return;
	const path = keyFilePath();
	try {
		const st = statSync(path);
		if ((st.mode & 0o077) !== 0) {
			const mode = (st.mode & 0o777).toString(8).padStart(3, '0');
			console.warn(
				`[warn] secrets: encryption key file ${path} is group/world-accessible (mode ${mode}); ` +
					`it should be owner-only. Run: chmod 600 ${path}`
			);
		}
	} catch {
		// Missing or unreadable → nothing to warn about (a fresh install creates it 0600).
	}
}
