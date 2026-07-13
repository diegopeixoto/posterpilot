import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { countLibrary, listLibrary, LIBRARY_PAGE_SIZE } from '$lib/server/queries';
import { parseLibraryFilter, parseOffset } from '$lib/library-filter';
import { resolveConfig } from '$lib/server/config';
import { getActiveServerInstance } from '$lib/server/server-instances';

/**
 * A page of library items for the grid's infinite scroll. Same filter/sort params
 * as the library page, plus `offset`. Returns the window and the total so the client
 * knows when to stop.
 */
export const GET: RequestHandler = async ({ url }) => {
	const [config, activeServer] = await Promise.all([resolveConfig(), getActiveServerInstance()]);
	const filter = parseLibraryFilter(url.searchParams);
	const effective = {
		...filter,
		serverInstanceId: activeServer?.id ?? '__no_active_server__',
		sort: filter.sort ?? config.libraryDefaultSort
	};
	const offset = parseOffset(url.searchParams.get('offset'));

	const [items, total] = await Promise.all([
		listLibrary(effective, { limit: LIBRARY_PAGE_SIZE, offset }),
		countLibrary(effective)
	]);
	return json({ items, total });
};
