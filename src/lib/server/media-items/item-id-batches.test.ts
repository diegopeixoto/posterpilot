import { describe, expect, it } from 'vitest';
import { batchItemIds, ITEM_ID_QUERY_BATCH_SIZE } from './item-id-batches';

describe('batchItemIds', () => {
	it('keeps large item scopes within the query parameter budget', () => {
		const ids = Array.from({ length: ITEM_ID_QUERY_BATCH_SIZE * 2 + 17 }, (_, index) => index + 1);

		const batches = batchItemIds(ids);

		expect(batches.map((batch) => batch.length)).toEqual([500, 500, 17]);
		expect(batches.flat()).toEqual(ids);
	});

	it('returns no query batches for an empty scope', () => {
		expect(batchItemIds([])).toEqual([]);
	});

	it('rejects invalid batch sizes', () => {
		expect(() => batchItemIds([1], 0)).toThrow(RangeError);
		expect(() => batchItemIds([1], Number.POSITIVE_INFINITY)).toThrow(RangeError);
	});
});
