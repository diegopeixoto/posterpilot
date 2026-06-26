import type { PageServerLoad } from './$types';
import { loadKometaState } from '$lib/server/kometa/sync';
import { publicConfig } from '$lib/server/config';
import { getSpotlightItem } from '$lib/server/queries';

export const load: PageServerLoad = async () => {
	const [kometa, config, spotlight] = await Promise.all([
		loadKometaState(),
		publicConfig(),
		getSpotlightItem()
	]);
	return { kometa, config, spotlight };
};
