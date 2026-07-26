import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { env } from '$env/dynamic/private';
import { resolveDataPaths } from '$lib/server/data-paths';
import { processPendingRestore } from './pending-restore';
import * as schema from './schema';

const dataPaths = resolveDataPaths(env.DATABASE_URL, env.APP_KEY_FILE);

// libsql writes a real file for `file:` URLs — make sure the parent dir exists.
if (dataPaths.databaseFile) {
	const dir = dirname(dataPaths.databaseFile);
	if (dir) mkdirSync(dir, { recursive: true });
}

// A restore marker is consumed before createClient can open the SQLite file.
// This ordering is deliberate: replacing a live database (or its key) is unsafe.
export const restoreBootResult = processPendingRestore(dataPaths);
if (restoreBootResult.status === 'rejected' || restoreBootResult.status === 'rolled_back') {
	console.error(
		`[restore] ${restoreBootResult.error}; marker retained at ${restoreBootResult.failedMarker}`
	);
}

// Plain SQLite rejects a write immediately (SQLITE_BUSY) instead of waiting when another
// writer holds the lock. The actual fix for concurrent writers is serializeWrite (see
// db/write-queue.ts) — a PRAGMA busy_timeout doesn't reliably survive this local sqlite3
// client discarding and lazily reopening its native connection after every transaction(),
// and even the client's own `timeout` option (which is supposed to apply to every
// connection it opens) didn't hold up under genuinely concurrent writers in testing. Set
// here anyway as a harmless secondary safety net for any write path serializeWrite misses.
export const databaseClient = createClient({ url: dataPaths.databaseUrl, timeout: 5000 });

export const db = drizzle(databaseClient, { schema });

let migrated = false;

/** Apply pending migrations once per process. Called from hooks.server.ts on startup. */
export async function migrateDb(): Promise<void> {
	if (migrated) return;
	// WAL mode is persisted in the database file itself, so a single PRAGMA here (unlike
	// the busy timeout above) is enough. In-memory test databases skip this — WAL needs a
	// real file.
	if (dataPaths.databaseFile) {
		await databaseClient.execute('PRAGMA journal_mode = WAL;');
	}
	await migrate(db, { migrationsFolder: './drizzle' });
	migrated = true;
}
