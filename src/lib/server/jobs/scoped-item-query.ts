import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import {
	MediaItemScopeMismatchError,
	requireScopedMediaItemsById as requireScopedMediaItems
} from '$lib/server/media-items/scoped-query';

type Database = LibSQLDatabase<typeof schema>;
type ReadExecutor = Pick<Database, 'select'>;

/** Preserve the durable-job error contract over the shared bounded scope reader. */
export async function requireScopedMediaItemsById(
	database: ReadExecutor,
	serverInstanceId: string,
	itemIds: readonly number[]
) {
	try {
		return await requireScopedMediaItems(database, serverInstanceId, itemIds);
	} catch (error) {
		if (error instanceof MediaItemScopeMismatchError) {
			throw new Error('job_item_scope_mismatch', { cause: error });
		}
		throw error;
	}
}
