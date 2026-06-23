import type { PageServerLoad } from './$types';
import { publicConfig, resolveConfig } from '$lib/server/config';
import { getActiveServer, type ServerLibrary } from '$lib/server/media-server';

export const load: PageServerLoad = async () => {
	const config = await resolveConfig();
	let sections: ServerLibrary[] = [];
	const server = getActiveServer(config);
	if (server) {
		// Never block the page: bound the library fetch to 5s. A slow/unreachable
		// server returns an empty list instead of hanging the Settings page.
		sections = await Promise.race([
			server.listLibraries().catch(() => [] as ServerLibrary[]),
			new Promise<ServerLibrary[]>((resolve) => setTimeout(() => resolve([]), 5000))
		]);
	}
	return { config: await publicConfig(), sections };
};
