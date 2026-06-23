import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveConfig } from '$lib/server/config';
import { discoverForItem } from '$lib/server/posters/service';
import { getItemDetail, getMediaItem } from '$lib/server/queries';

export const POST: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	if (!Number.isFinite(id)) throw error(400, 'invalid id');
	const item = await getMediaItem(id);
	if (!item) throw error(404, 'item not found');

	const body = (await request.json().catch(() => ({}))) as { forceRefresh?: boolean };
	const config = await resolveConfig();
	try {
		const count = await discoverForItem(item, config, { forceRefresh: body.forceRefresh });
		const detail = await getItemDetail(id);
		return json({ count, candidates: detail?.candidates ?? [] });
	} catch (e) {
		// MediaUX fetch/parse failure — report it without 500-ing the request.
		return json({ count: 0, candidates: [], error: e instanceof Error ? e.message : String(e) });
	}
};
