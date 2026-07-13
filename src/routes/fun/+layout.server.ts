import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { resolveConfig } from '$lib/server/config';

/** Gate the entire experiment hub, including every nested FUN route. */
export const load: LayoutServerLoad = async () => {
	const config = await resolveConfig();
	if (!config.funEnabled) throw error(404, 'Not found');
	return {};
};
