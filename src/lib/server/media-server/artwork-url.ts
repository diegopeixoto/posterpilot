import type { ServerType } from './types';

const SECRET_QUERY_KEY = /(token|api.?key|auth|credential|signature|secret|password)/i;
const SECRET_MARKER =
	/(?:^|[?&;])[^=]*(?:token|api.?key|auth|credential|signature|secret|password)[^=]*\s*=/i;

function decodeForInspection(value: string): string {
	let decoded = value;
	for (let pass = 0; pass < 3; pass += 1) {
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
 * Return a credential-free absolute HTTP(S) artwork URL suitable for SQLite,
 * operation plans, cache metadata, logs, and backup bundles. Ambiguous values
 * fail closed instead of retaining a possibly encoded secret.
 */
export function sanitizeServerArtworkUrl(value: string | null): string | null {
	if (!value?.trim()) return null;
	try {
		const url = new URL(value.trim());
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
		url.username = '';
		url.password = '';
		url.hash = '';
		for (const key of [...url.searchParams.keys()]) {
			if (SECRET_QUERY_KEY.test(key)) url.searchParams.delete(key);
		}
		const sanitized = url.toString();
		return SECRET_MARKER.test(decodeForInspection(sanitized)) ? null : sanitized;
	} catch {
		return null;
	}
}

function pathBelongsToBase(pathname: string, basePathname: string): boolean {
	const prefix = basePathname.replace(/\/+$/, '');
	return (
		prefix === '' || prefix === '/' || pathname === prefix || pathname.startsWith(`${prefix}/`)
	);
}

/**
 * Rehydrate the concrete server credential immediately before a server-side image
 * fetch. The credential is never returned to a browser or persisted. Origin and
 * optional base-path checks prevent sending a server token to a crafted host.
 */
export function authenticateServerArtworkUrl(input: {
	serverType: ServerType;
	baseUrl: string;
	credential: string;
	storedUrl: string;
}): string | null {
	if (!input.credential) return null;
	const sanitized = sanitizeServerArtworkUrl(input.storedUrl);
	if (!sanitized) return null;
	try {
		const artwork = new URL(sanitized);
		const base = new URL(input.baseUrl);
		if (artwork.origin !== base.origin || !pathBelongsToBase(artwork.pathname, base.pathname)) {
			return null;
		}
		artwork.searchParams.set(
			input.serverType === 'plex' ? 'X-Plex-Token' : 'api_key',
			input.credential
		);
		return artwork.toString();
	} catch {
		return null;
	}
}

/** Query-free target label for status errors; it cannot include URL credentials. */
export function safeArtworkRequestTarget(value: string): string {
	try {
		const url = new URL(value);
		return `${url.origin}${url.pathname}`;
	} catch {
		return '[invalid URL]';
	}
}
