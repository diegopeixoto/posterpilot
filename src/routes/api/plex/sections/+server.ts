import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveConfig } from '$lib/server/config';
import { listSections } from '$lib/server/plex/client';

/** List the Plex movie/show sections (for choosing which libraries to sync). */
export const GET: RequestHandler = async () => {
	const config = await resolveConfig();
	if (!config.plexUrl || !config.plexToken) {
		return json({ sections: [], error: 'Plex URL/token not configured' });
	}
	try {
		const sections = await listSections(config.plexUrl, config.plexToken);
		return json({ sections });
	} catch (e) {
		return json({ sections: [], error: e instanceof Error ? e.message : String(e) });
	}
};
