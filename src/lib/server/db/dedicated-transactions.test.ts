import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type Client, type InStatement, type ResultSet } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTransactionLane, withDedicatedTransactions } from './dedicated-transactions';

let directory: string;
let url: string;
const clients: Client[] = [];

/** Opens real connections to the temp database and counts opens and closes. */
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
		get opened() {
			return opened;
		},
		get closed() {
			return closed;
		}
	};
}

/** A scripted connection: `respond` decides each statement's outcome. */
function fakeOpener(respond: (stmt: string) => Promise<ResultSet> = ok) {
	const statements: string[] = [];
	let opened = 0;
	let closed = 0;
	const open = (): Client => {
		opened++;
		return {
			execute: (stmt: InStatement) => {
				const text = typeof stmt === 'string' ? stmt : stmt.sql;
				statements.push(text);
				return respond(text);
			},
			close: () => {
				closed++;
			}
		} as unknown as Client;
	};
	return {
		open,
		statements,
		get opened() {
			return opened;
		},
		get closed() {
			return closed;
		}
	};
}

async function ok(): Promise<ResultSet> {
	return { rows: [] } as unknown as ResultSet;
}

async function countRows(): Promise<number> {
	const reader = createClient({ url });
	clients.push(reader);
	return Number((await reader.execute('SELECT count(*) AS n FROM t')).rows[0].n);
}

beforeEach(async () => {
	directory = mkdtempSync(join(tmpdir(), 'pp-tx-lane-'));
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
		// count opens and closes directly, so a leftover temp dir there is harmless.
	}
});

describe('createTransactionLane', () => {
	it('commits and rolls back on one connection that it keeps open and reuses', async () => {
		const opener = trackedOpener();
		const lane = createTransactionLane(opener.open);

		const first = await lane.begin();
		await first.execute({ sql: 'INSERT INTO t (v) VALUES (?)', args: ['kept'] });
		await first.commit();
		const second = await lane.begin();
		await second.batch([{ sql: 'INSERT INTO t (v) VALUES (?)', args: ['discarded'] }]);
		await second.rollback();

		expect(first.closed).toBe(true);
		expect(second.closed).toBe(true);
		expect(opener.opened).toBe(1);
		expect(opener.closed).toBe(0);
		expect(await countRows()).toBe(1);

		lane.close();
		expect(opener.closed).toBe(1);
	});

	it('queues a second transaction until the first finishes', async () => {
		const lane = createTransactionLane(trackedOpener().open);
		const order: string[] = [];

		const first = await lane.begin();
		const secondStarted = lane.begin().then((tx) => {
			order.push('second began');
			return tx;
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		order.push('first committing');
		await first.commit();
		const second = await secondStarted;
		await second.commit();

		expect(order).toEqual(['first committing', 'second began']);
		lane.close();
	});

	it('refuses statements once a transaction has finished', async () => {
		const lane = createTransactionLane(trackedOpener().open);
		const tx = await lane.begin();
		await tx.commit();
		await expect(tx.execute('SELECT 1')).rejects.toMatchObject({ code: 'TRANSACTION_CLOSED' });
		await expect(tx.commit()).rejects.toMatchObject({ code: 'TRANSACTION_CLOSED' });
		await expect(tx.rollback()).resolves.toBeUndefined();
		lane.close();
	});

	it('keeps the lane held after a failed COMMIT until rollback hands it on', async () => {
		const opener = fakeOpener(async (stmt) => {
			if (stmt === 'COMMIT') throw new Error('SQLITE_BUSY: database is locked');
			return ok();
		});
		const lane = createTransactionLane(opener.open);
		const tx = await lane.begin();

		await expect(tx.commit()).rejects.toThrow('database is locked');
		expect(tx.closed).toBe(false);
		let nextBegan = false;
		const next = lane.begin().then((t) => {
			nextBegan = true;
			return t;
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(nextBegan).toBe(false);

		await tx.rollback();
		await next;
		expect(nextBegan).toBe(true);
		expect(opener.opened).toBe(1);
	});

	it('retires the connection when ROLLBACK fails and opens a fresh one next time', async () => {
		let failRollback = true;
		const opener = fakeOpener(async (stmt) => {
			if (stmt === 'ROLLBACK' && failRollback) throw new Error('no transaction is active');
			return ok();
		});
		const lane = createTransactionLane(opener.open);

		const tx = await lane.begin();
		await expect(tx.rollback()).resolves.toBeUndefined();
		expect(opener.closed).toBe(1);

		failRollback = false;
		await (await lane.begin()).commit();
		expect(opener.opened).toBe(2);
	});

	it('retires the connection when a transaction is closed without finishing', async () => {
		const opener = fakeOpener();
		const lane = createTransactionLane(opener.open);
		const tx = await lane.begin();
		tx.close();
		expect(tx.closed).toBe(true);
		expect(opener.closed).toBe(1);
		await (await lane.begin()).commit();
		expect(opener.opened).toBe(2);
	});

	it('releases the lane and keeps the connection when BEGIN fails', async () => {
		let failBegin = true;
		const opener = fakeOpener(async (stmt) => {
			if (stmt.startsWith('BEGIN') && failBegin) throw new Error('SQLITE_BUSY: database is locked');
			return ok();
		});
		const lane = createTransactionLane(opener.open);

		await expect(lane.begin()).rejects.toThrow('locked');
		failBegin = false;
		await (await lane.begin()).commit();
		expect(opener.opened).toBe(1);
		expect(opener.closed).toBe(0);
	});

	it('fails a transaction that waits too long, without stalling the queue', async () => {
		const opener = fakeOpener();
		const lane = createTransactionLane(opener.open, { queueTimeoutMs: 30 });

		const holder = await lane.begin();
		await expect(lane.begin()).rejects.toMatchObject({ code: 'SQLITE_BUSY' });
		await holder.commit();
		await expect(lane.begin().then((tx) => tx.commit())).resolves.toBeUndefined();
	});

	it('uses the BEGIN statement that matches the mode', async () => {
		const opener = fakeOpener();
		const lane = createTransactionLane(opener.open);
		for (const mode of ['write', 'read', 'deferred'] as const) {
			await (await lane.begin(mode)).commit();
		}
		expect(opener.statements.filter((s) => s.startsWith('BEGIN'))).toEqual([
			'BEGIN IMMEDIATE',
			'BEGIN TRANSACTION READONLY',
			'BEGIN DEFERRED'
		]);
	});
});

describe('withDedicatedTransactions under drizzle', () => {
	it('runs many sequential and concurrent transactions on a single connection', async () => {
		const opener = trackedOpener();
		const base = createClient({ url });
		clients.push(base);
		const client = withDedicatedTransactions(base, opener.open);
		const db = drizzle(client);

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
		// Concurrent write transactions used to race for SQLite's single write lock; they
		// now take turns on the shared connection and all succeed.
		await Promise.all(
			Array.from({ length: 20 }, (_, i) =>
				db.transaction(async (tx) => {
					await tx.run(sql`INSERT INTO t (v) VALUES (${`concurrent-${i}`})`);
				})
			)
		);

		expect(opener.opened).toBe(1);
		expect(opener.closed).toBe(0);
		expect(await countRows()).toBe(70);

		client.close();
		expect(opener.closed).toBe(1);
	});
});
