import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMediaItem, getRootArtworkVersion } from '$lib/server/queries';
import { resolveConfig } from '$lib/server/config';
import { getOrFetchThumb } from '$lib/server/posters/thumb-cache';
import { resizedPosterUrl, versionedArtworkUrl } from '$lib/server/media-server/poster-thumb';
import { getActiveServerInstance, resolveMediaServerInstance } from '$lib/server/server-instances';
import { authenticateServerArtworkUrl } from '$lib/server/media-server/artwork-url';

const DAY_MS = 86_400_000;
const MB = 1024 * 1024;

/**
 * Serve an item's poster as a cached, grid-sized thumbnail, addressed by item id.
 * SQLite retains only the credential-free media-server URL. The concrete instance
 * credential is attached server-side immediately before fetch, so it never reaches
 * the browser or cache metadata. Bytes are cached on disk by a one-way identity.
 */
export const GET: RequestHandler = async ({ params }) => {
	const id = Number(params.id);
	if (!Number.isFinite(id)) throw error(400, 'invalid id');

	const active = await getActiveServerInstance();
	if (!active) throw error(404, 'server instance not found');
	const item = await getMediaItem(id, active.id);
	if (!item?.currentPosterUrl) throw error(404, 'no poster');
	const { connection } = await resolveMediaServerInstance(item.serverInstanceId, {
		requireEnabled: true
	});

	const config = await resolveConfig();
	const artworkVersion =
		(await getRootArtworkVersion(item.id, item.serverInstanceId, 'poster')) ?? item.artworkVersion;
	const storedUrl = versionedArtworkUrl(
		resizedPosterUrl(connection.type, item.currentPosterUrl),
		artworkVersion
	);
	const url = authenticateServerArtworkUrl({
		serverType: connection.type,
		baseUrl: connection.baseUrl!,
		credential: connection.credential!,
		storedUrl
	});
	if (!url) throw error(404, 'poster source unavailable');

	try {
		const { bytes, contentType } = await getOrFetchThumb(url, {
			ttlMs: config.thumbCacheTtlDays * DAY_MS,
			maxBytes: config.thumbCacheMaxMb * MB
		});
		return new Response(new Uint8Array(bytes), {
			headers: {
				'content-type': contentType,
				'x-content-type-options': 'nosniff',
				'content-security-policy': "default-src 'none'; sandbox",
				// Bytes for a given item+poster are stable; let the browser cache hard.
				'cache-control': 'private, max-age=604800, immutable'
			}
		});
	} catch {
		throw error(502, 'poster fetch failed');
	}
};
