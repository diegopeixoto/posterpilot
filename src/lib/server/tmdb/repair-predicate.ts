import { and, eq, isNull, or, type SQL } from 'drizzle-orm';
import { mediaItems, type MediaItem } from '$lib/server/db/schema';

export type TmdbTypeMismatchItem = Pick<
	MediaItem,
	'serverInstanceId' | 'type' | 'mediaType' | 'manualMatchPinned' | 'sourceRemovedAt'
>;

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

	return (
		(item.type === 'show' && item.mediaType === 'movie') ||
		(item.type === 'movie' && item.mediaType === 'tv')
	);
}

/**
 * Durable server-scoped source of truth for legacy automatic TMDB matches
 * whose stored namespace conflicts with the authoritative media-server type.
 */
export function pendingTmdbTypeMismatchCondition(serverInstanceId: string): SQL {
	return and(
		eq(mediaItems.serverInstanceId, serverInstanceId),
		eq(mediaItems.manualMatchPinned, false),
		isNull(mediaItems.sourceRemovedAt),
		or(
			and(eq(mediaItems.type, 'show'), eq(mediaItems.mediaType, 'movie')),
			and(eq(mediaItems.type, 'movie'), eq(mediaItems.mediaType, 'tv'))
		)
	)!;
}
