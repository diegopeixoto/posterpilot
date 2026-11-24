import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type Client, type ResultSet } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDedicatedTransaction, withDedicatedTransactions } from './dedicated-transactions';

let directory: string;
let url: string;
const clients: Client[] = [];

/** Opens real connections to the temp database and records how many are still open. */
function trackedOpener() {
	let opened = 0;
	let closed = 0;
	const open = (): Client => {
		const client = createClient({ url, timeout: 5000 });
		clients.push(client);
		opened++;
		const close = client.close.bind(client);
		client.close = () => {
			closed++;
			close();
		};
		return client;
	};
	return {
		open,
		get stillOpen() {
			return opened - closed;
		},
		get opened() {
			return opened;
		}
	};
}

function fakeConnection(execute: (sql: string) => Promise<ResultSet>) {
	let closeCalls = 0;
	const connection = {
		execute: (stmt: string) => execute(stmt),
		close: () => {
			closeCalls++;
		}
	} as unknown as Client;
	return {
		connection,
		get closeCalls() {
			return closeCalls;
		}
	};
}

const ok = async () => ({ rows: [] }) as unknown as ResultSet;

beforeEach(async () => {
	directory = mkdtempSync(join(tmpdir(), 'pp-dedicated-tx-'));
	url = `file:${join(directory, 'test.db')}`;
	const setup = createClient({ url });
	clients.push(setup);
	await setup.execute('PRAGMA journal_mode = WAL');
	await setup.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
});

afterEach(() => {
	for (const client of clients.splice(0)) {
		if (!client.closed) client.close();
	}
	try {
		rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
	} catch {
		// Windows can keep a just-closed SQLite file locked briefly (EPERM); the assertions
		// above count closes directly, so a leftover temp dir there is harmless.
	}
});

describe('openDedicatedTransaction', () => {
	it('commits through its own connection and closes it', async () => {
		const opener = trackedOpener();
		const tx = await openDedicatedTransaction(opener.open);
		await tx.execute({ sql: 'INSERT INTO t (v) VALUES (?)', args: ['a'] });
		expect(opener.stillOpen).toBe(1);
		await tx.commit();

		expect(tx.closed).toBe(true);
		expect(opener.stillOpen).toBe(0);
		const reader = createClient({ url });
		clients.push(reader);
		expect((await reader.execute('SELECT v FROM t')).rows.map((r) => r.v)).toEqual(['a']);
	});

	it('rolls back, discards the writes and closes the connection', async () => {
		const opener = trackedOpener();
		const tx = await openDedicatedTransaction(opener.open);
		await tx.batch([{ sql: 'INSERT INTO t (v) VALUES (?)', args: ['b'] }]);
		await tx.rollback();

		expect(tx.closed).toBe(true);
		expect(opener.stillOpen).toBe(0);
		const reader = createClient({ url });
		clients.push(reader);
		expect((await reader.execute('SELECT count(*) AS n FROM t')).rows[0].n).toBe(0);
	});

	it('refuses statements once the transaction has finished', async () => {
		const tx = await openDedicatedTransaction(trackedOpener().open);
		await tx.commit();
		await expect(tx.execute('SELECT 1')).rejects.toMatchObject({ code: 'TRANSACTION_CLOSED' });
		await expect(tx.commit()).rejects.toMatchObject({ code: 'TRANSACTION_CLOSED' });
		await expect(tx.rollback()).resolves.toBeUndefined();
	});

	it('keeps the transaction open after a failed COMMIT so rollback can close it', async () => {
		const fake = fakeConnection(async (stmt) => {
			if (stmt === 'COMMIT') throw new Error('SQLITE_BUSY: database is locked');
			return ok();
		});
		const tx = await openDedicatedTransaction(() => fake.connection);

		await expect(tx.commit()).rejects.toThrow('database is locked');
		expect(tx.closed).toBe(false);
		expect(fake.closeCalls).toBe(0);

		await tx.rollback();
		expect(tx.closed).toBe(true);
		expect(fake.closeCalls).toBe(1);
	});

	it('swallows a failing ROLLBACK and still closes the connection', async () => {
		const fake = fakeConnection(async (stmt) => {
			if (stmt === 'ROLLBACK') throw new Error('cannot rollback - no transaction is active');
			return ok();
		});
		const tx = await openDedicatedTransaction(() => fake.connection);

		await expect(tx.rollback()).resolves.toBeUndefined();
		expect(fake.closeCalls).toBe(1);
	});

	it('closes the connection when BEGIN itself fails', async () => {
		const fake = fakeConnection(async () => {
			throw new Error('SQLITE_BUSY: database is locked');
		});
		await expect(openDedicatedTransaction(() => fake.connection)).rejects.toThrow('locked');
		expect(fake.closeCalls).toBe(1);
	});

	it('uses the BEGIN statement that matches the mode', async () => {
		const seen: string[] = [];
		for (const mode of ['write', 'read', 'deferred'] as const) {
			const fake = fakeConnection(async (stmt) => {
				seen.push(stmt);
				return ok();
			});
			await openDedicatedTransaction(() => fake.connection, mode);
		}
		expect(seen).toEqual(['BEGIN IMMEDIATE', 'BEGIN TRANSACTION READONLY', 'BEGIN DEFERRED']);
	});
});

describe('withDedicatedTransactions under drizzle', () => {
	it('leaves no connection open after many committed and rolled-back transactions', async () => {
		const opener = trackedOpener();
		const base = createClient({ url });
		clients.push(base);
		const db = drizzle(withDedicatedTransactions(base, opener.open));

		for (let i = 0; i < 50; i++) {
			await db.transaction(async (tx) => {
				await tx.run(sql`INSERT INTO t (v) VALUES (${`row-${i}`})`);
			});
		}
		for (let i = 0; i < 10; i++) {
			await expect(
				db.transaction(async (tx) => {
					await tx.run(sql`INSERT INTO t (v) VALUES ('discarded')`);
					throw new Error('abort');
				})
			).rejects.toThrow('abort');
		}

		expect(opener.opened).toBe(60);
		expect(opener.stillOpen).toBe(0);
		const rows = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM t`);
		expect(rows[0].n).toBe(50);
	});
});
