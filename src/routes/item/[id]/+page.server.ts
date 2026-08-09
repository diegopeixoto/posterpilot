import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getItemDetail } from '$lib/server/queries';
import { db } from '$lib/server/db';
import { readItemCoverage } from '$lib/server/coverage/refresh';
import { loadCoverageOccurrenceCounts } from '$lib/server/coverage/observations-query';
import { canonicalIdentityKey } from '$lib/artwork-coverage';
import { resolveConfig } from '$lib/server/config';
import { safeRedirectTarget } from '$lib/server/auth/guard';
import {
	resolveReviewContextNavigation,
	reviewItemPath,
	reviewReturnPath
} from '$lib/server/review';
import { getActiveServerInstance } from '$lib/server/server-instances';

/**
 * The coverage evidence the detail pane renders, and nothing else.
 *
 * Read through `readItemCoverage` rather than the store directly, so evidence older
 * than the staleness window is re-observed before it is drawn. Nothing tells us when
 * somebody re-postered a title in Plex by hand, and a detail pane is where a silently
 * green badge does the most damage.
 *
 * Assembled here rather than folded into `getItemDetail` because that query also
 * serves the discovery endpoint, which has no use for coverage and should not pay a
 * server round trip for it. Rows are projected down to the slot fields the pane
 * draws — fingerprints and evidence payloads stay on the server.
 */
async function loadCoverage(
	serverInstanceId: string,
	mediaItemId: number,
	identity: { mediaType: 'movie' | 'tv' | null; tmdbId: string | null }
) {
	// Through the shared helper for the same reason the projection uses it: the
	// canonical key is the only thing keeping TMDB movie 105 and show 105 from
	// sharing a count of covered copies.
	const canonicalKey = canonicalIdentityKey(identity.mediaType, identity.tmdbId);
	const [rows, occurrences] = await Promise.all([
		readItemCoverage(serverInstanceId, mediaItemId),
		loadCoverageOccurrenceCounts(db, [{ mediaItemId, canonicalKey }])
	]);
	return {
		slots: rows.map((row) => ({
			destination: row.destination,
			kind: row.kind,
			season: row.season,
			episode: row.episode,
			status: row.status
		})),
		// An unresolved copy is a group of one and is uncovered until its own evidence
		// says otherwise — the same fallback the counting query starts from.
		occurrences: occurrences.get(mediaItemId) ?? {
			canonicalKey,
			occurrences: 1,
			servers: 1,
			libraries: 1,
			coveredOccurrences: { server: 0, kometa: 0 }
		}
	};
}

export const load: PageServerLoad = async ({ params, url }) => {
	const itemId = Number(params.id);
	const requestedReturn = safeRedirectTarget(url.searchParams.get('returnTo'));
	const allowedReturn =
		requestedReturn &&
		(requestedReturn.startsWith('/library') ||
			requestedReturn.startsWith('/review') ||
			requestedReturn.startsWith('/fun'))
			? requestedReturn
			: '/library';
	const focusedReviewReturn = reviewReturnPath(allowedReturn, itemId);
	const returnTo = focusedReviewReturn ?? allowedReturn;
	const requestedContextId = focusedReviewReturn ? url.searchParams.get('reviewContext') : null;
	const activeServer = await getActiveServerInstance();
	if (!activeServer) throw error(404, 'Server instance not found');

	// Detail, config, and the server-owned review context are independent.
	const [detail, config, candidateNavigation] = await Promise.all([
		getItemDetail(itemId, activeServer.id),
		resolveConfig(),
		resolveReviewContextNavigation(requestedContextId, itemId)
	]);
	if (!detail) throw error(404, 'Item not found');
	// Coverage follows the detail load because it is scoped by the item's canonical
	// identity, which the detail row is what proves. It is never derived from that
	// row's candidates or history: destination evidence is a projection over the
	// server and the Kometa files, and nothing on this page implies what either holds.
	const coverage = await loadCoverage(activeServer.id, itemId, detail.item);
	const reviewContext =
		candidateNavigation && candidateNavigation.serverInstanceId === detail.item.serverInstanceId
			? candidateNavigation
			: null;
	const navigationTarget = (targetId: number | null) => {
		if (!targetId || !reviewContext) return null;
		const targetReturn = reviewReturnPath(returnTo, targetId);
		return targetReturn
			? {
					id: targetId,
					href: reviewItemPath(targetId, targetReturn, reviewContext.contextId)
				}
			: null;
	};
	return {
		...detail,
		coverage,
		suggestPreselect: config.suggestPreselect,
		defaultApplyMethod: config.defaultApplyMethod,
		// The preference travels as-is; the page resolves it against the active UI
		// locale so `ui` follows whichever language the visitor is actually reading.
		tmdbArtworkLanguage: config.tmdbArtworkLanguage,
		returnTo,
		isReviewReturn: focusedReviewReturn !== null,
		// Review detail can move item-to-item, so browser history may point at another
		// item rather than the inbox. Always follow the explicit focused review URL.
		canUseHistoryBack: requestedReturn === returnTo && focusedReviewReturn === null,
		reviewNavigation: reviewContext
			? {
					previous: navigationTarget(reviewContext.previousItemId),
					next: navigationTarget(reviewContext.nextItemId),
					matchingCount: reviewContext.matchingCount
				}
			: null
	};
};
