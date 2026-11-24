import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type Client, type InStatement, type ResultSet } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isTransientError, withBusyRetry } from './busy-retry';
import {
	LANE_TIMEOUT_CODE,
	createTransactionLane,
	isReadOnlyStatement,
	withDedicatedTransactions
} from './dedicated-transactions';

let directory: string;
let url: string;
const clients: Client[] = [];

/** Opens real connections to the temp database and counts opens and closes. */
function trackedOpener() {
	let opened = 0;
	let closed = 0;
	const open = (): Client => {
		// No busy timeout, matching production (see db/index.ts).
		const client = createClient({ url });
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
			if (stmt.startsWith('BEGIN') && failBegin) throw new Error('disk I/O error');
			return ok();
		});
		const lane = createTransactionLane(opener.open);

		await expect(lane.begin()).rejects.toThrow('disk I/O error');
		failBegin = false;
		await (await lane.begin()).commit();
		expect(opener.opened).toBe(1);
		expect(opener.closed).toBe(0);
	});

	it('retries a BEGIN that finds the write lock held, without blocking', async () => {
		let busyBegins = 2;
		const opener = fakeOpener(async (stmt) => {
			if (stmt.startsWith('BEGIN') && busyBegins-- > 0) {
				throw Object.assign(new Error('SQLITE_BUSY: database is locked'), {
					code: 'SQLITE_BUSY'
				});
			}
			return ok();
		});
		const lane = createTransactionLane(opener.open);

		await (await lane.begin()).commit();
		expect(opener.statements.filter((s) => s.startsWith('BEGIN'))).toHaveLength(3);
	});

	it('fails a transaction that waits too long, without stalling the queue', async () => {
		const opener = fakeOpener();
		const lane = createTransactionLane(opener.open, { queueTimeoutMs: 30 });

		const holder = await lane.begin();
		await expect(lane.begin()).rejects.toMatchObject({ code: LANE_TIMEOUT_CODE });
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

describe('writes that collide with an open transaction', () => {
	it('wait without freezing the event loop and land once the transaction commits', async () => {
		// The production stack: busy retry over the transaction lane, no busy timeout.
		const base = createClient({ url });
		clients.push(base);
		const client = withBusyRetry(withDedicatedTransactions(base, trackedOpener().open));

		const tx = await client.transaction('write');
		await tx.execute({ sql: 'INSERT INTO t (v) VALUES (?)', args: ['in-transaction'] });

		// A plain write (like the job heartbeat) arrives while the write lock is held.
		const plainWrite = client.execute({ sql: 'INSERT INTO t (v) VALUES (?)', args: ['plain'] });

		// The event loop keeps turning while that write waits: a timer still fires.
		const ticked = await new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 100));
		expect(ticked).toBe(true);

		await tx.commit();
		await expect(plainWrite).resolves.toBeDefined();
		expect(await countRows()).toBe(2);

		// And the connection that queued keeps persisting writes afterwards. (A connection
		// whose statement hits SQLITE_BUSY silently discards every later write in libsql.)
		await client.execute({ sql: 'INSERT INTO t (v) VALUES (?)', args: ['later'] });
		expect(await countRows()).toBe(3);
		client.close();
	});

	it('recovers a connection that hit SQLITE_BUSY from an outside writer', async () => {
		const base = createClient({ url });
		clients.push(base);
		const client = withDedicatedTransactions(base, trackedOpener().open);
		// Another process (outside the queue) holds the write lock.
		const outsider = createClient({ url });
		clients.push(outsider);
		await outsider.execute('BEGIN IMMEDIATE');

		await expect(
			client.execute({ sql: 'INSERT INTO t (v) VALUES (?)', args: ['collided'] })
		).rejects.toMatchObject({ code: 'SQLITE_BUSY' });
		await outsider.execute('COMMIT');

		// Without the reconnect, libsql leaves the collided statement un-reset, which keeps an
		// implicit transaction open: a later write with different SQL reports success but is
		// never committed.
		await client.execute("INSERT INTO t (v) VALUES ('later')");
		expect(await countRows()).toBe(1);
		client.close();
	});

	it('lets reads run beside an open transaction without queueing', async () => {
		const base = createClient({ url });
		clients.push(base);
		const client = withDedicatedTransactions(base, trackedOpener().open);

		const tx = await client.transaction('write');
		await tx.execute({ sql: 'INSERT INTO t (v) VALUES (?)', args: ['pending'] });
		// Resolves while the transaction is still open, and sees only committed data.
		const rows = await client.execute('SELECT count(*) AS n FROM t');
		expect(Number(rows.rows[0].n)).toBe(0);
		await tx.commit();
		client.close();
	});

	it('fails a write that waits past the queue timeout with a code the retry layer skips', async () => {
		const opener = fakeOpener();
		const lane = createTransactionLane(opener.open, { queueTimeoutMs: 30 });
		const holder = await lane.begin();
		await expect(lane.exclusive(async () => 'never')).rejects.toMatchObject({
			code: LANE_TIMEOUT_CODE
		});
		expect(isTransientError(Object.assign(new Error('x'), { code: LANE_TIMEOUT_CODE }))).toBe(
			false
		);
		await holder.commit();
	});
});

describe('isReadOnlyStatement', () => {
	it('treats only SELECT statements as reads', () => {
		expect(isReadOnlyStatement('select 1')).toBe(true);
		expect(isReadOnlyStatement({ sql: '  SELECT * FROM t', args: [] })).toBe(true);
		expect(isReadOnlyStatement('insert into t values (1)')).toBe(false);
		expect(isReadOnlyStatement('PRAGMA wal_checkpoint(FULL)')).toBe(false);
		expect(isReadOnlyStatement('selective_update()')).toBe(false);
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

describe('per-connection preparation', () => {
	const prepare = async (connection: Client) => {
		await connection.execute('PRAGMA synchronous = NORMAL');
	};

	it('prepares the transaction connection once, before its first BEGIN, and again on reopen', async () => {
		let failRollback = true;
		const opener = fakeOpener(async (stmt) => {
			if (stmt === 'ROLLBACK' && failRollback) throw new Error('no transaction is active');
			return ok();
		});
		const lane = createTransactionLane(opener.open, { prepareConnection: prepare });

		await (await lane.begin()).commit();
		await (await lane.begin()).commit();
		expect(opener.statements.slice(0, 2)).toEqual([
			'PRAGMA synchronous = NORMAL',
			'BEGIN IMMEDIATE'
		]);
		expect(opener.statements.filter((s) => s.startsWith('PRAGMA'))).toHaveLength(1);

		// A failed ROLLBACK retires the connection; its replacement is prepared too.
		await (await lane.begin()).rollback();
		failRollback = false;
		await (await lane.begin()).commit();
		expect(opener.opened).toBe(2);
		expect(opener.statements.filter((s) => s.startsWith('PRAGMA'))).toHaveLength(2);
	});

	it('re-prepares the main connection after reopening it for SQLITE_BUSY', async () => {
		const base = createClient({ url });
		clients.push(base);
		await prepare(base);
		const client = withDedicatedTransactions(base, trackedOpener().open, {
			prepareConnection: prepare
		});
		const outsider = createClient({ url });
		clients.push(outsider);
		await outsider.execute('BEGIN IMMEDIATE');
		await expect(
			client.execute({ sql: 'INSERT INTO t (v) VALUES (?)', args: ['collided'] })
		).rejects.toMatchObject({ code: 'SQLITE_BUSY' });
		await outsider.execute('COMMIT');

		// 1 = NORMAL; a reopened connection without preparation would read back 2 (FULL).
		const setting = await client.execute('PRAGMA synchronous');
		expect(Number(Object.values(setting.rows[0])[0])).toBe(1);
		client.close();
	});
});
