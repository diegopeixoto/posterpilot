import type {
	Client,
	InArgs,
	InStatement,
	ResultSet,
	Transaction,
	TransactionMode
} from '@libsql/client';

/**
 * Keeps libsql's native prepared statements from piling up.
 *
 * The local libsql client prepares a fresh native statement for every query and never
 * finalizes it; the statement — a few KB of native memory — is freed only when the garbage
 * collector finalizes its small JS wrapper. Those wrappers put almost no pressure on the
 * JS heap, so collection rarely runs while a sync issues tens of thousands of queries:
 * measured locally, 120,000 statements grew the process by ~550 MB with a 16 MB heap, and
 * on a 3,400-item library a sync left the server at ~1.6 GB (the heap itself back to 11 MB).
 *
 * Every `every` statements this runs a full collection and yields one macrotask — native
 * finalizers run on a later event-loop turn, so collecting without yielding frees nothing.
 * With it the same 120,000 statements stayed under 100 MB, at ~2 ms per collection.
 */

const DEFAULT_EVERY = 5_000;

export interface StatementCollector {
	/** Count `statements` just run; collects (and yields) once the budget is used up. */
	note(statements?: number): Promise<void>;
}

/** Full, synchronous collection where the runtime offers one (Bun); otherwise a no-op. */
function runtimeCollect(): boolean {
	const bun = (globalThis as { Bun?: { gc?: (force: boolean) => void } }).Bun;
	if (typeof bun?.gc !== 'function') return false;
	bun.gc(true);
	return true;
}

const yieldMacrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export function createStatementCollector(
	options: { every?: number; collect?: () => boolean } = {}
): StatementCollector {
	const every = options.every ?? DEFAULT_EVERY;
	const collect = options.collect ?? runtimeCollect;
	let sinceCollection = 0;
	return {
		async note(statements = 1) {
			sinceCollection += statements;
			if (sinceCollection < every) return;
			sinceCollection = 0;
			if (collect()) await yieldMacrotask();
		}
	};
}

/** Wrap a transaction so its statements count toward the collector too. */
function countedTransaction(tx: Transaction, collector: StatementCollector): Transaction {
	return {
		execute: async (stmt: InStatement) => {
			const result = await tx.execute(stmt);
			await collector.note();
			return result;
		},
		batch: async (stmts: Array<InStatement>) => {
			const results = await tx.batch(stmts);
			await collector.note(stmts.length);
			return results;
		},
		executeMultiple: async (sql: string) => {
			await tx.executeMultiple(sql);
			await collector.note();
		},
		rollback: () => tx.rollback(),
		commit: () => tx.commit(),
		close: () => tx.close(),
		get closed() {
			return tx.closed;
		}
	};
}

/** Wrap a client so every statement it runs (including inside transactions) is counted. */
export function withStatementCollection(client: Client, collector: StatementCollector): Client {
	return {
		execute: async (stmtOrSql: InStatement, args?: InArgs): Promise<ResultSet> => {
			const result =
				typeof stmtOrSql === 'string'
					? await client.execute(stmtOrSql, args)
					: await client.execute(stmtOrSql);
			await collector.note();
			return result;
		},
		batch: async (stmts: Array<InStatement | [string, InArgs?]>, mode?: TransactionMode) => {
			const results = await client.batch(stmts, mode);
			await collector.note(stmts.length);
			return results;
		},
		migrate: (stmts: Array<InStatement>) => client.migrate(stmts),
		transaction: async (mode?: TransactionMode) =>
			countedTransaction(await client.transaction(mode), collector),
		executeMultiple: async (sql: string) => {
			await client.executeMultiple(sql);
			await collector.note();
		},
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
