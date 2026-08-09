/**
 * Re-reads artwork from a media server so the stale coverage sweep reconciles
 * from fresh evidence rather than from the fingerprints it already had.
 *
 * This is the only network call the coverage code makes, which is why it lives
 * apart from `refresh.ts` and is injected into the refresher: everything else
 * there reads the database, and keeping it that way is what lets the reconcilers
 * and the refresh logic be tested without a server.
 *
 * It reuses the full-rescan observer rather than reading artwork itself, so
 * external changes are detected, fingerprinted and recorded by exactly the same
 * code path a rescan uses. Two mechanisms deciding what counts as an external
 * change is precisely how the two would drift apart.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { mediaItems } from '$lib/server/db/schema';
import { createDatabaseFullRescanArtworkObserver } from '$lib/server/jobs/full-rescan-artwork';
import { resolveMediaServerInstance } from '$lib/server/server-instances';

const observe = createDatabaseFullRescanArtworkObserver(db);

/**
 * Observe every listed occurrence, best effort per item.
 *
 * One unreachable title must not abandon the rest of the sweep, so per-item
 * failures are skipped rather than thrown. An unreachable *server*, on the other
 * hand, throws: that is the case where nothing was observed at all, and the
 * caller must not go on to stamp fresh evidence onto rows it never re-checked.
 */
export async function observeServerArtworkForCoverage(input: {
	serverInstanceId: string;
	mediaItemIds: number[];
}): Promise<void> {
	if (input.mediaItemIds.length === 0) return;

	const { server } = await resolveMediaServerInstance(input.serverInstanceId, {
		requireEnabled: true
	});
	if (!server.readArtwork) return;

	const items = await db
		.select({
			id: mediaItems.id,
			ratingKey: mediaItems.ratingKey,
			currentPosterUrl: mediaItems.currentPosterUrl,
			currentBackgroundUrl: mediaItems.currentBackgroundUrl,
			currentPosterFingerprint: mediaItems.currentPosterFingerprint,
			currentBackgroundFingerprint: mediaItems.currentBackgroundFingerprint,
			lastVerifiedAt: mediaItems.lastVerifiedAt,
			externalArtworkChangedAt: mediaItems.externalArtworkChangedAt
		})
		.from(mediaItems)
		.where(
			and(
				eq(mediaItems.serverInstanceId, input.serverInstanceId),
				inArray(mediaItems.id, input.mediaItemIds)
			)
		);

	for (const item of items) {
		try {
			await observe({
				server,
				serverInstanceId: input.serverInstanceId,
				mediaItemId: item.id,
				sourceItemId: item.ratingKey,
				currentPosterUrl: item.currentPosterUrl,
				currentBackgroundUrl: item.currentBackgroundUrl,
				// The stored state is what the observer compares against to tell a first
				// observation from a genuine external change — the same fields the
				// rescan hands it, so both classify identically.
				previous: {
					currentPosterUrl: item.currentPosterUrl,
					currentBackgroundUrl: item.currentBackgroundUrl,
					currentPosterFingerprint: item.currentPosterFingerprint,
					currentBackgroundFingerprint: item.currentBackgroundFingerprint,
					lastVerifiedAt: item.lastVerifiedAt,
					externalArtworkChangedAt: item.externalArtworkChangedAt
				}
			});
		} catch {
			// Skipped, not fatal: this item keeps its old evidence and stays stale, so
			// the next sweep tries again.
		}
	}
}
