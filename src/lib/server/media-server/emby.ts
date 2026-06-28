/**
 * Jellyfin / Emby provider.
 *
 * Jellyfin forked from Emby, so their relevant HTTP endpoints match: identity via
 * `GET /System/Info`, library + item listing via `/Items`, external ids in
 * `ProviderIds`, current art via `/Items/{id}/Images/{type}`, and apply via
 * `POST /Items/{id}/Images/{type}`. The few real differences (auth header name)
 * are isolated behind the `flavor` flag.
 *
 * All pure mapping (ProviderIds → guids, `/Items` JSON → `ServerItem[]`) lives in
 * `emby-parse.ts` and is unit-tested; this module only does the network calls.
 */

import {
	mapChildren,
	mapItems,
	mapLibraries,
	parseAuthResult,
	type AuthResult,
	type RawEmbyItemsResponse
} from './emby-parse';
import type {
	ConnectionResult,
	LockField,
	MediaServer,
	ServerChild,
	ServerItem,
	ServerLibrary
} from './types';
import { version } from '$lib/version';

export type EmbyFlavor = 'jellyfin' | 'emby';

/**
 * A login failure that carries the HTTP status the API route should return, so
 * invalid credentials (401) are distinguishable from upstream/network errors (502).
 */
export class MediaServerLoginError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
		this.name = 'MediaServerLoginError';
	}
}

/**
 * Exchange a username + password for an access token via `/Users/AuthenticateByName`,
 * so users don't have to hunt for an API key. The pre-token request still needs a
 * client-identification header: Jellyfin reads `Authorization: MediaBrowser ...`,
 * Emby reads `X-Emby-Authorization` — we send both for resilience. The returned
 * access token is then stored (encrypted) as the server's API key.
 */
export async function loginByName(
	baseUrl: string,
	username: string,
	password: string,
	flavor: EmbyFlavor
): Promise<AuthResult> {
	const base = normalizeBase(baseUrl);
	const label = flavor === 'jellyfin' ? 'Jellyfin' : 'Emby';
	const authValue = `MediaBrowser Client="PosterPilot", Device="PosterPilot", DeviceId="posterpilot", Version="${version}"`;
	let res: Response;
	try {
		res = await fetch(`${base}/Users/AuthenticateByName`, {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				Authorization: authValue,
				'X-Emby-Authorization': authValue
			},
			body: JSON.stringify({ Username: username, Pw: password }),
			// A login endpoint should never redirect; refuse to follow one (SSRF hardening).
			redirect: 'error',
			signal: AbortSignal.timeout(8000)
		});
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		throw new MediaServerLoginError(`Unreachable: could not connect to ${label} (${reason}).`, 502);
	}
	if (res.status === 401 || res.status === 403) {
		throw new MediaServerLoginError(
			`Unauthorized: ${label} rejected the username or password.`,
			401
		);
	}
	if (!res.ok) {
		throw new MediaServerLoginError(
			`${label} returned HTTP ${res.status} ${res.statusText} during login.`,
			502
		);
	}
	const result = parseAuthResult((await res.json()) as Parameters<typeof parseAuthResult>[0]);
	if (!result) {
		throw new MediaServerLoginError(`${label} login did not return an access token.`, 502);
	}
	return result;
}

/** Strip a single trailing slash so paths concatenate cleanly. */
function normalizeBase(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, '');
}

/**
 * Auth + accept headers for the chosen flavor. Jellyfin authenticates via
 * `Authorization: MediaBrowser Token="<key>"`; Emby via `X-Emby-Token: <key>`.
 * Both also commonly accept `X-MediaBrowser-Token`, which we send for resilience.
 */
function authHeaders(apiKey: string, flavor: EmbyFlavor): Record<string, string> {
	const common: Record<string, string> = {
		Accept: 'application/json',
		'X-MediaBrowser-Token': apiKey
	};
	if (flavor === 'jellyfin') {
		return {
			...common,
			Authorization: `MediaBrowser Token="${apiKey}"`
		};
	}
	return {
		...common,
		'X-Emby-Token': apiKey
	};
}

interface SystemInfo {
	ServerName?: string;
	Version?: string;
}

/** Convert image bytes to a base64 string (the documented image POST body). */
function toBase64(data: ArrayBuffer): string {
	return Buffer.from(data).toString('base64');
}

/**
 * Construct a Jellyfin/Emby `MediaServer` bound to a base URL + API key.
 *
 * @param baseUrl The server base URL.
 * @param apiKey The API key used for authentication.
 * @param flavor `jellyfin` or `emby` — selects the auth header dialect.
 */
export function embyLikeProvider(baseUrl: string, apiKey: string, flavor: EmbyFlavor): MediaServer {
	const base = normalizeBase(baseUrl);
	const headers = authHeaders(apiKey, flavor);
	const label = flavor === 'jellyfin' ? 'Jellyfin' : 'Emby';

	async function getJson<T>(path: string): Promise<T> {
		const res = await fetch(`${base}${path}`, { headers });
		if (!res.ok) {
			throw new Error(`${label} returned HTTP ${res.status} ${res.statusText} for ${path}`);
		}
		return (await res.json()) as T;
	}

	/** POST raw image bytes (base64 body + image content-type) to an Images endpoint. */
	async function postImage(
		itemId: string,
		imageType: 'Primary' | 'Backdrop',
		data: ArrayBuffer,
		contentType: string
	): Promise<void> {
		const url = `${base}/Items/${encodeURIComponent(itemId)}/Images/${imageType}`;
		const res = await fetch(url, {
			method: 'POST',
			headers: { ...headers, 'Content-Type': contentType },
			body: toBase64(data)
		});
		if (!res.ok) {
			throw new Error(`${label} rejected the image upload: HTTP ${res.status} ${res.statusText}`);
		}
	}

	/** Fetch an image URL into bytes + its content type for byte-based apply. */
	async function fetchImage(url: string): Promise<{ data: ArrayBuffer; contentType: string }> {
		const res = await fetch(url);
		if (!res.ok) {
			throw new Error(`Could not fetch image (${res.status} ${res.statusText}): ${url}`);
		}
		const contentType = res.headers.get('content-type') ?? 'image/jpeg';
		return { data: await res.arrayBuffer(), contentType };
	}

	return {
		type: flavor,

		async testConnection(): Promise<ConnectionResult> {
			try {
				// Abort after 8s so an unreachable/wrong URL fails fast instead of hanging.
				const res = await fetch(`${base}/System/Info`, {
					headers,
					signal: AbortSignal.timeout(8000)
				});
				if (res.status === 401 || res.status === 403) {
					return {
						ok: false,
						unauthorized: true,
						error: `Unauthorized: the ${label} API key was rejected (${res.status}).`
					};
				}
				if (!res.ok) {
					return { ok: false, error: `${label} returned HTTP ${res.status} ${res.statusText}.` };
				}
				const info = (await res.json()) as SystemInfo;
				return { ok: true, serverName: info.ServerName, version: info.Version };
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				return { ok: false, error: `Unreachable: could not connect to ${label} (${reason}).` };
			}
		},

		async listLibraries(): Promise<ServerLibrary[]> {
			// MediaFolders enumerates the top-level libraries with their CollectionType.
			const res = await getJson<RawEmbyItemsResponse>('/Library/MediaFolders');
			return mapLibraries(res);
		},

		async listItems(libraryKey: string): Promise<ServerItem[]> {
			const params = new URLSearchParams({
				ParentId: libraryKey,
				Recursive: 'true',
				IncludeItemTypes: 'Movie,Series',
				Fields: 'ProviderIds,ProductionYear,DateLastModified',
				EnableImageTypes: 'Primary,Backdrop'
			});
			const res = await getJson<RawEmbyItemsResponse>(`/Items?${params.toString()}`);
			return mapItems(res, base, apiKey);
		},

		async listSeasons(showId: string): Promise<ServerChild[]> {
			const params = new URLSearchParams({ ParentId: showId, IncludeItemTypes: 'Season' });
			return mapChildren(await getJson<RawEmbyItemsResponse>(`/Items?${params.toString()}`));
		},

		async listEpisodes(seasonId: string): Promise<ServerChild[]> {
			const params = new URLSearchParams({ ParentId: seasonId, IncludeItemTypes: 'Episode' });
			return mapChildren(await getJson<RawEmbyItemsResponse>(`/Items?${params.toString()}`));
		},

		async applyPosterUrl(itemId: string, url: string): Promise<void> {
			const { data, contentType } = await fetchImage(url);
			await postImage(itemId, 'Primary', data, contentType);
		},

		async applyPosterBytes(itemId, data, contentType = 'image/jpeg'): Promise<void> {
			await postImage(itemId, 'Primary', data, contentType);
		},

		async applyBackgroundUrl(itemId: string, url: string): Promise<void> {
			const { data, contentType } = await fetchImage(url);
			await postImage(itemId, 'Backdrop', data, contentType);
		},

		async applyBackgroundBytes(itemId, data, contentType = 'image/jpeg'): Promise<void> {
			await postImage(itemId, 'Backdrop', data, contentType);
		},

		// Jellyfin/Emby do not auto-replace an explicitly set image, so there is no
		// lock concept. The interface still exposes lockField for parity.
		async lockField(_itemId: string, _field: LockField, _locked: boolean): Promise<void> {
			// no-op
		}
	};
}
