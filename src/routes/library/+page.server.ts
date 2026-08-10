import type { PageServerLoad } from './$types';
import {
	countLibrary,
	getSpotlightItem,
	listGenres,
	listLibrary,
	LIBRARY_PAGE_SIZE
} from '$lib/server/queries';
import { parseLibraryFilter } from '$lib/library-filter';
import { resolveConfig } from '$lib/server/config';
import { getActiveServerInstance } from '$lib/server/server-instances';

export const load: PageServerLoad = async ({ url }) => {
	const [config, activeServer] = await Promise.all([resolveConfig(), getActiveServerInstance()]);
	// Coverage rides inside the parsed library filter so every consumer sees it —
	// this load, the paging endpoint, and "select all matching" — and none can
	// drop it. The review list parses the same parameter from the same module, so
	// one coverage link means the same thing whichever list produced it. The value
	// goes into the query filter untranslated: the query layer derives the SQL
	// from the shared `isCovered` contract, and nothing is restated here.
	const filter = parseLibraryFilter(url.searchParams);
	const coverage = filter.coverage;
	// The URL's sort always wins; the configured default only fills its absence.
	// `filter` is returned with the URL-only sort so the UI can tell an explicit
	// user choice (chip-worthy) from the configured default.
	const defaultSort = config.libraryDefaultSort;
	const effectiveFilter = {
		...filter,
		serverInstanceId: activeServer?.id ?? '__no_active_server__',
		sort: filter.sort ?? defaultSort
	};
	// Load only the first page (bounded payload) plus the total, so a large library
	// no longer serializes every row into the SSR response.
	const [items, total, genres, spotlight] = await Promise.all([
		listLibrary(effectiveFilter, { limit: LIBRARY_PAGE_SIZE, offset: 0 }),
		countLibrary(effectiveFilter),
		activeServer ? listGenres(activeServer.id) : Promise.resolve([]),
		activeServer ? getSpotlightItem(activeServer.id) : Promise.resolve(null)
	]);
	return {
		items,
		total,
		pageSize: LIBRARY_PAGE_SIZE,
		filter,
		// Returned beside `filter` rather than inside it: `filter` is the shape the
		// toolbar reads, and coverage is not one of its controls.
		coverage,
		genres,
		spotlight,
		defaultSort,
		defaultApplyMethod: config.defaultApplyMethod,
		serverInstanceId: activeServer?.id ?? null
	};
};
