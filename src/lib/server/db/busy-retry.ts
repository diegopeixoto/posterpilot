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

const MAX_ATTEMPTS = 8;
const INITIAL_DELAY_MS = 40;
const MAX_DELAY_MS = 500;

// libsql's LibsqlError carries a machine-readable `code` — "SQLITE_BUSY", or an extended
// variant such as "SQLITE_BUSY_SNAPSHOT" — so prefer that when it says something.
//
// It is not always populated: a connection that cannot be opened arrives as `code: ''`
// with the reason only in the message (`ConnectionFailed("Unable to open connection to
// local database …: 14")`, 14 being SQLITE_CANTOPEN). An empty code therefore has to fall
// through to the message rather than be trusted as "not contention" — reading it as a
// code is how such a failure bypassed this retry entirely and surfaced as an HTTP 500.
//
// SQLITE_CANTOPEN is treated as retryable for the same reason SQLITE_BUSY is: under a
// write burst it is transient, driven by descriptor pressure or a database momentarily
// locked against opening, and a retry costs a few hundred milliseconds against a request
// that would otherwise fail outright.
const TRANSIENT_MESSAGE_PATTERNS = [
	'database is locked',
	'database table is locked',
	'unable to open connection',
	'unable to open database'
];

function isTransientError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const code = (error as { code?: unknown }).code;
	if (typeof code === 'string' && code !== '') {
		return (
			code.startsWith('SQLITE_BUSY') ||
			code.startsWith('SQLITE_LOCKED') ||
			code === 'SQLITE_CANTOPEN'
		);
	}
	const message = error.message.toLowerCase();
	return TRANSIENT_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern));
}

// Deterministic exponential backoff capped at 500ms: 40, 80, 160, 320, 500, 500, 500 —
// about 2.1s worst case before the final error is rethrown. The cap keeps a request from
// hanging on a long backoff while still spanning a sync's write burst, which the previous
// 600ms budget did not. Non-transient errors rethrow immediately.
async function retryOnBusy<T>(run: () => Promise<T>): Promise<T> {
	let delay = INITIAL_DELAY_MS;
	for (let attempt = 1; ; attempt++) {
		try {
			return await run();
		} catch (error) {
			if (attempt >= MAX_ATTEMPTS || !isTransientError(error)) throw error;
			await new Promise((resolve) => setTimeout(resolve, delay));
			delay = Math.min(delay * 2, MAX_DELAY_MS);
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
