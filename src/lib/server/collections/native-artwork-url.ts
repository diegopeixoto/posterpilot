const CREDENTIAL_QUERY_KEYS = new Set(['x-plex-token', 'api_key']);
const CREDENTIAL_MARKER = /(?:^|[?&;])(?:x-plex-token|api_key)\s*=/i;

function decodeForInspection(value: string): string {
	let decoded = value;
	for (let pass = 0; pass < 3; pass++) {
		try {
			const next = decodeURIComponent(decoded.replace(/\+/g, ' '));
			if (next === decoded) break;
			decoded = next;
		} catch {
			break;
		}
	}
	return decoded;
}

/**
 * Produce a credential-free native collection artwork URL for persistence.
 * Invalid, non-HTTP, or ambiguously encoded values are discarded rather than
 * risking a media-server credential being written to SQLite.
 */
export function sanitizeNativeCollectionArtworkUrl(value: string | null): string | null {
	if (!value?.trim()) return null;
	try {
		const url = new URL(value.trim());
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

		url.username = '';
		url.password = '';
		url.hash = '';
		for (const key of [...url.searchParams.keys()]) {
			if (CREDENTIAL_QUERY_KEYS.has(key.toLowerCase())) url.searchParams.delete(key);
		}

		const sanitized = url.toString();
		return CREDENTIAL_MARKER.test(decodeForInspection(sanitized)) ? null : sanitized;
	} catch {
		return null;
	}
}
