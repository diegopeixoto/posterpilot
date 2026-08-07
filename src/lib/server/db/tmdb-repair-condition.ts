import { sql } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

interface TmdbRepairPredicateColumns {
	manualMatchPinned: AnySQLiteColumn;
	sourceRemovedAt: AnySQLiteColumn;
	type: AnySQLiteColumn;
	mediaType: AnySQLiteColumn;
}

/**
 * Static part of the durable TMDB mismatch predicate.
 *
 * Keep these values as SQL literals: SQLite can use the matching partial
 * index only when it can prove this query predicate implies the index WHERE
 * clause while preparing the statement.
 */
export function pendingTmdbTypeMismatchIndexCondition(columns: TmdbRepairPredicateColumns) {
	return sql`${columns.manualMatchPinned} = 0 and ${columns.sourceRemovedAt} is null and ((${columns.type} = 'show' and ${columns.mediaType} = 'movie') or (${columns.type} = 'movie' and ${columns.mediaType} = 'tv'))`;
}
