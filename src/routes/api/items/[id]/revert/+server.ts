import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveConfig } from '$lib/server/config';
import { revertItem } from '$lib/server/posters/service';
import { getMediaItem } from '$lib/server/queries';

/** Revert an item to its original Plex poster and clear posterpilot's changes. */
export const POST: RequestHandler = async ({ params }) => {
	const id = Number(params.id);
	if (!Number.isFinite(id)) throw error(400, 'invalid id');
	const item = await getMediaItem(id);
	if (!item) throw error(404, 'item not found');

	const config = await resolveConfig();
	try {
		await revertItem(item, config);
		return json({ ok: true });
	} catch (e) {
		return json({ ok: false, error: e instanceof Error ? e.message : String(e) });
	}
};
