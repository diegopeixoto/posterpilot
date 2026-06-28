import type { RequestHandler } from './$types';
import { getOrFetchThumb } from '$lib/server/posters/thumb-cache';
import { resolveConfig } from '$lib/server/config';

/**
 * Registrable domains of the artwork providers PosterPilot fetches previews from.
 * The proxy only ever serves provider artwork, so restricting to these CDNs closes
 * the SSRF surface (a user can't coerce the server into fetching an arbitrary, e.g.
 * internal/metadata, URL through this endpoint). Subdomains are allowed.
 */
const ALLOWED_THUMB_DOMAINS = ['tmdb.org', 'mediux.pro', 'fanart.tv', 'theposterdb.com'];

function isAllowedThumbHost(hostname: string): boolean {
	const h = hostname.toLowerCase();
	return ALLOWED_THUMB_DOMAINS.some((d) => h === d || h.endsWith('.' + d));
}

/**
 * Binary thumbnail proxy: caches provider preview images on disk and serves them
 * from `?url=`. Only http/https URLs on the known artwork CDNs are allowed. Cache
 * headers are long-lived and immutable since the bytes for a given URL never change.
 */
export const GET: RequestHandler = async (event) => {
	const url = event.url.searchParams.get('url');
	if (!url) {
		return new Response('Missing "url" query parameter', { status: 400 });
	}

	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return new Response('Invalid "url" query parameter', { status: 400 });
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		return new Response('Only http/https URLs are allowed', { status: 400 });
	}
	// SSRF guard: only fetch from the known artwork-provider CDNs.
	if (!isAllowedThumbHost(parsed.hostname)) {
		return new Response('Host not allowed', { status: 400 });
	}

	try {
		const config = await resolveConfig();
		const { bytes, contentType } = await getOrFetchThumb(url, {
			ttlMs: config.thumbCacheTtlDays * 24 * 60 * 60 * 1000,
			maxBytes: config.thumbCacheMaxMb * 1024 * 1024
		});
		// Align the browser cache lifetime with the server-side TTL so a lowered TTL
		// isn't undermined by stale client caches. Bytes for a URL never change, so
		// mark immutable within that window.
		const maxAge = Math.max(0, Math.floor(config.thumbCacheTtlDays * 24 * 60 * 60));
		// Buffer is a Uint8Array, but typed as Node Buffer; wrap so it satisfies BodyInit.
		return new Response(new Uint8Array(bytes), {
			headers: {
				'Content-Type': contentType,
				'Cache-Control': `public, max-age=${maxAge}, immutable`
			}
		});
	} catch {
		return new Response('Failed to fetch thumbnail', { status: 502 });
	}
};
