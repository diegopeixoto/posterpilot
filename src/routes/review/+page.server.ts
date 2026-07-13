import type { PageServerLoad } from './$types';
import { getActiveServerInstance } from '$lib/server/server-instances';
import {
	createReviewContext,
	getReviewView,
	listReviewItemIds,
	listReviewScopes,
	listReviewViews,
	queryReviewInbox,
	type ReviewState
} from '$lib/server/review';
import {
	parseReviewFilter,
	REVIEW_STATE_VALUES,
	type ParsedReviewFilter
} from '$lib/review-filter';

const REVIEW_PAGE_SIZE = 24;

function withSavedView(params: URLSearchParams, view: Awaited<ReturnType<typeof getReviewView>>) {
	const merged = new URLSearchParams(params);
	const filters = view.filters as Record<string, unknown>;
	const sort = view.sort as Record<string, unknown>;
	const setMissing = (key: string, value: unknown) => {
		if (!merged.has(key) && typeof value === 'string' && value) merged.set(key, value);
	};
	setMissing('library', view.librarySectionKey);
	setMissing('state', filters.state);
	setMissing('type', filters.type);
	setMissing('availability', filters.availability);
	setMissing('changedSince', filters.changedSince);
	setMissing('q', filters.q);
	setMissing('sort', sort.by);
	return merged;
}

export const load: PageServerLoad = async ({ url }) => {
	const [scopes, activeServer] = await Promise.all([listReviewScopes(), getActiveServerInstance()]);
	const fallbackServerId =
		(activeServer && scopes.servers.some((server) => server.id === activeServer.id)
			? activeServer.id
			: scopes.servers[0]?.id) ?? '';
	let serverId = url.searchParams.get('server')?.trim() || fallbackServerId;
	if (!scopes.servers.some((server) => server.id === serverId)) serverId = fallbackServerId;

	let activeView: Awaited<ReturnType<typeof getReviewView>> | null = null;
	const requestedView = url.searchParams.get('view');
	if (serverId && requestedView) {
		try {
			activeView = await getReviewView(serverId, requestedView);
		} catch {
			activeView = null;
		}
	}
	const params = activeView ? withSavedView(url.searchParams, activeView) : url.searchParams;
	const filter: ParsedReviewFilter = parseReviewFilter(params, serverId);
	filter.serverInstanceId = serverId;

	if (!serverId) {
		return {
			filter,
			items: [],
			total: 0,
			counts: Object.fromEntries(REVIEW_STATE_VALUES.map((state) => [state, 0])) as Record<
				ReviewState,
				number
			>,
			scopes,
			views: [],
			activeView,
			reviewContextId: null,
			pageSize: REVIEW_PAGE_SIZE
		};
	}

	const [result, views, orderedIds] = await Promise.all([
		queryReviewInbox(filter, { limit: REVIEW_PAGE_SIZE, offset: filter.offset }),
		listReviewViews(serverId),
		listReviewItemIds(filter)
	]);
	return {
		filter,
		...result,
		scopes,
		views,
		activeView,
		reviewContextId: createReviewContext(filter, orderedIds),
		pageSize: REVIEW_PAGE_SIZE
	};
};
