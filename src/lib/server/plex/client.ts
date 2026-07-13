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
import {
	buildPosterUrl,
	parseGuids,
	parseUpdatedAt,
	parseWatched,
	type PlexRawGuid
} from './parse';

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
	art?: string;
	/** Season/episode ordinal on `/children` responses. */
	index?: number;
	/** Last-modified time as epoch seconds. */
	updatedAt?: number;
	/** Library-insertion time as epoch seconds. */
	addedAt?: number;
	/** Times a movie has been played. */
	viewCount?: number;
	/** Total episodes of a show. */
	leafCount?: number;
	/** Played episodes of a show. */
	viewedLeafCount?: number;
	Guid?: PlexRawGuid[];
}

interface MetadataContainer {
	Metadata?: MetadataEntry[];
}

/** A show's season or episode child: its rating key and its season/episode number. */
export interface PlexChild {
	ratingKey: string;
	index: number | null;
	currentPosterUrl: string | null;
	currentBackgroundUrl: string | null;
	serverUpdatedAt: Date | null;
}

export interface PlexArtworkRead {
	url: string;
	identity: string;
	data: ArrayBuffer;
	contentType: string | null;
}

export interface PlexNativeCollectionMember {
	ratingKey: string;
	title: string | null;
	year: number | null;
}

export interface PlexNativeCollection {
	ratingKey: string;
	title: string;
	members: PlexNativeCollectionMember[];
	currentPosterUrl: string | null;
	currentBackgroundUrl: string | null;
	libraryKeys: string[];
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
export async function testConnection(
	baseUrl: string,
	token: string
): Promise<PlexConnectionResult> {
	const url = `${normalizeBase(baseUrl)}/identity`;
	try {
		// Abort after 8s so an unreachable/wrong URL fails fast instead of hanging.
		const res = await fetch(url, {
			headers: plexHeaders(token),
			signal: AbortSignal.timeout(8000)
		});
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
		const res = await fetch(`${normalizeBase(baseUrl)}/`, {
			headers: plexHeaders(token),
			signal: AbortSignal.timeout(8000)
		});
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
	return metadata.map((entry) => {
		const type = entry.type === 'show' ? ('show' as const) : ('movie' as const);
		return {
			ratingKey: entry.ratingKey,
			title: entry.title,
			year: typeof entry.year === 'number' ? entry.year : null,
			type,
			guids: parseGuids(entry.Guid),
			currentPosterUrl: buildPosterUrl(baseUrl, entry.thumb, token),
			currentBackgroundUrl: buildPosterUrl(baseUrl, entry.art, token),
			serverUpdatedAt: parseUpdatedAt(entry.updatedAt),
			addedAt: parseUpdatedAt(entry.addedAt),
			watched: parseWatched(type, entry)
		};
	});
}

/**
 * Discover Plex collection containers and their exact rating-key members for the
 * requested sections. Collection title is display metadata only; identity is the
 * provider-native collection rating key.
 */
export async function listCollections(
	baseUrl: string,
	token: string,
	sectionKeys: string[]
): Promise<PlexNativeCollection[]> {
	const byId = new Map<string, PlexNativeCollection>();
	for (const sectionKey of [...new Set(sectionKeys)]) {
		const container = await getContainer<MetadataContainer>(
			baseUrl,
			token,
			`/library/sections/${encodeURIComponent(sectionKey)}/collections`
		);
		for (const entry of container.Metadata ?? []) {
			if (!entry.ratingKey || entry.type !== 'collection') continue;
			const children = await getContainer<MetadataContainer>(
				baseUrl,
				token,
				`/library/metadata/${encodeURIComponent(entry.ratingKey)}/children`
			);
			const prior = byId.get(entry.ratingKey);
			const members = new Map((prior?.members ?? []).map((member) => [member.ratingKey, member]));
			for (const child of children.Metadata ?? []) {
				if (!child.ratingKey) continue;
				members.set(child.ratingKey, {
					ratingKey: child.ratingKey,
					title: child.title?.trim() || null,
					year: typeof child.year === 'number' ? child.year : null
				});
			}
			byId.set(entry.ratingKey, {
				ratingKey: entry.ratingKey,
				title: entry.title?.trim() || entry.ratingKey,
				members: [...members.values()],
				currentPosterUrl: buildPosterUrl(baseUrl, entry.thumb, token),
				currentBackgroundUrl: buildPosterUrl(baseUrl, entry.art, token),
				libraryKeys: [...new Set([...(prior?.libraryKeys ?? []), sectionKey])]
			});
		}
	}
	return [...byId.values()];
}

/**
 * List a metadata item's direct children: a show's seasons, or a season's
 * episodes. Plex exposes both via `/library/metadata/{ratingKey}/children`, where
 * each child's `index` is its season or episode number. Children without a numeric
 * index are returned with `index: null` so the caller can skip them.
 *
 * @param baseUrl The Plex server base URL.
 * @param token The `X-Plex-Token` to authenticate with.
 * @param ratingKey The parent item's rating key (show for seasons, season for episodes).
 * @returns Each child's rating key and numeric index.
 */
export async function listChildren(
	baseUrl: string,
	token: string,
	ratingKey: string
): Promise<PlexChild[]> {
	const container = await getContainer<MetadataContainer>(
		baseUrl,
		token,
		`/library/metadata/${encodeURIComponent(ratingKey)}/children`
	);
	return (container.Metadata ?? []).map((entry) => ({
		ratingKey: entry.ratingKey,
		index: typeof entry.index === 'number' ? entry.index : null,
		currentPosterUrl: buildPosterUrl(baseUrl, entry.thumb, token),
		currentBackgroundUrl: buildPosterUrl(baseUrl, entry.art, token),
		serverUpdatedAt: parseUpdatedAt(entry.updatedAt)
	}));
}

/** Read exact current artwork bytes plus the native path used for stale checks. */
export async function readArtwork(
	baseUrl: string,
	token: string,
	ratingKey: string,
	kind: 'poster' | 'background'
): Promise<PlexArtworkRead | null> {
	const container = await getContainer<MetadataContainer>(
		baseUrl,
		token,
		`/library/metadata/${encodeURIComponent(ratingKey)}`
	);
	const entry = container.Metadata?.[0];
	const identity = kind === 'poster' ? entry?.thumb : entry?.art;
	if (!identity) return null;
	const url = buildPosterUrl(baseUrl, identity, token)!;
	const response = await fetch(url, {
		headers: plexHeaders(token),
		signal: AbortSignal.timeout(15_000)
	});
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`Plex artwork read failed (${response.status}).`);
	return {
		url,
		identity,
		data: await response.arrayBuffer(),
		contentType: response.headers.get('content-type')
	};
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
	await uploadImageFromUrl(baseUrl, token, ratingKey, posterUrl, 'poster');
}

/**
 * Upload raw image bytes as an item's poster (e.g. a user's custom file) and lock
 * the field. Posts the bytes directly to the `posters` endpoint, so no public
 * hosting is needed. Throws with the Plex status text on failure.
 *
 * @param baseUrl The Plex server base URL.
 * @param token The `X-Plex-Token` to authenticate with.
 * @param ratingKey The item's rating key.
 * @param data The image bytes.
 * @param contentType The image MIME type (defaults to image/jpeg).
 */
export async function uploadPosterBytes(
	baseUrl: string,
	token: string,
	ratingKey: string,
	data: ArrayBuffer,
	contentType = 'image/jpeg'
): Promise<void> {
	await uploadImageBytes(baseUrl, token, ratingKey, data, contentType, 'poster');
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
	await setFieldLock(baseUrl, token, ratingKey, 'thumb', locked, 'poster');
}

/**
 * Apply a background/art image to an item by URL and lock the art field. Mirrors
 * {@link uploadPosterFromUrl} but targets the Plex `arts` endpoint and `art.locked`.
 */
export async function uploadBackgroundFromUrl(
	baseUrl: string,
	token: string,
	ratingKey: string,
	backgroundUrl: string
): Promise<void> {
	await uploadImageFromUrl(baseUrl, token, ratingKey, backgroundUrl, 'background');
}

/**
 * Upload raw image bytes as an item's background/art and lock the art field.
 * Mirrors {@link uploadPosterBytes} against the Plex `arts` endpoint.
 */
export async function uploadBackgroundBytes(
	baseUrl: string,
	token: string,
	ratingKey: string,
	data: ArrayBuffer,
	contentType = 'image/jpeg'
): Promise<void> {
	await uploadImageBytes(baseUrl, token, ratingKey, data, contentType, 'background');
}

/** Lock or unlock an item's background/art field (`art.locked`). */
export async function setBackgroundLock(
	baseUrl: string,
	token: string,
	ratingKey: string,
	locked: boolean
): Promise<void> {
	await setFieldLock(baseUrl, token, ratingKey, 'art', locked, 'background');
}

// Poster vs background differ only by the Plex endpoint and the lock field; the
// upload flow is otherwise identical, so both go through these two helpers.
type ImageKind = 'poster' | 'background';
const IMAGE_ENDPOINT: Record<ImageKind, string> = { poster: 'posters', background: 'arts' };
const LOCK_FIELD: Record<ImageKind, 'thumb' | 'art'> = { poster: 'thumb', background: 'art' };

/** Tell Plex to fetch `imageUrl` for the given image kind, then lock the field. */
async function uploadImageFromUrl(
	baseUrl: string,
	token: string,
	ratingKey: string,
	imageUrl: string,
	kind: ImageKind
): Promise<void> {
	const base = normalizeBase(baseUrl);
	const key = encodeURIComponent(ratingKey);
	const encodedUrl = encodeURIComponent(imageUrl);
	const encodedToken = encodeURIComponent(token);
	const uploadUrl = `${base}/library/metadata/${key}/${IMAGE_ENDPOINT[kind]}?url=${encodedUrl}&X-Plex-Token=${encodedToken}`;
	const uploadRes = await fetch(uploadUrl, { method: 'POST', headers: plexHeaders(token) });
	if (!uploadRes.ok) {
		throw new Error(
			`Plex rejected the ${kind} upload: HTTP ${uploadRes.status} ${uploadRes.statusText}`
		);
	}
	// Only lock once the image has been accepted.
	await setFieldLock(baseUrl, token, ratingKey, LOCK_FIELD[kind], true, kind);
}

/** POST raw image bytes for the given image kind, then lock the field. */
async function uploadImageBytes(
	baseUrl: string,
	token: string,
	ratingKey: string,
	data: ArrayBuffer,
	contentType: string,
	kind: ImageKind
): Promise<void> {
	const base = normalizeBase(baseUrl);
	const key = encodeURIComponent(ratingKey);
	const url = `${base}/library/metadata/${key}/${IMAGE_ENDPOINT[kind]}?X-Plex-Token=${encodeURIComponent(token)}`;
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'X-Plex-Token': token, 'Content-Type': contentType },
		body: data
	});
	if (!res.ok) {
		throw new Error(`Plex rejected the ${kind} upload: HTTP ${res.status} ${res.statusText}`);
	}
	await setFieldLock(baseUrl, token, ratingKey, LOCK_FIELD[kind], true, kind);
}

/** Shared PUT that toggles a Plex metadata lock field (`thumb.locked`/`art.locked`). */
async function setFieldLock(
	baseUrl: string,
	token: string,
	ratingKey: string,
	field: 'thumb' | 'art',
	locked: boolean,
	label: string
): Promise<void> {
	const base = normalizeBase(baseUrl);
	const key = encodeURIComponent(ratingKey);
	const encodedToken = encodeURIComponent(token);
	const url = `${base}/library/metadata/${key}?${field}.locked=${locked ? 1 : 0}&X-Plex-Token=${encodedToken}`;
	const res = await fetch(url, { method: 'PUT', headers: plexHeaders(token) });
	if (!res.ok) {
		throw new Error(
			`Plex rejected ${locked ? 'locking' : 'unlocking'} the ${label}: HTTP ${res.status} ${res.statusText}`
		);
	}
}
