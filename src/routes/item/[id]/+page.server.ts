import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getItemDetail } from '$lib/server/queries';
import { resolveConfig } from '$lib/server/config';

export const load: PageServerLoad = async ({ params }) => {
	const detail = await getItemDetail(Number(params.id));
	if (!detail) throw error(404, 'Item not found');
	// `detail.candidates` already carry `score`/`width`/`height` (full row select);
	// expose the suggestion flag so the page can pre-select the top-scored slot pick.
	const config = await resolveConfig();
	return { ...detail, suggestPreselect: config.suggestPreselect };
};
