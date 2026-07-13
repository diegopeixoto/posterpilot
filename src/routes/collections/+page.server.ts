import type { PageServerLoad } from './$types';
import { listCollections } from '$lib/server/collections/queries';
import { getActiveServerInstance } from '$lib/server/server-instances';

export const load: PageServerLoad = async () => {
	const activeServer = await getActiveServerInstance();
	return {
		serverInstanceId: activeServer?.id ?? null,
		serverName: activeServer?.name ?? null,
		collections: activeServer ? await listCollections(activeServer.id) : []
	};
};
