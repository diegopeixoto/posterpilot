import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveConfig } from '$lib/server/config';
import { applyToItem, getChildSelections } from '$lib/server/posters/service';
import { getMediaItem } from '$lib/server/queries';

export const POST: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	if (!Number.isFinite(id)) throw error(400, 'invalid id');
	const item = await getMediaItem(id);
	if (!item) throw error(404, 'item not found');

	const body = (await request.json().catch(() => ({}))) as {
		posterUrl?: string;
		backgroundUrl?: string | null;
		method?: 'plex' | 'kometa' | 'both';
		/** When true, return the plan without writing anything (preview). */
		dryRun?: boolean;
	};
	const posterUrl = body.posterUrl ?? item.selectedPosterUrl;
	const backgroundUrl = body.backgroundUrl ?? item.selectedBackgroundUrl;
	// Allow a granular-only apply (season/episode slots staged but no show poster).
	const childCount = item.type === 'show' ? (await getChildSelections(item.id)).length : 0;
	if (!posterUrl && !backgroundUrl && childCount === 0) throw error(400, 'nothing to apply');

	const config = await resolveConfig();
	const outcomes = await applyToItem(item, {
		posterUrl,
		backgroundUrl,
		method: body.method ?? config.defaultApplyMethod,
		config,
		// Only an explicit `true` enables dry-run — never coerce (e.g. the string "false").
		dryRun: body.dryRun === true
	});
	return json({ outcomes });
};
