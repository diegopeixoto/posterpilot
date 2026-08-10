import { and, eq, sql, type SQL } from 'drizzle-orm';
import { mediaItems, type MediaItem } from '$lib/server/db/schema';
import { pendingTmdbTypeMismatchIndexCondition } from '$lib/server/db/tmdb-repair-condition';

/**
 * The resolution reason recorded when the automatic resolver verified an id in
 * the opposite TMDB namespace (a miniseries filed in a movie library). Such a
 * row conflicts with the library type *by construction*, so treating it as a
 * pending mismatch would make repair re-resolve the same answer forever and
 * pin the warning banner open.
 */
export const CROSS_NAMESPACE_RESOLUTION_REASON = 'cross_namespace_guid';

export type TmdbTypeMismatchItem = Pick<
	MediaItem,
	'serverInstanceId' | 'type' | 'mediaType' | 'manualMatchPinned' | 'sourceRemovedAt'
> & { resolutionReason?: string | null };

/**
 * Pure counterpart to {@link pendingTmdbTypeMismatchCondition}. Keeping this
 * decision independent from the database lets sync decide whether one item
 * must bypass its normal incremental timestamp check.
 */
export function isPendingTmdbTypeMismatch(
	item: TmdbTypeMismatchItem,
	serverInstanceId: string
): boolean {
	if (item.serverInstanceId !== serverInstanceId) return false;
	if (item.manualMatchPinned || item.sourceRemovedAt !== null) return false;
	if (item.resolutionReason === CROSS_NAMESPACE_RESOLUTION_REASON) return false;

	return (
		(item.type === 'show' && item.mediaType === 'movie') ||
		(item.type === 'movie' && item.mediaType === 'tv')
	);
}

/**
 * Durable server-scoped source of truth for legacy automatic TMDB matches
 * whose stored namespace conflicts with the authoritative media-server type.
 *
 * Strictly narrower than the partial index's WHERE clause (the extra
 * cross-namespace exemption still implies it), so the index remains usable.
 */
export function pendingTmdbTypeMismatchCondition(serverInstanceId: string): SQL {
	return and(
		eq(mediaItems.serverInstanceId, serverInstanceId),
		pendingTmdbTypeMismatchIndexCondition(mediaItems),
		// A literal, not a bound parameter, for the same reason the index
		// condition uses literals: implication over the partial index must be
		// provable while preparing the statement.
		sql`(${mediaItems.resolutionReason} is null or ${mediaItems.resolutionReason} <> ${sql.raw(`'${CROSS_NAMESPACE_RESOLUTION_REASON}'`)})`
	)!;
}
