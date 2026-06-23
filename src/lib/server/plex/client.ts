/**
 * Plex Media Server HTTP client.
 *
 * Talks to the Plex API directly over `fetch` (no external SDK). Every request
 * sends `X-Plex-Token` and `Accept: application/json` and parses the returned
 * `MediaContainer`. Read calls go through the shared `fetchJson` helper with
 * caching disabled (Plex library data is dynamic); writes use plain `fetch`.
 *
 * Callers pass `baseUrl` and `token` explicitly — this module never reads config.
 */

import { fetchJson } from '$lib/server/http';
import type { PlexItem, PlexSection } from '$lib/server/types';
import { buildPosterUrl, parseGuids, type PlexRawGuid } from './parse';

/** Shape of a Plex API JSON response: everything lives under `MediaContainer`. */
interface PlexResponse<T> {
	MediaContainer: T;
}

interface IdentityContainer {
	machineIdentifier?: string;
	version?: string;
	friendlyName?: string;
}

interface ServerRootContainer {
	friendlyName?: string;
	version?: string;
}

interface DirectoryEntry {
	key: string;
	title: string;
	type: string;
}

interface SectionsContainer {
	Directory?: DirectoryEntry[];
}

interface MetadataEntry {
	ratingKey: string;
	title: string;
	year?: number;
	type: string;
	thumb?: string;
	Guid?: PlexRawGuid[];
}

interface MetadataContainer {
	Metadata?: MetadataEntry[];
}

/** Headers every Plex request must carry. */
function plexHeaders(token: string): Record<string, string> {
	return { 'X-Plex-Token': token, Accept: 'application/json' };
}

/** Strip a single trailing slash from the base URL so paths concatenate cleanly. */
function normalizeBase(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, '');
}

/** Read-only GET against the Plex API. Caching is disabled (dynamic data). */
async function getContainer<T>(baseUrl: string, token: string, path: string): Promise<T> {
	const res = await fetchJson<PlexResponse<T>>(`${normalizeBase(baseUrl)}${path}`, {
		headers: plexHeaders(token),
		cacheTtlDays: 0,
		retries: 1
	});
	return res.MediaContainer;
}

/** Result of a connection test against a Plex server. */
export interface PlexConnectionResult {
	ok: boolean;
	serverName?: string;
	version?: string;
	/** Human-readable failure reason; present only when `ok` is false. */
	error?: string;
}

/**
 * Verify connectivity and credentials against a Plex server.
 *
 * Queries the `/identity` endpoint (and best-effort `/` for `friendlyName`),
 * distinguishing an unauthorized token (HTTP 401) from an unreachable server
 * (network/DNS error). Never throws — failures are returned as `ok: false`.
 *
 * @param baseUrl The Plex server base URL.
 * @param token The `X-Plex-Token` to authenticate with.
 * @returns Connection status with server name/version on success, or a reason.
 */
export async function testConnection(baseUrl: string, token: string): Promise<PlexConnectionResult> {
	const url = `${normalizeBase(baseUrl)}/identity`;
	try {
		const res = await fetch(url, { headers: plexHeaders(token) });
		if (res.status === 401) {
			return { ok: false, error: 'Unauthorized: the Plex token was rejected (401).' };
		}
		if (!res.ok) {
			return { ok: false, error: `Plex server returned HTTP ${res.status} ${res.statusText}.` };
		}

		const identity = ((await res.json()) as PlexResponse<IdentityContainer>).MediaContainer ?? {};
		const version = identity.version;
		let serverName = identity.friendlyName;

		// `/identity` omits friendlyName on some versions; fall back to the root.
		if (!serverName) {
			serverName = await fetchFriendlyName(baseUrl, token);
		}

		return { ok: true, serverName, version };
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		return { ok: false, error: `Unreachable: could not connect to the Plex server (${reason}).` };
	}
}

/** Best-effort lookup of the server's friendly name via the root endpoint. */
async function fetchFriendlyName(baseUrl: string, token: string): Promise<string | undefined> {
	try {
		const res = await fetch(`${normalizeBase(baseUrl)}/`, { headers: plexHeaders(token) });
		if (!res.ok) return undefined;
		const root = ((await res.json()) as PlexResponse<ServerRootContainer>).MediaContainer ?? {};
		return root.friendlyName;
	} catch {
		return undefined;
	}
}

/**
 * List the server's movie and show library sections.
 *
 * Non-media sections (music, photos, etc.) are filtered out.
 *
 * @param baseUrl The Plex server base URL.
 * @param token The `X-Plex-Token` to authenticate with.
 * @returns The movie/show sections as `{ key, title, type }`.
 */
export async function listSections(baseUrl: string, token: string): Promise<PlexSection[]> {
	const container = await getContainer<SectionsContainer>(baseUrl, token, '/library/sections');
	const directories = container.Directory ?? [];
	const sections: PlexSection[] = [];
	for (const dir of directories) {
		if (dir.type === 'movie' || dir.type === 'show') {
			sections.push({ key: dir.key, title: dir.title, type: dir.type });
		}
	}
	return sections;
}

/**
 * List the items of a library section with their resolvable metadata.
 *
 * Each item carries its rating key, title, year, type, external GUIDs, and the
 * absolute (token-bearing) URL of its current poster. Items lacking any
 * tmdb/imdb/tvdb GUID are still returned with an empty `guids` object so the
 * caller can flag them as unresolvable rather than silently dropping them.
 *
 * @param baseUrl The Plex server base URL.
 * @param token The `X-Plex-Token` to authenticate with.
 * @param sectionKey The section's key (from `listSections`).
 * @returns The section's items mapped to `PlexItem`.
 */
export async function listItems(
	baseUrl: string,
	token: string,
	sectionKey: string
): Promise<PlexItem[]> {
	const container = await getContainer<MetadataContainer>(
		baseUrl,
		token,
		`/library/sections/${encodeURIComponent(sectionKey)}/all?includeGuids=1`
	);
	const metadata = container.Metadata ?? [];
	return metadata.map((entry) => ({
		ratingKey: entry.ratingKey,
		title: entry.title,
		year: typeof entry.year === 'number' ? entry.year : null,
		type: entry.type === 'show' ? 'show' : 'movie',
		guids: parseGuids(entry.Guid),
		currentPosterUrl: buildPosterUrl(baseUrl, entry.thumb, token)
	}));
}

/**
 * Apply a poster to an item by URL and lock the poster field.
 *
 * First POSTs the image URL to the `posters` endpoint so Plex fetches and
 * selects it, then PUTs `thumb.locked=1` so Plex's automatic agents will not
 * overwrite the chosen poster. If the POST fails the field is left unlocked and
 * an error carrying the Plex status text is thrown.
 *
 * @param baseUrl The Plex server base URL.
 * @param token The `X-Plex-Token` to authenticate with.
 * @param ratingKey The item's rating key.
 * @param posterUrl The image URL for Plex to fetch and set as the poster.
 * @throws Error if Plex rejects the upload or the lock request.
 */
export async function uploadPosterFromUrl(
	baseUrl: string,
	token: string,
	ratingKey: string,
	posterUrl: string
): Promise<void> {
	const base = normalizeBase(baseUrl);
	const key = encodeURIComponent(ratingKey);
	const encodedUrl = encodeURIComponent(posterUrl);
	const encodedToken = encodeURIComponent(token);

	const uploadUrl = `${base}/library/metadata/${key}/posters?url=${encodedUrl}&X-Plex-Token=${encodedToken}`;
	const uploadRes = await fetch(uploadUrl, { method: 'POST', headers: plexHeaders(token) });
	if (!uploadRes.ok) {
		throw new Error(
			`Plex rejected the poster upload: HTTP ${uploadRes.status} ${uploadRes.statusText}`
		);
	}

	// Only lock once the poster has been accepted.
	await setPosterLock(baseUrl, token, ratingKey, true);
}

/**
 * Lock or unlock an item's poster field. Unlocking (`locked=false`) lets Plex's
 * agents manage the artwork again — used when reverting to the original poster.
 *
 * @param baseUrl The Plex server base URL.
 * @param token The `X-Plex-Token` to authenticate with.
 * @param ratingKey The item's rating key.
 * @param locked Whether the poster field should be locked.
 * @throws Error if Plex rejects the request.
 */
export async function setPosterLock(
	baseUrl: string,
	token: string,
	ratingKey: string,
	locked: boolean
): Promise<void> {
	const base = normalizeBase(baseUrl);
	const key = encodeURIComponent(ratingKey);
	const encodedToken = encodeURIComponent(token);
	const url = `${base}/library/metadata/${key}?thumb.locked=${locked ? 1 : 0}&X-Plex-Token=${encodedToken}`;
	const res = await fetch(url, { method: 'PUT', headers: plexHeaders(token) });
	if (!res.ok) {
		throw new Error(
			`Plex rejected ${locked ? 'locking' : 'unlocking'} the poster: HTTP ${res.status} ${res.statusText}`
		);
	}
}
