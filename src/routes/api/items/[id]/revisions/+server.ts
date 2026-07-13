import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	ArtworkRevisionHistoryQueryError,
	parseArtworkRevisionHistoryQuery
} from '$lib/server/artwork-revisions/history';
import { listActiveItemArtworkRevisionHistory } from '$lib/server/artwork-revisions/history-runtime';
import { getActiveServerInstance } from '$lib/server/server-instances';

export const GET: RequestHandler = async ({ params, url }) => {
	const mediaItemId = Number(params.id);
	if (!Number.isSafeInteger(mediaItemId) || mediaItemId <= 0) {
		return json({ error: { code: 'invalid_request', field: 'id' } }, { status: 400 });
	}

	try {
		const query = parseArtworkRevisionHistoryQuery(url.searchParams);
		const active = await getActiveServerInstance();
		if (!active) {
			return json({ error: { code: 'server_instance_not_found' } }, { status: 409 });
		}

		// Ownership is checked inside the same server-scoped repository read. A row
		// from another server is intentionally indistinguishable from a missing item.
		const page = await listActiveItemArtworkRevisionHistory({
			serverInstanceId: active.id,
			mediaItemId,
			query
		});
		if (!page) return json({ error: { code: 'item_not_found' } }, { status: 404 });
		return json(page);
	} catch (error) {
		if (error instanceof ArtworkRevisionHistoryQueryError) {
			return json({ error: { code: error.code, field: error.field } }, { status: 400 });
		}
		throw error;
	}
};
