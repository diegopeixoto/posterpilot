import type { PageServerLoad } from './$types';
import {
	getSpotlightItem,
	listGenres,
	listLibrary,
	type LibraryFilter,
	type LibrarySort
} from '$lib/server/queries';

const SORTS: LibrarySort[] = ['title', 'year', 'rating', 'runtime', 'recent'];

export const load: PageServerLoad = async ({ url }) => {
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
		sort: SORTS.includes(sortParam as LibrarySort) ? (sortParam as LibrarySort) : undefined,
		dir: dirParam === 'asc' || dirParam === 'desc' ? dirParam : undefined,
		q: url.searchParams.get('q') || undefined
	};
	const [items, genres, spotlight] = await Promise.all([
		listLibrary(filter),
		listGenres(),
		getSpotlightItem()
	]);
	return { items, filter, genres, spotlight };
};
