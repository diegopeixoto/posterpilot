import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getItemDetail } from '$lib/server/queries';
import { resolveConfig } from '$lib/server/config';
import { safeRedirectTarget } from '$lib/server/auth/guard';
import {
	resolveReviewContextNavigation,
	reviewItemPath,
	reviewReturnPath
} from '$lib/server/review';
import { getActiveServerInstance } from '$lib/server/server-instances';

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
		suggestPreselect: config.suggestPreselect,
		defaultApplyMethod: config.defaultApplyMethod,
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
