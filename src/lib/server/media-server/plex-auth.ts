/**
 * plex.tv auth + discovery client (server-side only).
 *
 * Implements the PIN-based token-acquire flow and connection discovery against
 * plex.tv. The product/client-identifier headers stay server-side. Response
 * shaping is delegated to the pure parsers in `plex-auth-parse.ts`.
 */

import {
	parseConnections,
	parseCreatedPin,
	parsePinToken,
	type CreatedPin,
	type RawPin,
	type RawResource
} from './plex-auth-parse';
import type { ConnectionCandidate } from './types';
import { version } from '$lib/version';

const PLEX_TV = 'https://plex.tv/api/v2';
const PRODUCT = 'PosterPilot';
const DEVICE = 'PosterPilot';

/**
 * A plex.tv failure with a curated, secret-free message. API routes surface this
 * message verbatim; any other error type must stay behind a generic response.
 */
export class PlexAuthError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'PlexAuthError';
	}
}

/** plex.tv fetch with a hard timeout; network failures become curated errors. */
async function plexTvFetch(path: string, init: RequestInit, what: string): Promise<Response> {
	try {
		return await fetch(`${PLEX_TV}${path}`, { ...init, signal: AbortSignal.timeout(8000) });
	} catch (err) {
		throw new PlexAuthError(`plex.tv is unreachable (${what}).`, { cause: err });
	}
}

/**
 * Headers every plex.tv call carries. Beyond the product + stable client
 * identifier, plex.tv uses the device/platform/version fields to register the
 * acquired token as a recognizable device entry in the user's account
 * (https://developer.plex.tv). The client identifier must stay stable per
 * install so plex.tv treats every call as the same client.
 */
function plexTvHeaders(clientId: string): Record<string, string> {
	return {
		Accept: 'application/json',
		'X-Plex-Product': PRODUCT,
		'X-Plex-Version': version,
		'X-Plex-Client-Identifier': clientId,
		'X-Plex-Device': DEVICE,
		'X-Plex-Device-Name': DEVICE,
		'X-Plex-Platform': 'Web'
	};
}

/**
 * Create a strong PIN. Returns the pin id + code; the user authorizes the code at
 * https://plex.tv/link, after which {@link pollPin} returns the token.
 */
export async function createPin(clientId: string): Promise<CreatedPin> {
	const res = await plexTvFetch(
		'/pins?strong=true',
		{ method: 'POST', headers: plexTvHeaders(clientId) },
		'PIN request'
	);
	if (!res.ok) {
		throw new PlexAuthError(
			`plex.tv rejected the PIN request: HTTP ${res.status} ${res.statusText}`
		);
	}
	const raw = (await res.json()) as RawPin;
	return parseCreatedPin(raw);
}

/**
 * Poll a PIN once. Returns the `authToken` when the user has authorized the code,
 * or null while still pending. Callers poll on an interval until non-null or the
 * PIN's expiry passes.
 */
export async function pollPin(id: number, clientId: string): Promise<string | null> {
	const res = await plexTvFetch(
		`/pins/${encodeURIComponent(String(id))}`,
		{ headers: plexTvHeaders(clientId) },
		'PIN poll'
	);
	if (!res.ok) {
		throw new PlexAuthError(`plex.tv PIN poll failed: HTTP ${res.status} ${res.statusText}`);
	}
	const raw = (await res.json()) as RawPin;
	return parsePinToken(raw);
}

/**
 * Discover the user's Plex servers and their connections (local/remote/relay).
 * Requires a Plex token.
 */
export async function listConnections(
	token: string,
	clientId: string
): Promise<ConnectionCandidate[]> {
	const res = await plexTvFetch(
		'/resources?includeHttps=1',
		{ headers: { ...plexTvHeaders(clientId), 'X-Plex-Token': token } },
		'resources lookup'
	);
	if (!res.ok) {
		throw new PlexAuthError(
			`plex.tv resources lookup failed: HTTP ${res.status} ${res.statusText}`
		);
	}
	const raw = (await res.json()) as RawResource[];
	return parseConnections(raw);
}
