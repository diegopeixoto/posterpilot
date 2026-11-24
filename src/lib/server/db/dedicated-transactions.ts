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
 * Gives every interactive transaction its own native SQLite connection and closes that
 * connection the moment the transaction commits or rolls back.
 *
 * Why this exists: the local `file:` client in @libsql/client (0.17.x) implements
 * `transaction()` by handing its current native connection to the transaction, setting its
 * own handle to `null`, and lazily opening a new one on the next call. The transaction's
 * `commit()`/`rollback()` never close that handed-off connection — it is released only when
 * the garbage collector finalizes the small JS wrapper, which under steady load is "much
 * later or never". Each leaked connection keeps a file descriptor, a mapping of the WAL index
 * and its own page cache, so a library sync or discovery run (one transaction per title)
 * grew the container by gigabytes that were never returned. Drizzle's libsql driver calls
 * only `commit()` or `rollback()` — never `close()` — so the fix has to close on both.
 *
 * Owning the connection here also means the client's `timeout` (busy timeout) is applied to
 * every transaction connection, because each one is opened through `createClient`.
 */

const BEGIN: Record<TransactionMode, string> = {
	write: 'BEGIN IMMEDIATE',
	read: 'BEGIN TRANSACTION READONLY',
	deferred: 'BEGIN DEFERRED'
};

class DedicatedTransaction implements Transaction {
	#connection: Client;
	#closed = false;

	constructor(connection: Client) {
		this.#connection = connection;
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
		// rollback() still runs against it; that rollback is what closes the connection.
		await this.#connection.execute('COMMIT');
		this.close();
	}

	async rollback(): Promise<void> {
		if (this.#closed) return;
		try {
			await this.#connection.execute('ROLLBACK');
		} catch {
			// SQLite may already have rolled back on its own (e.g. after SQLITE_FULL), making
			// ROLLBACK itself fail. Closing the connection discards any open transaction
			// anyway, and rethrowing here would mask the error that caused the rollback.
		} finally {
			this.close();
		}
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		// Closing a SQLite connection rolls back any transaction still open on it.
		this.#connection.close();
	}

	#assertOpen(): void {
		if (this.#closed) {
			throw new LibsqlError('The transaction is closed', 'TRANSACTION_CLOSED');
		}
	}
}

/** Begin a transaction on a freshly opened connection that the transaction owns. */
export async function openDedicatedTransaction(
	openConnection: () => Client,
	mode: TransactionMode = 'write'
): Promise<Transaction> {
	const connection = openConnection();
	try {
		await connection.execute(BEGIN[mode]);
	} catch (error) {
		connection.close();
		throw error;
	}
	return new DedicatedTransaction(connection);
}

/**
 * Wrap a client so `transaction()` uses a dedicated, reliably closed connection.
 * `openConnection` must open the same database the client uses — a `file:` URL. (A plain
 * `:memory:` URL opens a different, empty database per connection, so leave such clients
 * unwrapped.) Every other member delegates untouched.
 */
export function withDedicatedTransactions(client: Client, openConnection: () => Client): Client {
	return {
		execute: (stmtOrSql: InStatement, args?: InArgs): Promise<ResultSet> =>
			typeof stmtOrSql === 'string' ? client.execute(stmtOrSql, args) : client.execute(stmtOrSql),
		batch: (stmts: Array<InStatement | [string, InArgs?]>, mode?: TransactionMode) =>
			client.batch(stmts, mode),
		migrate: (stmts: Array<InStatement>) => client.migrate(stmts),
		transaction: (mode?: TransactionMode) => openDedicatedTransaction(openConnection, mode),
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
