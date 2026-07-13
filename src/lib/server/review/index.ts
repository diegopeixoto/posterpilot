import { db } from '$lib/server/db';
import { createReviewActionService } from './actions';
import { createApplyAndNextCompletionService } from './apply-and-next';

export {
	getReviewDashboardSummary,
	queryReviewInbox,
	listReviewItemIds,
	listReviewScopes
} from './query';
export type { ReviewAvailability, ReviewFilter, ReviewPageOptions, ReviewSort } from './query';
export {
	createReviewContext,
	resolveReviewContextNavigation,
	reviewItemPath,
	reviewReturnPath
} from './context';
export type { ReviewState } from './state';
export { ReviewActionError, parseReviewAction } from './actions';
export type { ReviewAction } from './actions';
export { ReviewViewError } from './views';
export { ApplyAndNextError } from './apply-and-next';
export type { ApplyAndNextErrorCode } from './apply-and-next';

import { createReviewViewStore } from './views';

export const performReviewAction = createReviewActionService(db);
export const completeReviewAfterVerifiedApply = createApplyAndNextCompletionService(db);
const liveViews = createReviewViewStore(db);
export const listReviewViews = (serverInstanceId: string) => liveViews.list(serverInstanceId);
export const getReviewView = (serverInstanceId: string, id: string) =>
	liveViews.get(serverInstanceId, id);
export const createReviewView = (
	serverInstanceId: string,
	input: Parameters<typeof liveViews.create>[1]
) => liveViews.create(serverInstanceId, input);
export const updateReviewView = (
	serverInstanceId: string,
	id: string,
	input: Parameters<typeof liveViews.update>[2]
) => liveViews.update(serverInstanceId, id, input);
export const deleteReviewView = (serverInstanceId: string, id: string) =>
	liveViews.remove(serverInstanceId, id);
