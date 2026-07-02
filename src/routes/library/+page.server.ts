import type { PageServerLoad } from './$types';
import { getSpotlightItem, listGenres, listLibrary, type LibraryFilter } from '$lib/server/queries';
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
	const [items, genres, spotlight] = await Promise.all([
		listLibrary({ ...filter, sort: filter.sort ?? defaultSort }),
		listGenres(),
		getSpotlightItem()
	]);
	return { items, filter, genres, spotlight, defaultSort };
};
