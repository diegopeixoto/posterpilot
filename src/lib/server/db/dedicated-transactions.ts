import {
	LibsqlError,
	type Client,
	type InArgs,
	type InStatement,
	type ResultSet,
	type Transaction,
	type TransactionMode
} from '@libsql/client';

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
 * already admits only one writer at a time — concurrent transactions used to wait on the
 * busy timeout, and now wait in this in-process queue instead. Plain reads keep using the
 * main client's connection and are not queued.
 */

const BEGIN: Record<TransactionMode, string> = {
	write: 'BEGIN IMMEDIATE',
	read: 'BEGIN TRANSACTION READONLY',
	deferred: 'BEGIN DEFERRED'
};

/**
 * How long a transaction may wait for its turn before failing. Bounded so a transaction that
 * is accidentally opened from inside another one (which would wait on itself forever) fails
 * loudly instead of hanging the job; generous compared with the 5s busy timeout it replaces.
 */
const DEFAULT_QUEUE_TIMEOUT_MS = 60_000;

type Finish = (connectionHealthy: boolean) => void;

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
	begin(mode?: TransactionMode): Promise<Transaction>;
	close(): void;
}

/**
 * A single reusable transaction connection with a FIFO queue in front of it. The connection
 * is opened on first use and replaced only if a transaction leaves it in an unknown state.
 */
export function createTransactionLane(
	openConnection: () => Client,
	options: { queueTimeoutMs?: number } = {}
): TransactionLane {
	const queueTimeoutMs = options.queueTimeoutMs ?? DEFAULT_QUEUE_TIMEOUT_MS;
	let connection: Client | null = null;
	let tail: Promise<void> = Promise.resolve();

	function retire(): void {
		const retired = connection;
		connection = null;
		retired?.close();
	}

	async function waitForTurn(previous: Promise<void>): Promise<void> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(
				() =>
					reject(
						new LibsqlError(
							`SQLITE_BUSY: waited ${queueTimeoutMs}ms for another transaction to finish`,
							'SQLITE_BUSY'
						)
					),
				queueTimeoutMs
			);
		});
		try {
			await Promise.race([previous, timeout]);
		} finally {
			clearTimeout(timer);
		}
	}

	return {
		async begin(mode: TransactionMode = 'write'): Promise<Transaction> {
			let release!: () => void;
			const turn = new Promise<void>((resolve) => (release = resolve));
			const previous = tail;
			tail = previous.then(() => turn);

			try {
				await waitForTurn(previous);
			} catch (error) {
				// Give up this turn, but only once the transaction ahead finishes, so callers
				// queued behind this one keep their order instead of jumping ahead of it.
				void previous.then(release);
				throw error;
			}

			try {
				connection ??= openConnection();
				await connection.execute(BEGIN[mode]);
			} catch (error) {
				// A failed BEGIN (typically SQLITE_BUSY) opens no transaction, so the connection
				// stays usable. Retiring it would only bring back the churn this module removes.
				release();
				throw error;
			}

			return new LaneTransaction(connection, (connectionHealthy) => {
				if (!connectionHealthy) retire();
				release();
			});
		},
		close(): void {
			retire();
		}
	};
}

/**
 * Wrap a client so `transaction()` runs on a shared, reused connection (see above).
 * `openConnection` must open the same database the client uses — a `file:` URL. (A plain
 * `:memory:` URL opens a different, empty database per connection, so leave such clients
 * unwrapped.) Every other member delegates untouched.
 */
export function withDedicatedTransactions(client: Client, openConnection: () => Client): Client {
	const lane = createTransactionLane(openConnection);
	return {
		execute: (stmtOrSql: InStatement, args?: InArgs): Promise<ResultSet> =>
			typeof stmtOrSql === 'string' ? client.execute(stmtOrSql, args) : client.execute(stmtOrSql),
		batch: (stmts: Array<InStatement | [string, InArgs?]>, mode?: TransactionMode) =>
			client.batch(stmts, mode),
		migrate: (stmts: Array<InStatement>) => client.migrate(stmts),
		transaction: (mode?: TransactionMode) => lane.begin(mode),
		executeMultiple: (sql: string) => client.executeMultiple(sql),
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
