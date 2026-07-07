import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getItemDetail } from '$lib/server/queries';
import { resolveConfig } from '$lib/server/config';

export const load: PageServerLoad = async ({ params }) => {
	// The detail lookup and the config read are independent — run them concurrently.
	const [detail, config] = await Promise.all([getItemDetail(Number(params.id)), resolveConfig()]);
	if (!detail) throw error(404, 'Item not found');
	// `detail.candidates` already carry `score`/`width`/`height` (full row select);
	// expose the suggestion flag so the page can pre-select the top-scored slot pick.
	return { ...detail, suggestPreselect: config.suggestPreselect };
};
