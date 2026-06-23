import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveConfig } from '$lib/server/config';
import { applyCustomUpload } from '$lib/server/posters/service';
import { getMediaItem } from '$lib/server/queries';

/** Apply a user-uploaded image file as the item's poster (Plex only). */
export const POST: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	if (!Number.isFinite(id)) throw error(400, 'invalid id');
	const item = await getMediaItem(id);
	if (!item) throw error(404, 'item not found');

	const form = await request.formData();
	const file = form.get('file');
	if (!(file instanceof File) || file.size === 0) throw error(400, 'no image file provided');

	const config = await resolveConfig();
	try {
		const bytes = await file.arrayBuffer();
		await applyCustomUpload(item, bytes, file.type || 'image/jpeg', config);
		return json({ ok: true });
	} catch (e) {
		return json({ ok: false, error: e instanceof Error ? e.message : String(e) });
	}
};
