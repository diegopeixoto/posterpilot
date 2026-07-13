import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveConfig } from '$lib/server/config';
import {
	resizedPosterUrl,
	versionedArtworkUrl
} from '$lib/server/media-server/poster-thumb';
import { getOrFetchThumb } from '$lib/server/posters/thumb-cache';
import { getMediaItem, getRootArtworkVersion } from '$lib/server/queries';
import {
	getActiveServerInstance,
	resolveMediaServerInstance
} from '$lib/server/server-instances';
import { authenticateServerArtworkUrl } from '$lib/server/media-server/artwork-url';

const DAY_MS = 86_400_000;
const MB = 1024 * 1024;

/** Token-safe proxy for an indexed item's current poster or background artwork. */
export const GET: RequestHandler = async ({ params }) => {
	const id = Number(params.id);
	if (!Number.isSafeInteger(id) || id <= 0) throw error(400, 'invalid id');
	if (params.kind !== 'poster' && params.kind !== 'background') throw error(400, 'invalid kind');
	const active = await getActiveServerInstance();
	if (!active) throw error(404, 'server instance not found');
	const item = await getMediaItem(id, active.id);
	if (!item) throw error(404, 'item not found');
	const { connection } = await resolveMediaServerInstance(item.serverInstanceId, {
		requireEnabled: true
	});

	const config = await resolveConfig();
	const original =
		params.kind === 'poster'
			? item.currentPosterUrl
			: item.currentBackgroundUrl ?? item.backdropUrl;
	if (!original) throw error(404, 'artwork not found');
	const artworkVersion =
		(await getRootArtworkVersion(item.id, item.serverInstanceId, params.kind)) ??
		item.artworkVersion;
	const storedSource = versionedArtworkUrl(
		params.kind === 'poster' ? resizedPosterUrl(connection.type, original, 1080) : original,
		artworkVersion
	);
	const source =
		params.kind === 'poster' || item.currentBackgroundUrl
			? authenticateServerArtworkUrl({
					serverType: connection.type,
					baseUrl: connection.baseUrl!,
					credential: connection.credential!,
					storedUrl: storedSource
				})
			: storedSource;
	if (!source) throw error(404, 'artwork source unavailable');

	try {
		const { bytes, contentType } = await getOrFetchThumb(source, {
			ttlMs: config.thumbCacheTtlDays * DAY_MS,
			maxBytes: config.thumbCacheMaxMb * MB
		});
		return new Response(new Uint8Array(bytes), {
			headers: {
				'content-type': contentType,
				'x-content-type-options': 'nosniff',
				'content-security-policy': "default-src 'none'; sandbox",
				'cache-control': 'private, max-age=604800, immutable'
			}
		});
	} catch {
		throw error(502, 'artwork fetch failed');
	}
};
