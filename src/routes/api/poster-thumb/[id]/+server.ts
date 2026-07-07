import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMediaItem } from '$lib/server/queries';
import { resolveConfig } from '$lib/server/config';
import { getOrFetchThumb } from '$lib/server/posters/thumb-cache';
import { resizedPosterUrl } from '$lib/server/media-server/poster-thumb';

const DAY_MS = 86_400_000;
const MB = 1024 * 1024;

/**
 * Serve an item's poster as a cached, grid-sized thumbnail, addressed by item id.
 * The media-server poster URL (which carries the token/api_key) is resolved
 * server-side, so the token never reaches the client and there is no client-supplied
 * URL to forge. Bytes are cached on disk via the shared thumbnail cache.
 */
export const GET: RequestHandler = async ({ params }) => {
	const id = Number(params.id);
	if (!Number.isFinite(id)) throw error(400, 'invalid id');

	const item = await getMediaItem(id);
	if (!item?.currentPosterUrl) throw error(404, 'no poster');

	const config = await resolveConfig();
	const url = resizedPosterUrl(config.serverType, item.currentPosterUrl);

	try {
		const { bytes, contentType } = await getOrFetchThumb(url, {
			ttlMs: config.thumbCacheTtlDays * DAY_MS,
			maxBytes: config.thumbCacheMaxMb * MB
		});
		return new Response(new Uint8Array(bytes), {
			headers: {
				'content-type': contentType,
				// Bytes for a given item+poster are stable; let the browser cache hard.
				'cache-control': 'private, max-age=604800, immutable'
			}
		});
	} catch {
		throw error(502, 'poster fetch failed');
	}
};
