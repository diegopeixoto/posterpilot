import { describe, expect, it } from 'vitest';
import type { Client, InStatement, ResultSet, Transaction } from '@libsql/client';
import { createStatementCollector, withStatementCollection } from './statement-collection';

const ok = { rows: [] } as unknown as ResultSet;

function fakeClient(): Client {
	const tx = {
		execute: async () => ok,
		batch: async (stmts: InStatement[]) => stmts.map(() => ok),
		executeMultiple: async () => undefined,
		rollback: async () => undefined,
		commit: async () => undefined,
		close: () => undefined,
		closed: false
	} as unknown as Transaction;
	return {
		execute: async () => ok,
		batch: async (stmts: unknown[]) => stmts.map(() => ok),
		executeMultiple: async () => undefined,
		transaction: async () => tx
	} as unknown as Client;
}

describe('createStatementCollector', () => {
	it('collects once per budget of statements, then starts counting again', async () => {
		let collections = 0;
		const collector = createStatementCollector({
			every: 3,
			collect: () => {
				collections++;
				return true;
			}
		});
		for (let i = 0; i < 7; i++) await collector.note();
		expect(collections).toBe(2);
		await collector.note(5);
		expect(collections).toBe(3);
	});

	it('is a no-op where the runtime offers no collector', async () => {
		const collector = createStatementCollector({ every: 1 });
		await expect(collector.note()).resolves.toBeUndefined();
	});
});

describe('withStatementCollection', () => {
	it('counts plain statements, batches and statements inside transactions', async () => {
		let collections = 0;
		const collector = createStatementCollector({
			every: 4,
			collect: () => {
				collections++;
				return true;
			}
		});
		const client = withStatementCollection(fakeClient(), collector);

		await client.execute('select 1');
		await client.batch(['select 1', 'select 2']);
		expect(collections).toBe(0);
		const tx = await client.transaction('write');
		await tx.execute('insert into t values (1)');
		expect(collections).toBe(1);
		await tx.batch(['a', 'b', 'c', 'd']);
		expect(collections).toBe(2);
		await tx.commit();
	});

	it('passes results and errors through unchanged', async () => {
		const failing = {
			...fakeClient(),
			execute: async () => {
				throw new Error('boom');
			}
		} as unknown as Client;
		const collector = createStatementCollector({ every: 1, collect: () => false });
		await expect(withStatementCollection(fakeClient(), collector).execute('x')).resolves.toBe(ok);
		await expect(withStatementCollection(failing, collector).execute('x')).rejects.toThrow('boom');
	});
});
