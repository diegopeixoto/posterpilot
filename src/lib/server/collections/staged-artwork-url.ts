const ALLOWED_ARTWORK_DOMAINS = ['tmdb.org', 'mediux.pro', 'fanart.tv', 'theposterdb.com'];
const CREDENTIAL_QUERY_KEYS = new Set([
	'x-plex-token',
	'api_key',
	'apikey',
	'api-key',
	'access_token',
	'token'
]);

/** Restrict staged previews to known public artwork CDNs without credential-bearing URLs. */
export function safeStagedArtworkUrl(value: string): string | null {
	try {
		const url = new URL(value);
		if (url.protocol !== 'https:') return null;
		if (url.username || url.password) return null;
		const hostname = url.hostname.toLowerCase();
		if (
			!ALLOWED_ARTWORK_DOMAINS.some(
				(domain) => hostname === domain || hostname.endsWith(`.${domain}`)
			)
		) {
			return null;
		}
		for (const key of url.searchParams.keys()) {
			if (CREDENTIAL_QUERY_KEYS.has(key.toLowerCase())) return null;
		}
		url.hash = '';
		return url.toString();
	} catch {
		return null;
	}
}

/** Keep proxied candidate responses raster-only and safe to serve from this origin. */
export function safeStagedArtworkContentType(value: string): string | null {
	const contentType = value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
	return contentType.startsWith('image/') && !contentType.includes('svg') ? contentType : null;
}
