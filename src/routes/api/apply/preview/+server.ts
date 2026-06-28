import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveConfig } from '$lib/server/config';
import { applyToItem, autoSelectPoster } from '$lib/server/posters/service';
import { getMediaItem } from '$lib/server/queries';

/**
 * Dry-run preview for a bulk apply: returns an aggregate plan (how many uploads,
 * Kometa exports, and skipped child slots) without writing anything, so the UI can
 * confirm before enqueuing the real apply job. Mirrors the bulk apply body.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as {
		itemIds?: number[];
		method?: 'plex' | 'kometa' | 'both';
		selection?: 'auto' | 'stored';
	};
	if (!body.itemIds?.length) throw error(400, 'itemIds is required');
	const method = body.method ?? 'both';
	const selection = body.selection ?? 'auto';
	const config = await resolveConfig();

	let serverUploads = 0;
	let kometaExports = 0;
	let childUploads = 0;
	let skipped = 0;
	let items = 0;

	for (const id of body.itemIds) {
		const item = await getMediaItem(id);
		if (!item) continue;
		const posterUrl =
			selection === 'auto' ? await autoSelectPoster(item.id) : item.selectedPosterUrl;
		const backgroundUrl = selection === 'auto' ? null : item.selectedBackgroundUrl;
		const outcomes = await applyToItem(item, {
			posterUrl,
			backgroundUrl,
			method,
			config,
			dryRun: true
		});
		items++;
		for (const o of outcomes) {
			if (o.method === 'plex') {
				if (o.planned?.poster) serverUploads++;
				if (o.planned?.background) serverUploads++;
				childUploads += o.children?.applied ?? 0;
				skipped += o.children?.skipped ?? 0;
			} else if (o.method === 'kometa' && o.status === 'success') {
				kometaExports++;
			}
		}
	}

	return json({
		items,
		plan: { serverUploads, childUploads, kometaExports, skipped }
	});
};
