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

export const load: PageServerLoad = async ({ url }) => {
	const config = await resolveConfig();
	const filter = parseLibraryFilter(url.searchParams);
	// The URL's sort always wins; the configured default only fills its absence.
	// `filter` is returned with the URL-only sort so the UI can tell an explicit
	// user choice (chip-worthy) from the configured default.
	const defaultSort = config.libraryDefaultSort;
	const effectiveFilter = { ...filter, sort: filter.sort ?? defaultSort };
	// Load only the first page (bounded payload) plus the total, so a large library
	// no longer serializes every row into the SSR response.
	const [items, total, genres, spotlight] = await Promise.all([
		listLibrary(effectiveFilter, { limit: LIBRARY_PAGE_SIZE, offset: 0 }),
		countLibrary(effectiveFilter),
		listGenres(),
		getSpotlightItem()
	]);
	return { items, total, pageSize: LIBRARY_PAGE_SIZE, filter, genres, spotlight, defaultSort };
};
