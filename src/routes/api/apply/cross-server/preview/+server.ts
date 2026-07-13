import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { previewDatabaseCrossServerApply } from '$lib/server/plans/cross-server-apply-runtime';
import { applyRouteError } from '$lib/server/plans/apply-route-error';

/** Read-only exact-identifier resolution plus the shared frozen apply preview. */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as {
		sourceItem?: { serverInstanceId?: string; mediaItemId?: number };
		destinationServerInstanceIds?: string[];
		match?: { namespace?: 'tmdb' | 'imdb' | 'tvdb'; value?: string };
		selection?: 'auto' | 'stored';
		method?: 'plex' | 'server' | 'kometa' | 'both';
	};
	if (
		!body.sourceItem?.serverInstanceId ||
		!body.sourceItem.mediaItemId ||
		!body.destinationServerInstanceIds ||
		!body.match?.namespace ||
		!body.match.value
	) {
		return json({ error: 'invalid_request' }, { status: 400 });
	}
	try {
		return json(
			await previewDatabaseCrossServerApply({
				sourceItem: {
					serverInstanceId: body.sourceItem.serverInstanceId,
					mediaItemId: body.sourceItem.mediaItemId
				},
				destinationServerInstanceIds: body.destinationServerInstanceIds,
				match: { namespace: body.match.namespace, value: body.match.value },
				selectionMode: body.selection ?? 'stored',
				method: body.method
			})
		);
	} catch (error) {
		return applyRouteError(error);
	}
};
