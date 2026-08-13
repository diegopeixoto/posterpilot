import { describe, expect, it, vi } from 'vitest';
import { checkDatabaseReadiness } from './readiness';

describe('database readiness', () => {
	it('reports a successful bounded query', async () => {
		const execute = vi.fn().mockResolvedValue({ rows: [{ ready: 1 }] });
		await expect(checkDatabaseReadiness({ execute } as never)).resolves.toMatchObject({
			status: 'ready'
		});
		expect(execute).toHaveBeenCalledWith('select 1 as ready');
	});

	it('maps query failures without exposing their message', async () => {
		const execute = vi.fn().mockRejectedValue(new Error('secret database path'));
		const onFailure = vi.fn();
		await expect(
			checkDatabaseReadiness({ execute } as never, undefined, onFailure)
		).resolves.toMatchObject({
			status: 'not_ready',
			reason: 'query_failed'
		});
		expect(onFailure).toHaveBeenCalledOnce();
	});

	it('times out without accumulating duplicate queries', async () => {
		let rejectQuery!: (error: Error) => void;
		const execute = vi.fn(
			() =>
				new Promise((_, reject) => {
					rejectQuery = reject;
				})
		);
		const client = { execute } as never;
		const first = checkDatabaseReadiness(client, 5);
		const second = checkDatabaseReadiness(client, 5);
		await expect(first).resolves.toMatchObject({
			status: 'not_ready',
			reason: 'timeout'
		});
		await expect(second).resolves.toMatchObject({ status: 'not_ready', reason: 'timeout' });
		expect(execute).toHaveBeenCalledTimes(1);
		rejectQuery(new Error('released'));
	});
});
