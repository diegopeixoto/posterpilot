import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import type { MediaItem } from '$lib/server/db/schema';
import { requireScopedMediaItemsById } from './scoped-item-query';

type Database = LibSQLDatabase<typeof schema>;
type ReadExecutor = Pick<Database, 'select'>;

/** Load an exact retry/discovery scope, then enforce discovery-specific eligibility. */
export async function requireScopedDiscoverItemsById(
	database: ReadExecutor,
	serverInstanceId: string,
	itemIds: readonly number[],
	libraryScopes: readonly string[] | null
): Promise<MediaItem[]> {
	const items = await requireScopedMediaItemsById(database, serverInstanceId, itemIds);
	const allowedLibraries = libraryScopes ? new Set(libraryScopes) : null;
	if (
		items.some(
			(item) =>
				item.sourceRemovedAt !== null ||
				item.ignored ||
				(allowedLibraries !== null && !allowedLibraries.has(item.sectionKey))
		)
	) {
		throw new Error('job_item_scope_mismatch');
	}
	return items;
}
