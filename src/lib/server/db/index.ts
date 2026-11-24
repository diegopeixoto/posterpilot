import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { env } from '$env/dynamic/private';
import { resolveDataPaths } from '$lib/server/data-paths';
import { withBusyRetry } from './busy-retry';
import { withDedicatedTransactions } from './dedicated-transactions';
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
// db/write-queue.ts); the client's `timeout` (busy timeout) is a secondary safety net for
// any write path serializeWrite misses.
//
// withDedicatedTransactions gives every transaction() its own connection and closes it on
// commit/rollback. The stock local client hands its connection to the transaction and never
// closes it, so each transaction leaked a native connection (file descriptor + page cache)
// until GC — gigabytes over a library sync. Skipped for in-memory URLs, where a second
// connection would open a different, empty database.
//
// withBusyRetry is the read-side complement of that write queue: reads never go through
// serializeWrite, so during a sync's write bursts they can hit SQLITE_BUSY and 500 (issue
// #56). The wrapper retries the individual statement a few times with a small backoff.
const clientConfig = { url: dataPaths.databaseUrl, timeout: 5000 };
const baseClient = createClient(clientConfig);
export const databaseClient = withBusyRetry(
	dataPaths.databaseFile
		? withDedicatedTransactions(baseClient, () => createClient(clientConfig))
		: baseClient
);

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
