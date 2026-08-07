import { and, eq, inArray } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import { mediaItems, type MediaItem } from '$lib/server/db/schema';
import { batchItemIds } from './item-id-batches';

type Database = LibSQLDatabase<typeof schema>;
type ReadExecutor = Pick<Database, 'select'>;

export class MediaItemScopeMismatchError extends Error {
	constructor() {
		super('media_item_scope_mismatch');
		this.name = 'MediaItemScopeMismatchError';
	}
}

/**
 * Load an exact item-id scope without exceeding SQLite's parameter budget. Missing,
 * invalid, or cross-server ids reject the whole boundary instead of widening execution.
 * Rows follow the caller's first-seen id order after deterministic deduplication.
 */
export async function requireScopedMediaItemsById(
	database: ReadExecutor,
	serverInstanceId: string,
	itemIds: readonly number[]
): Promise<MediaItem[]> {
	const ids = [...new Set(itemIds)];
	if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
		throw new MediaItemScopeMismatchError();
	}

	const byId = new Map<number, MediaItem>();
	for (const batch of batchItemIds(ids)) {
		const rows = await database
			.select()
			.from(mediaItems)
			.where(and(eq(mediaItems.serverInstanceId, serverInstanceId), inArray(mediaItems.id, batch)));
		for (const row of rows) byId.set(row.id, row);
	}

	if (byId.size !== ids.length) throw new MediaItemScopeMismatchError();
	return ids.map((id) => byId.get(id)!);
}
