import type { PageServerLoad } from './$types';
import { loadKometaState } from '$lib/server/kometa/sync';
import { publicConfig } from '$lib/server/config';
import { getMontagePosters, getSpotlightItem } from '$lib/server/queries';
import { getActiveServerInstance } from '$lib/server/server-instances';

export const load: PageServerLoad = async ({ setHeaders }) => {
	setHeaders({ 'cache-control': 'private, no-store' });
	const active = await getActiveServerInstance();
	const [kometa, config, spotlight, montage] = await Promise.all([
		loadKometaState(),
		publicConfig(),
		active ? getSpotlightItem(active.id) : Promise.resolve(null),
		active ? getMontagePosters(14, active.id) : Promise.resolve([])
	]);
	return { kometa, config, spotlight, montage };
};
