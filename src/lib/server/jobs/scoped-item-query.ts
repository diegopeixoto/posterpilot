import { and, eq, inArray } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import { mediaItems } from '$lib/server/db/schema';
import { batchItemIds } from './item-id-batches';

type Database = LibSQLDatabase<typeof schema>;
type ReadExecutor = Pick<Database, 'select'>;

export interface ScopedMediaItem {
	id: number;
	sectionKey: string;
	ratingKey: string;
}

/**
 * Load an exact item-id scope without exceeding SQLite's parameter budget. Missing,
 * invalid, or cross-server ids reject the whole boundary instead of widening execution.
 */
export async function requireScopedMediaItemsById(
	database: ReadExecutor,
	serverInstanceId: string,
	itemIds: readonly number[]
): Promise<ScopedMediaItem[]> {
	const ids = [...new Set(itemIds)];
	if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
		throw new Error('job_item_scope_mismatch');
	}
	const rows: ScopedMediaItem[] = [];
	for (const batch of batchItemIds(ids)) {
		rows.push(
			...(await database
				.select({
					id: mediaItems.id,
					sectionKey: mediaItems.sectionKey,
					ratingKey: mediaItems.ratingKey
				})
				.from(mediaItems)
				.where(
					and(eq(mediaItems.serverInstanceId, serverInstanceId), inArray(mediaItems.id, batch))
				))
		);
	}
	if (rows.length !== ids.length) throw new Error('job_item_scope_mismatch');
	return rows;
}
