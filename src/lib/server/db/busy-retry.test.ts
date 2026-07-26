import { describe, expect, it } from 'vitest';
import type { Client, ResultSet } from '@libsql/client';
import { withBusyRetry } from './busy-retry';

function busyError(): Error {
	const error = new Error('SQLITE_BUSY: database is locked');
	(error as Error & { code: string }).code = 'SQLITE_BUSY';
	return error;
}

function fakeClient(overrides: Partial<Client>): Client {
	return overrides as Client;
}

describe('withBusyRetry', () => {
	it('retries a busy execute and resolves once the lock clears', async () => {
		let calls = 0;
		const client = withBusyRetry(
			fakeClient({
				execute: async () => {
					calls++;
					if (calls < 3) throw busyError();
					return { rows: [] } as unknown as ResultSet;
				}
			})
		);
		await expect(client.execute('select 1')).resolves.toEqual({ rows: [] });
		expect(calls).toBe(3);
	});

	it('falls back to the "database is locked" message when the error has no code', async () => {
		let calls = 0;
		const client = withBusyRetry(
			fakeClient({
				execute: async () => {
					calls++;
					if (calls < 2) throw new Error('database is locked');
					return {} as ResultSet;
				}
			})
		);
		await expect(client.execute('select 1')).resolves.toEqual({});
		expect(calls).toBe(2);
	});

	it('rethrows a non-busy error immediately without retrying', async () => {
		let calls = 0;
		const client = withBusyRetry(
			fakeClient({
				execute: async () => {
					calls++;
					throw new Error('no such table: jobs');
				}
			})
		);
		await expect(client.execute('select 1')).rejects.toThrow('no such table: jobs');
		expect(calls).toBe(1);
	});

	it('rethrows the busy error after exhausting all attempts', async () => {
		let calls = 0;
		const client = withBusyRetry(
			fakeClient({
				execute: async () => {
					calls++;
					throw busyError();
				}
			})
		);
		await expect(client.execute('select 1')).rejects.toThrow('database is locked');
		expect(calls).toBe(5);
	});

	it('retries a busy batch too', async () => {
		let calls = 0;
		const client = withBusyRetry(
			fakeClient({
				batch: async () => {
					calls++;
					if (calls < 2) throw busyError();
					return [] as ResultSet[];
				}
			})
		);
		await expect(client.batch(['select 1'])).resolves.toEqual([]);
		expect(calls).toBe(2);
	});

	it('leaves transaction() unwrapped — a busy transaction fails through on the first try', async () => {
		let calls = 0;
		const client = withBusyRetry(
			fakeClient({
				transaction: async () => {
					calls++;
					throw busyError();
				}
			})
		);
		await expect(client.transaction()).rejects.toThrow('database is locked');
		expect(calls).toBe(1);
	});
});
