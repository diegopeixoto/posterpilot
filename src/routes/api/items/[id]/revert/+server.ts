import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveConfig } from '$lib/server/config';
import { revertItem } from '$lib/server/posters/service';
import { getMediaItem } from '$lib/server/queries';

/**
 * Revert an item's artwork and clear posterpilot's changes. With `{ season }` in
 * the body, reverts only that season (its poster/background + its episodes' title
 * cards); otherwise reverts the show-level cover and every applied child.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	if (!Number.isFinite(id)) throw error(400, 'invalid id');
	const item = await getMediaItem(id);
	if (!item) throw error(404, 'item not found');

	const body = (await request.json().catch(() => ({}))) as { season?: number };
	const scope = Number.isFinite(body.season) ? { season: Number(body.season) } : undefined;

	const config = await resolveConfig();
	try {
		const result = await revertItem(item, config, scope);
		return json({ ok: true, ...result });
	} catch (e) {
		return json({ ok: false, error: e instanceof Error ? e.message : String(e) });
	}
};
