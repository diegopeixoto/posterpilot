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

async function scopedMediaItemsById(
	database: ReadExecutor,
	serverInstanceId: string,
	itemIds: readonly number[]
): Promise<{ ids: number[]; byId: Map<number, MediaItem> }> {
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
	return { ids, byId };
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
	const { ids, byId } = await scopedMediaItemsById(database, serverInstanceId, itemIds);
	if (byId.size !== ids.length) throw new MediaItemScopeMismatchError();
	return ids.map((id) => byId.get(id)!);
}

/**
 * Load whichever of the named ids still exist on the server, preserving
 * first-seen order. For server-derived scopes — collection membership read
 * moments earlier — an id that vanished in between is a skip, not a boundary
 * violation; a user-frozen scope must use `requireScopedMediaItemsById`, where
 * a missing id invalidates the whole selection.
 */
export async function loadScopedMediaItemsById(
	database: ReadExecutor,
	serverInstanceId: string,
	itemIds: readonly number[]
): Promise<MediaItem[]> {
	const { ids, byId } = await scopedMediaItemsById(database, serverInstanceId, itemIds);
	return ids.flatMap((id) => byId.get(id) ?? []);
}
