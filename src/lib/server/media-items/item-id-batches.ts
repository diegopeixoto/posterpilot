export const ITEM_ID_QUERY_BATCH_SIZE = 500;

/** Keep scoped `IN (...)` queries below conservative SQLite/libSQL parameter limits. */
export function batchItemIds(
	itemIds: readonly number[],
	batchSize = ITEM_ID_QUERY_BATCH_SIZE
): number[][] {
	if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
		throw new RangeError('batchSize must be a positive safe integer');
	}

	const batches: number[][] = [];
	for (let offset = 0; offset < itemIds.length; offset += batchSize) {
		batches.push(itemIds.slice(offset, offset + batchSize));
	}
	return batches;
}
