import {
	LibsqlError,
	type Client,
	type InArgs,
	type InStatement,
	type ResultSet,
	type Transaction,
	type TransactionMode
} from '@libsql/client';
import { isTransientError, retryOnBusy } from './busy-retry';

/**
 * Runs every interactive transaction on ONE long-lived connection, one transaction at a time.
 *
 * Why: the local `file:` client in @libsql/client (0.17.x) implements `transaction()` by
 * handing its current native connection to the transaction and lazily opening a new one, and
 * the transaction never closes the connection it was handed. Worse, even an explicit
 * `close()` does not release the native handles — the file descriptors, WAL-index mapping and
 * page cache are freed only when the garbage collector finalizes the small JS wrapper. Under
 * a library sync or cover discovery (one or more transactions per title) the collector barely
 * runs, so every per-transaction connection piled up: gigabytes of RSS and thousands of open
 * descriptors until the container hit its memory limit. (Finalizing a connection the stock
 * client handed off has also been seen to segfault the process.)
 *
 * Reusing a single connection removes that churn entirely. It costs no real concurrency:
 * Drizzle opens every transaction as `BEGIN IMMEDIATE` (a write transaction), and SQLite
 * already admits only one writer at a time — concurrent transactions used to wait on
 * SQLite's busy timeout, which blocks the whole event-loop thread, and now wait in this
 * in-process queue instead. Plain reads keep using the main client's connection and are not
 * queued.
 */

const BEGIN: Record<TransactionMode, string> = {
	write: 'BEGIN IMMEDIATE',
	read: 'BEGIN TRANSACTION READONLY',
	deferred: 'BEGIN DEFERRED'
};

/**
 * How long a transaction may wait for its turn before failing. Bounded so a transaction that
 * is accidentally opened from inside another one (which would wait on itself forever) fails
 * loudly instead of hanging the job.
 */
const DEFAULT_QUEUE_TIMEOUT_MS = 60_000;

type Finish = (connectionHealthy: boolean) => void;

/**
 * Applies per-connection settings (PRAGMAs such as `synchronous`) to a freshly opened
 * connection. SQLite keeps these per connection, so every open — including a reopen after
 * SQLITE_BUSY — must run it again.
 */
export type PrepareConnection = (connection: Client) => Promise<void>;

class LaneTransaction implements Transaction {
	#connection: Client;
	#finish: Finish;
	#closed = false;

	constructor(connection: Client, finish: Finish) {
		this.#connection = connection;
		this.#finish = finish;
	}

	get closed(): boolean {
		return this.#closed;
	}

	async execute(stmt: InStatement): Promise<ResultSet> {
		this.#assertOpen();
		return this.#connection.execute(stmt);
	}

	async batch(stmts: Array<InStatement>): Promise<Array<ResultSet>> {
		this.#assertOpen();
		// Statements run inside the already-open transaction. The connection's own batch()
		// would issue a nested BEGIN, which SQLite rejects.
		const results: ResultSet[] = [];
		for (const stmt of stmts) results.push(await this.#connection.execute(stmt));
		return results;
	}

	async executeMultiple(sql: string): Promise<void> {
		this.#assertOpen();
		return this.#connection.executeMultiple(sql);
	}

	async commit(): Promise<void> {
		this.#assertOpen();
		// A failed COMMIT (e.g. SQLITE_BUSY) leaves the transaction open so the caller's
		// rollback() still runs against it; that rollback is what hands the lane on.
		await this.#connection.execute('COMMIT');
		this.#end(true);
	}

	async rollback(): Promise<void> {
		if (this.#closed) return;
		let healthy = true;
		try {
			await this.#connection.execute('ROLLBACK');
		} catch {
			// SQLite may already have rolled back on its own (e.g. after SQLITE_FULL), making
			// ROLLBACK itself fail. Rethrowing would mask the error that caused the rollback;
			// instead the connection is retired, and closing it discards any open transaction.
			healthy = false;
		}
		this.#end(healthy);
	}

	close(): void {
		// close() is synchronous, so an unfinished transaction cannot be rolled back here;
		// retiring the connection rolls it back instead.
		if (!this.#closed) this.#end(false);
	}

	#end(connectionHealthy: boolean): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#finish(connectionHealthy);
	}

	#assertOpen(): void {
		if (this.#closed) {
			throw new LibsqlError('The transaction is closed', 'TRANSACTION_CLOSED');
		}
	}
}

export interface TransactionLane {
	/** Wait for the lane, then BEGIN; the returned transaction holds the lane until it ends. */
	begin(mode?: TransactionMode): Promise<Transaction>;
	/** Wait for the lane, run `fn` (a write on another connection), then hand the lane on. */
	exclusive<T>(fn: () => Promise<T>): Promise<T>;
	close(): void;
}

/** Error code for a caller that waited longer than the queue timeout. Not retried. */
export const LANE_TIMEOUT_CODE = 'TRANSACTION_QUEUE_TIMEOUT';

/**
 * A single reusable transaction connection with a FIFO queue in front of it. Transactions and
 * plain writes take turns through the same queue, so no two writers in this process ever meet
 * SQLite's write lock at the same time. The connection is opened on first use and replaced
 * only if a transaction leaves it in an unknown state.
 */
export function createTransactionLane(
	openConnection: () => Client,
	options: { queueTimeoutMs?: number; prepareConnection?: PrepareConnection } = {}
): TransactionLane {
	const queueTimeoutMs = options.queueTimeoutMs ?? DEFAULT_QUEUE_TIMEOUT_MS;
	const prepareConnection = options.prepareConnection;
	let connection: Client | null = null;

	/** The lane's connection, opening (and preparing) a fresh one when there is none. */
	async function ensureConnection(): Promise<Client> {
		if (connection) return connection;
		const opened = openConnection();
		try {
			await prepareConnection?.(opened);
		} catch (error) {
			opened.close();
			throw error;
		}
		connection = opened;
		return opened;
	}
	let tail: Promise<void> = Promise.resolve();

	function retire(): void {
		const retired = connection;
		connection = null;
		retired?.close();
	}

	/** Queue for a turn; resolves with the function that hands the lane on. */
	async function acquire(): Promise<() => void> {
		let release!: () => void;
		const turn = new Promise<void>((resolve) => (release = resolve));
		const previous = tail;
		tail = previous.then(() => turn);

		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(
				() =>
					reject(
						new LibsqlError(
							`waited ${queueTimeoutMs}ms for another database write to finish`,
							LANE_TIMEOUT_CODE
						)
					),
				queueTimeoutMs
			);
		});
		try {
			await Promise.race([previous, timeout]);
		} catch (error) {
			// Give up this turn, but only once the holder ahead finishes, so callers queued
			// behind this one keep their order instead of jumping ahead of it.
			void previous.then(release);
			throw error;
		} finally {
			clearTimeout(timer);
		}
		return release;
	}

	return {
		async begin(mode: TransactionMode = 'write'): Promise<Transaction> {
			const release = await acquire();
			let current: Client;
			try {
				current = await retryOnBusy(async () => {
					const candidate = await ensureConnection();
					try {
						await candidate.execute(BEGIN[mode]);
					} catch (error) {
						// libsql leaves a connection whose statement hit SQLITE_BUSY silently
						// discarding every later write, so never reuse one: reopen for the retry.
						// (Within this process the queue makes a busy BEGIN impossible; this only
						// guards against another process holding the lock.)
						if (isTransientError(error)) retire();
						throw error;
					}
					return candidate;
				});
			} catch (error) {
				release();
				throw error;
			}

			return new LaneTransaction(current, (connectionHealthy) => {
				if (!connectionHealthy) retire();
				release();
			});
		},
		async exclusive<T>(fn: () => Promise<T>): Promise<T> {
			const release = await acquire();
			try {
				return await fn();
			} finally {
				release();
			}
		},
		close(): void {
			retire();
		}
	};
}

/** True for statements that only read, which may run beside an open transaction in WAL mode. */
export function isReadOnlyStatement(stmt: InStatement): boolean {
	const text = typeof stmt === 'string' ? stmt : stmt.sql;
	return /^\s*select\b/i.test(text);
}

/**
 * Wrap a client so that:
 * - `transaction()` runs on a shared, reused connection (see above);
 * - every other write waits its turn in the same queue, so it can never collide with an open
 *   transaction (a collision used to busy-wait with the event loop frozen, and then, failing
 *   with SQLITE_BUSY, left the connection silently discarding later writes);
 * - reads (`SELECT`) run immediately — WAL lets them proceed beside the single writer;
 * - should a statement still hit SQLITE_BUSY (another process holding the lock), the
 *   connection is reopened before the error propagates, so the retry runs on a healthy one.
 *
 * `openConnection` must open the same database the client uses — a `file:` URL. (A plain
 * `:memory:` URL opens a different, empty database per connection, so leave such clients
 * unwrapped.)
 */
export function withDedicatedTransactions(
	client: Client,
	openConnection: () => Client,
	options: { prepareConnection?: PrepareConnection } = {}
): Client {
	const { prepareConnection } = options;
	const lane = createTransactionLane(openConnection, { prepareConnection });

	async function guarded<T>(run: () => Promise<T>): Promise<T> {
		try {
			return await run();
		} catch (error) {
			if (isTransientError(error)) {
				await client.reconnect();
				// Per-connection settings do not survive the reopen.
				await prepareConnection?.(client);
			}
			throw error;
		}
	}
	const write = <T>(run: () => Promise<T>): Promise<T> => lane.exclusive(() => guarded(run));

	return {
		execute: (stmtOrSql: InStatement, args?: InArgs): Promise<ResultSet> => {
			const run = () =>
				typeof stmtOrSql === 'string' ? client.execute(stmtOrSql, args) : client.execute(stmtOrSql);
			return isReadOnlyStatement(stmtOrSql) ? guarded(run) : write(run);
		},
		batch: (stmts: Array<InStatement | [string, InArgs?]>, mode?: TransactionMode) =>
			write(() => client.batch(stmts, mode)),
		migrate: (stmts: Array<InStatement>) => write(() => client.migrate(stmts)),
		transaction: (mode?: TransactionMode) => lane.begin(mode),
		executeMultiple: (sql: string) => write(() => client.executeMultiple(sql)),
		sync: () => client.sync(),
		close: () => {
			lane.close();
			client.close();
		},
		reconnect: () => client.reconnect(),
		get closed() {
			return client.closed;
		},
		get protocol() {
			return client.protocol;
		}
	};
}
