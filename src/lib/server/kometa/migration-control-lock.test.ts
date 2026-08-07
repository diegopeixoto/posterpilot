import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as schema from '$lib/server/db/schema';
import {
	assertKometaMigrationControlLease,
	createKometaMigrationControlLock
} from './migration-control-lock';

vi.mock('$lib/server/db', async () => {
	const { createClient } = await import('@libsql/client');
	const { drizzle } = await import('drizzle-orm/libsql');
	const schema = await import('$lib/server/db/schema');
	const client = createClient({ url: ':memory:' });
	await client.execute(
		`CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)`
	);
	return { db: drizzle(client, { schema }), migrateDb: async () => undefined };
});

let directory: string;
let clientA: Client;
let clientB: Client;
let databaseA: LibSQLDatabase<typeof schema>;
let databaseB: LibSQLDatabase<typeof schema>;

beforeAll(async () => {
	directory = mkdtempSync(join(tmpdir(), 'posterpilot-kometa-control-lock-'));
	const url = `file:${join(directory, 'shared.db')}`;
	clientA = createClient({ url });
	clientB = createClient({ url });
	await clientA.execute(
		`CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)`
	);
	databaseA = drizzle(clientA, { schema });
	databaseB = drizzle(clientB, { schema });
});

afterAll(() => {
	clientA.close();
	clientB.close();
	rmSync(directory, { recursive: true, force: true });
});

describe('Kometa migration control lock', () => {
	it('serializes independent app-process queues through the shared database row', async () => {
		const lockA = createKometaMigrationControlLock(databaseA, {
			leaseMs: 2_000,
			pollIntervalMs: 5,
			owner: () => 'process-a'
		});
		const lockB = createKometaMigrationControlLock(databaseB, {
			leaseMs: 2_000,
			pollIntervalMs: 5,
			owner: () => 'process-b'
		});
		const order: string[] = [];
		let releaseA!: () => void;
		let enteredA!: () => void;
		const entered = new Promise<void>((resolve) => {
			enteredA = resolve;
		});
		const release = new Promise<void>((resolve) => {
			releaseA = resolve;
		});

		const first = lockA(async () => {
			order.push('a:enter');
			enteredA();
			await release;
			order.push('a:exit');
		});
		await entered;
		const second = lockB(async () => {
			order.push('b:enter');
		});

		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(order).toEqual(['a:enter']);
		releaseA();
		await Promise.all([first, second]);
		expect(order).toEqual(['a:enter', 'a:exit', 'b:enter']);
	});

	it('keeps one stable fencing token while heartbeat renews its expiry', async () => {
		const lock = createKometaMigrationControlLock(databaseA, {
			leaseMs: 1_000,
			pollIntervalMs: 5,
			owner: () => 'stable-token-process'
		});

		await lock(async (assertOwned) => {
			const beforeHeartbeat = await assertOwned();
			await new Promise((resolve) => setTimeout(resolve, 400));
			const afterHeartbeat = await assertOwned();
			expect(afterHeartbeat).toBe(beforeHeartbeat);
			await expect(
				assertKometaMigrationControlLease(databaseB, beforeHeartbeat)
			).resolves.toBeUndefined();
		});
	});
});
