import { describe, expect, it } from 'vitest';
import { serializeWrite } from './write-queue';

describe('serializeWrite', () => {
	it('runs writes in submission order even when an earlier write is slower', async () => {
		const order: string[] = [];
		const slow = serializeWrite(async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
			order.push('slow');
			return 'slow';
		});
		const fast = serializeWrite(async () => {
			order.push('fast');
			return 'fast';
		});
		await expect(Promise.all([slow, fast])).resolves.toEqual(['slow', 'fast']);
		expect(order).toEqual(['slow', 'fast']);
	});

	it('keeps the queue moving after a failed write', async () => {
		const failed = serializeWrite(async () => {
			throw new Error('write failed');
		});
		const next = serializeWrite(async () => 'ok');
		await expect(failed).rejects.toThrow('write failed');
		await expect(next).resolves.toBe('ok');
	});
});
