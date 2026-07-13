import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { collectionHistory } from '$lib/server/collections/history-runtime';
import { getCollection } from '$lib/server/collections/queries';
import { getCollectionSuggestionWorkspace } from '$lib/server/collections/suggestion-store';
import { resolveConfig } from '$lib/server/config';
import { getActiveServerInstance } from '$lib/server/server-instances';

export const load: PageServerLoad = async ({ params }) => {
	const activeServer = await getActiveServerInstance();
	if (!activeServer) throw error(404, 'collection not found');
	const [collection, suggestions, config, history] = await Promise.all([
		getCollection(activeServer.id, params.id),
		getCollectionSuggestionWorkspace(activeServer.id, params.id),
		resolveConfig(),
		collectionHistory.list(activeServer.id, params.id)
	]);
	if (!collection) throw error(404, 'collection not found');
	return {
		collection,
		suggestions: suggestions ?? { families: [], members: [], hasCandidates: false },
		serverName: activeServer.name,
		defaultApplyMethod: (config.defaultApplyMethod === 'plex'
			? 'server'
			: config.defaultApplyMethod) as 'server' | 'kometa' | 'both',
		history
	};
};
