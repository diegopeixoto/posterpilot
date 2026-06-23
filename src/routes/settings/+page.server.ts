import type { PageServerLoad } from './$types';
import { publicConfig, resolveConfig } from '$lib/server/config';
import { listSections } from '$lib/server/plex/client';
import type { PlexSection } from '$lib/server/types';

export const load: PageServerLoad = async () => {
	const config = await resolveConfig();
	let sections: PlexSection[] = [];
	if (config.plexUrl && config.plexToken) {
		try {
			sections = await listSections(config.plexUrl, config.plexToken);
		} catch {
			sections = [];
		}
	}
	return { config: await publicConfig(), sections };
};
