import type { PageServerLoad } from './$types';
import { listLibrary, type LibraryFilter } from '$lib/server/queries';

export const load: PageServerLoad = async ({ url }) => {
	const type = url.searchParams.get('type');
	const filter: LibraryFilter = {
		type: type === 'movie' || type === 'show' ? type : undefined,
		missingPoster: url.searchParams.get('missing') === '1',
		hasMediux: url.searchParams.get('mediux') === '1',
		unchanged: url.searchParams.get('unchanged') === '1',
		q: url.searchParams.get('q') || undefined
	};
	return { items: await listLibrary(filter), filter };
};
