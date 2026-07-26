import type { Client, InArgs, InStatement, ResultSet, TransactionMode } from '@libsql/client';

/**
 * Retries individual statements that fail with SQLite contention (SQLITE_BUSY).
 *
 * Writes serialize through db/write-queue.ts, but reads run unthrottled — and they wait for
 * no one, because neither `PRAGMA busy_timeout` nor the client's `timeout` option reliably
 * survives this local libsql client discarding and lazily reopening its native connection
 * (see the comment in db/index.ts). During a sync's write bursts a read can therefore land
 * while the WAL writer holds the lock and fail instantly, surfacing to the UI as a transient
 * HTTP 500 that self-heals on the next poll. A short, bounded per-statement retry absorbs
 * those collisions instead.
 *
 * `transaction()` is deliberately not wrapped: write transactions already serialize through
 * the write queue, and re-running a failed interactive transaction wholesale from this layer
 * would replay statements chosen against state that may no longer hold.
 */

const MAX_ATTEMPTS = 5;
const INITIAL_DELAY_MS = 40;

// libsql's LibsqlError carries a machine-readable `code` — "SQLITE_BUSY", or an extended
// variant such as "SQLITE_BUSY_SNAPSHOT" — so prefer that, and fall back to the canonical
// "database is locked" message for errors that arrive without a code.
function isBusyError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const code = (error as { code?: unknown }).code;
	if (typeof code === 'string') return code.startsWith('SQLITE_BUSY');
	return error.message.includes('database is locked');
}

// Deterministic exponential backoff: 40, 80, 160, 320ms — 600ms worst case before the
// final busy error is rethrown. Non-busy errors rethrow immediately.
async function retryOnBusy<T>(run: () => Promise<T>): Promise<T> {
	let delay = INITIAL_DELAY_MS;
	for (let attempt = 1; ; attempt++) {
		try {
			return await run();
		} catch (error) {
			if (attempt >= MAX_ATTEMPTS || !isBusyError(error)) throw error;
			await new Promise((resolve) => setTimeout(resolve, delay));
			delay *= 2;
		}
	}
}

/**
 * Wraps a libsql client so `execute` and `batch` retry bounded on SQLITE_BUSY. Every other
 * member delegates untouched. Explicit delegation (not a Proxy) so the compiler flags any
 * future `Client` member this wrapper does not account for.
 */
export function withBusyRetry(client: Client): Client {
	return {
		execute: (stmtOrSql: InStatement, args?: InArgs): Promise<ResultSet> =>
			retryOnBusy(() =>
				typeof stmtOrSql === 'string' ? client.execute(stmtOrSql, args) : client.execute(stmtOrSql)
			),
		batch: (stmts: Array<InStatement | [string, InArgs?]>, mode?: TransactionMode) =>
			retryOnBusy(() => client.batch(stmts, mode)),
		migrate: (stmts: Array<InStatement>) => client.migrate(stmts),
		transaction: (mode?: TransactionMode) => client.transaction(mode),
		executeMultiple: (sql: string) => client.executeMultiple(sql),
		sync: () => client.sync(),
		close: () => client.close(),
		reconnect: () => client.reconnect(),
		get closed() {
			return client.closed;
		},
		get protocol() {
			return client.protocol;
		}
	};
}
