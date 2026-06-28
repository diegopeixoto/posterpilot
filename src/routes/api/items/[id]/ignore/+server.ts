import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMediaItem, setItemIgnored } from '$lib/server/queries';

/**
 * Mark an item as ignored (excluded from sync/auto-apply) or restore it. Expects
 * an explicit `{ ignored: boolean }` in the body and rejects any non-boolean value
 * so a stray string (e.g. "false") can't silently flip the flag.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	if (!Number.isFinite(id)) throw error(400, 'invalid id');
	const item = await getMediaItem(id);
	if (!item) throw error(404, 'item not found');

	const body = (await request.json().catch(() => ({}))) as { ignored?: unknown };
	if (typeof body.ignored !== 'boolean') throw error(400, 'ignored must be a boolean');

	await setItemIgnored(id, body.ignored);
	return json({ ok: true, ignored: body.ignored });
};
