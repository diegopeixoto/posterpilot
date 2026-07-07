import type { PageServerLoad } from './$types';
import {
	countLibrary,
	getSpotlightItem,
	listGenres,
	listLibrary,
	LIBRARY_PAGE_SIZE,
	type LibraryFilter
} from '$lib/server/queries';
import { parseLibrarySort } from '$lib/library-sort';
import { resolveConfig } from '$lib/server/config';

export const load: PageServerLoad = async ({ url }) => {
	const config = await resolveConfig();
	const type = url.searchParams.get('type');
	const sortParam = url.searchParams.get('sort');
	const dirParam = url.searchParams.get('dir');
	const minRatingParam = Number(url.searchParams.get('minRating'));
	const filter: LibraryFilter = {
		type: type === 'movie' || type === 'show' ? type : undefined,
		missingPoster: url.searchParams.get('missing') === '1',
		hasMediux: url.searchParams.get('mediux') === '1',
		unchanged: url.searchParams.get('unchanged') === '1',
		// Ignore a missing/zero/non-numeric value rather than binding NaN (libsql throws on NaN).
		minRating: Number.isFinite(minRatingParam) && minRatingParam > 0 ? minRatingParam : undefined,
		genre: url.searchParams.get('genre') || undefined,
		sort: parseLibrarySort(sortParam),
		dir: dirParam === 'asc' || dirParam === 'desc' ? dirParam : undefined,
		q: url.searchParams.get('q') || undefined
	};
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
