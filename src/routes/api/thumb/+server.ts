import type { RequestHandler } from './$types';
import { getOrFetchThumb } from '$lib/server/posters/thumb-cache';
import { resolveConfig } from '$lib/server/config';
import {
	safeStagedArtworkContentType,
	safeStagedArtworkUrl
} from '$lib/server/collections/staged-artwork-url';

/**
 * Binary thumbnail proxy: caches provider preview images on disk and serves them
 * from `?url=`. Only HTTPS URLs on the known artwork CDNs are allowed. Cache
 * headers are long-lived and immutable since the bytes for a given URL never change.
 */
export const GET: RequestHandler = async (event) => {
	const url = event.url.searchParams.get('url');
	if (!url) {
		return new Response('Missing "url" query parameter', { status: 400 });
	}

	const source = safeStagedArtworkUrl(url);
	if (!source) return new Response('Artwork URL not allowed', { status: 400 });

	try {
		const config = await resolveConfig();
		const { bytes, contentType } = await getOrFetchThumb(source, {
			ttlMs: config.thumbCacheTtlDays * 24 * 60 * 60 * 1000,
			maxBytes: config.thumbCacheMaxMb * 1024 * 1024
		});
		const safeContentType = safeStagedArtworkContentType(contentType);
		if (!safeContentType) throw new Error('Unsupported thumbnail content type');
		// Align the browser cache lifetime with the server-side TTL so a lowered TTL
		// isn't undermined by stale client caches. Bytes for a URL never change, so
		// mark immutable within that window.
		const maxAge = Math.max(0, Math.floor(config.thumbCacheTtlDays * 24 * 60 * 60));
		// Buffer is a Uint8Array, but typed as Node Buffer; wrap so it satisfies BodyInit.
		return new Response(new Uint8Array(bytes), {
			headers: {
				'content-type': safeContentType,
				'cache-control': `public, max-age=${maxAge}, immutable`,
				'x-content-type-options': 'nosniff',
				'content-security-policy': "default-src 'none'; sandbox"
			}
		});
	} catch {
		return new Response('Failed to fetch thumbnail', { status: 502 });
	}
};
