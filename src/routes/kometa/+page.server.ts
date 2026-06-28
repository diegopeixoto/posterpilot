import type { PageServerLoad } from './$types';
import { loadKometaState } from '$lib/server/kometa/sync';
import { publicConfig } from '$lib/server/config';
import { getMontagePosters, getSpotlightItem } from '$lib/server/queries';

export const load: PageServerLoad = async () => {
	const [kometa, config, spotlight, montage] = await Promise.all([
		loadKometaState(),
		publicConfig(),
		getSpotlightItem(),
		getMontagePosters()
	]);
	return { kometa, config, spotlight, montage };
};
