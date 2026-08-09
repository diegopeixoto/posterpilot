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
import { parseCoverageFilter } from '$lib/coverage-filter';

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
	// Coverage is deliberately not part of `ParsedReviewFilter`: the library list
	// parses the same parameter with the same module, and a review state is a
	// statement about the user's queue while coverage is a statement about what
	// reached a destination. Neither implies the other, so a user can ask for
	// completed-but-uncovered titles, or the reverse.
	const coverage = parseCoverageFilter(params);

	if (!serverId) {
		return {
			filter,
			coverage,
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

	// The coverage predicate joins the *same* query the navigation context is built
	// from, so item detail's next/previous walks exactly the list the user filtered.
	// Both calls are reads: rendering coverage must never advance `reviewedAt`,
	// because a destination being reconciled is not the user finishing a review.
	const query = { ...filter, coverage };
	const [result, views, orderedIds] = await Promise.all([
		queryReviewInbox(query, { limit: REVIEW_PAGE_SIZE, offset: filter.offset }),
		listReviewViews(serverId),
		listReviewItemIds(query)
	]);
	return {
		filter,
		coverage,
		...result,
		scopes,
		views,
		activeView,
		reviewContextId: createReviewContext(filter, orderedIds),
		pageSize: REVIEW_PAGE_SIZE
	};
};
