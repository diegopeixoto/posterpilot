import { createClient, type Client } from '@libsql/client';
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

// No busy timeout, on purpose. libsql runs each statement synchronously on the event-loop
// thread, so SQLite's busy-wait (the `timeout` option) froze the entire server — every HTTP
// request and the container health check — for the whole timeout on each lock collision,
// and withBusyRetry then repeated it. A collision now fails at once with SQLITE_BUSY and is
// retried asynchronously (withBusyRetry, and the transaction lane for BEGIN), so the server
// keeps answering while it waits. Concurrent writers are still ordered by serializeWrite
// (db/write-queue.ts).
//
// withDedicatedTransactions runs every transaction() on one reused connection, one at a time.
// The stock local client opened a fresh native connection per transaction, and those are
// only freed when GC finalizes them — which barely happens under load — so a library sync
// piled up gigabytes and thousands of descriptors. Skipped for in-memory URLs, where a
// second connection would open a different, empty database.
//
// withBusyRetry is the read-side complement of that write queue: reads never go through
// serializeWrite, so during a sync's write bursts they can hit SQLITE_BUSY and 500 (issue
// #56). The wrapper retries the individual statement a few times with a small backoff.
const clientConfig = { url: dataPaths.databaseUrl };
const baseClient = createClient(clientConfig);

// synchronous=NORMAL is SQLite's recommended setting for WAL mode: the WAL is fsynced at
// checkpoints instead of on every commit. It cannot corrupt the database; a power cut or OS
// crash (not an app crash) may lose only the last few commits. The default, FULL, fsyncs on
// every commit — and because libsql runs statements on the event-loop thread, each fsync
// stalled the whole server. On a copy-on-write filesystem (btrfs, as on Unraid cache pools)
// a sync's thousands of commits kept the server unresponsive for its whole run.
// The setting is per connection, so it is applied to each one as it opens.
async function prepareConnection(connection: Client): Promise<void> {
	await connection.execute('PRAGMA synchronous = NORMAL');
}

export const databaseClient = withBusyRetry(
	dataPaths.databaseFile
		? withDedicatedTransactions(baseClient, () => createClient(clientConfig), {
				prepareConnection
			})
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
		// The main connection is opened above, before the wrapper can prepare it.
		await prepareConnection(baseClient);
	}
	await migrate(db, { migrationsFolder: './drizzle' });
	migrated = true;
}
