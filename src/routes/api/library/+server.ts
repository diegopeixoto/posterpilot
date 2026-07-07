import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { countLibrary, listLibrary, LIBRARY_PAGE_SIZE } from '$lib/server/queries';
import { parseLibraryFilter, parseOffset } from '$lib/library-filter';
import { resolveConfig } from '$lib/server/config';

/**
 * A page of library items for the grid's infinite scroll. Same filter/sort params
 * as the library page, plus `offset`. Returns the window and the total so the client
 * knows when to stop.
 */
export const GET: RequestHandler = async ({ url }) => {
	const config = await resolveConfig();
	const filter = parseLibraryFilter(url.searchParams);
	const effective = { ...filter, sort: filter.sort ?? config.libraryDefaultSort };
	const offset = parseOffset(url.searchParams.get('offset'));

	const [items, total] = await Promise.all([
		listLibrary(effective, { limit: LIBRARY_PAGE_SIZE, offset }),
		countLibrary(effective)
	]);
	return json({ items, total });
};
