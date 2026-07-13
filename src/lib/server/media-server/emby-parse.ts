/**
 * Pure parsing/mapping helpers for the Jellyfin/Emby provider.
 *
 * Like `plex/parse.ts`, these functions avoid any framework or I/O imports
 * ($env, db, config, http) so they can be unit-tested without a network. All
 * logic that maps Jellyfin/Emby JSON shapes into our neutral domain lives here.
 */

import type { PlexGuids } from '$lib/server/types';
import type { ServerChild, ServerItem, ServerLibrary, ServerNativeCollection } from './types';

/** External-id sources we extract from Jellyfin/Emby `ProviderIds`, in domain order. */
const PROVIDER_ID_MAP = {
	tmdb: 'tmdb',
	imdb: 'imdb',
	tvdb: 'tvdb'
} as const;

/** A Jellyfin/Emby `ProviderIds` map (keys are case-insensitive in practice). */
export type RawProviderIds = Record<string, string | number | undefined | null>;

/** Minimal shape of a Jellyfin/Emby `/Items` entry we consume. */
export interface RawEmbyItem {
	Id: string;
	Name?: string;
	ProductionYear?: number | null;
	Type?: string;
	CollectionType?: string;
	/** Season/episode ordinal for Season/Episode items. */
	IndexNumber?: number | null;
	ProviderIds?: RawProviderIds;
	ImageTags?: { Primary?: string; [k: string]: string | undefined };
	BackdropImageTags?: string[];
	/** Server's last-modified time as an ISO-8601 string. */
	DateLastModified?: string | null;
	/** When the item was added to the library, as an ISO-8601 string. */
	DateCreated?: string | null;
	/** Per-user playback state (requires the authenticated user context). */
	UserData?: { Played?: boolean | null } | null;
}

/** Shape of the `/Items` (and `/Library/MediaFolders`) response envelope. */
export interface RawEmbyItemsResponse {
	Items?: RawEmbyItem[];
}

/** Minimal shape of a Jellyfin/Emby `/Users/AuthenticateByName` response. */
export interface RawAuthResult {
	AccessToken?: string | null;
	User?: { Id?: string | null; Name?: string | null } | null;
}

/** A successful login: the access token plus the authenticated user's id/name. */
export interface AuthResult {
	accessToken: string;
	userId: string;
	userName: string | null;
}

/**
 * Extract the access token + user from an `AuthenticateByName` response. Returns
 * null when no usable access token is present (treated as an auth failure).
 */
export function parseAuthResult(json: RawAuthResult | undefined | null): AuthResult | null {
	const accessToken = json?.AccessToken;
	if (!accessToken) return null;
	return {
		accessToken,
		userId: json?.User?.Id ? String(json.User.Id) : '',
		userName: json?.User?.Name ? String(json.User.Name) : null
	};
}

/** Map a Jellyfin/Emby `CollectionType` to our movie/show library type, or null. */
export function collectionTypeToLibraryType(
	collectionType: string | undefined | null
): 'movie' | 'show' | null {
	if (!collectionType) return null;
	const t = collectionType.toLowerCase();
	if (t === 'movies') return 'movie';
	if (t === 'tvshows') return 'show';
	return null;
}

/** Map a Jellyfin/Emby item `Type` to our movie/show item type, or null. */
export function itemTypeToMediaType(type: string | undefined | null): 'movie' | 'show' | null {
	if (!type) return null;
	const t = type.toLowerCase();
	if (t === 'movie') return 'movie';
	if (t === 'series') return 'show';
	return null;
}

/**
 * Extract tmdb/imdb/tvdb ids from a Jellyfin/Emby `ProviderIds` map.
 *
 * Provider keys arrive with varying casing (`Tmdb`, `Imdb`, `Tvdb`); matching is
 * case-insensitive. Unknown providers are ignored; values are stringified. The
 * first value seen for a given source wins.
 */
export function parseProviderIds(providerIds: RawProviderIds | undefined | null): PlexGuids {
	const guids: PlexGuids = {};
	if (!providerIds || typeof providerIds !== 'object') return guids;

	for (const [rawKey, rawValue] of Object.entries(providerIds)) {
		if (rawValue === undefined || rawValue === null || rawValue === '') continue;
		const key = rawKey.toLowerCase();
		const target = (PROVIDER_ID_MAP as Record<string, keyof PlexGuids>)[key];
		if (target && guids[target] === undefined) {
			guids[target] = String(rawValue);
		}
	}
	return guids;
}

/** Parse an ISO-8601 date string, guarding absent/unparseable values to null. */
function parseIsoDate(value: string | null | undefined): Date | null {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Build an absolute, API-key-authenticated URL for an item's Primary (poster)
 * image. Returns null when the item has no Primary image tag.
 */
export function buildEmbyImageUrl(
	baseUrl: string,
	itemId: string,
	imageType: 'Primary' | 'Backdrop',
	tag: string | null | undefined,
	apiKey: string
): string | null {
	if (!tag) return null;
	const base = baseUrl.replace(/\/+$/, '');
	return `${base}/Items/${encodeURIComponent(itemId)}/Images/${imageType}?tag=${encodeURIComponent(
		tag
	)}&api_key=${encodeURIComponent(apiKey)}`;
}

/**
 * Map a Jellyfin/Emby `/Library/MediaFolders` (or `/Items` of folders) response to
 * the app's movie/show libraries, excluding non-media collection types.
 */
export function mapLibraries(response: RawEmbyItemsResponse | undefined | null): ServerLibrary[] {
	const items = response?.Items ?? [];
	const libraries: ServerLibrary[] = [];
	for (const item of items) {
		const type = collectionTypeToLibraryType(item.CollectionType);
		if (type && item.Id) {
			libraries.push({ key: item.Id, title: item.Name ?? item.Id, type });
		}
	}
	return libraries;
}

/**
 * Map a Jellyfin/Emby `/Items` response of Season or Episode children to neutral
 * `ServerChild[]`, keyed by `IndexNumber`. Children without a numeric IndexNumber
 * (or id) are dropped so the caller only matches numbered slots.
 */
export function mapChildren(
	response: RawEmbyItemsResponse | undefined | null,
	baseUrl?: string,
	apiKey?: string
): ServerChild[] {
	const items = response?.Items ?? [];
	const result: ServerChild[] = [];
	for (const item of items) {
		if (item.Id && typeof item.IndexNumber === 'number') {
			const canBuildImages = Boolean(baseUrl && apiKey);
			result.push({
				id: item.Id,
				number: item.IndexNumber,
				currentPosterUrl: canBuildImages
					? buildEmbyImageUrl(baseUrl!, item.Id, 'Primary', item.ImageTags?.Primary, apiKey!)
					: null,
				currentBackgroundUrl: canBuildImages
					? buildEmbyImageUrl(baseUrl!, item.Id, 'Backdrop', item.BackdropImageTags?.[0], apiKey!)
					: null,
				serverUpdatedAt: parseIsoDate(item.DateLastModified)
			});
		}
	}
	return result;
}

/**
 * Map a Jellyfin/Emby `/Items` response to neutral `ServerItem[]`.
 *
 * Items whose `Type` is neither Movie nor Series are dropped (e.g. folders). An
 * item with no tmdb/imdb/tvdb id is still returned with an empty `guids` object
 * so the caller can flag it unresolvable rather than silently dropping it.
 *
 * @param baseUrl Base URL used to build absolute image URLs.
 * @param apiKey API key embedded in the built image URLs.
 */
export function mapItems(
	response: RawEmbyItemsResponse | undefined | null,
	baseUrl: string,
	apiKey: string
): ServerItem[] {
	const items = response?.Items ?? [];
	const result: ServerItem[] = [];
	for (const item of items) {
		const type = itemTypeToMediaType(item.Type);
		if (!type || !item.Id) continue;
		const backdropTag = item.BackdropImageTags?.[0];
		result.push({
			id: item.Id,
			title: item.Name ?? item.Id,
			year: typeof item.ProductionYear === 'number' ? item.ProductionYear : null,
			type,
			guids: parseProviderIds(item.ProviderIds),
			currentPosterUrl: buildEmbyImageUrl(
				baseUrl,
				item.Id,
				'Primary',
				item.ImageTags?.Primary,
				apiKey
			),
			currentBackgroundUrl: buildEmbyImageUrl(baseUrl, item.Id, 'Backdrop', backdropTag, apiKey),
			serverUpdatedAt: parseIsoDate(item.DateLastModified),
			addedAt: parseIsoDate(item.DateCreated),
			watched: item.UserData?.Played === true
		});
	}
	return result;
}

/** One selected library and the exact items returned from its recursive listing. */
export interface EmbyLibraryItemsSnapshot {
	libraryKey: string;
	response: RawEmbyItemsResponse | undefined | null;
}

/** Selected-library membership keyed by the provider's immutable item id. */
export type EmbyLibraryMembershipIndex = ReadonlyMap<string, readonly string[]>;

/**
 * Index the exact selected-library membership reported by Jellyfin/Emby.
 *
 * BoxSets live in a server-wide virtual Collections view and therefore cannot
 * safely inherit the library keys supplied to collection discovery. Matching
 * the BoxSet's immutable member ids against this index proves its actual scope.
 */
export function buildEmbyLibraryMembershipIndex(
	snapshots: readonly EmbyLibraryItemsSnapshot[]
): Map<string, string[]> {
	const membership = new Map<string, string[]>();
	for (const snapshot of snapshots) {
		if (!snapshot.libraryKey) continue;
		for (const item of snapshot.response?.Items ?? []) {
			if (!item.Id) continue;
			const libraryKeys = membership.get(item.Id) ?? [];
			if (!libraryKeys.includes(snapshot.libraryKey)) libraryKeys.push(snapshot.libraryKey);
			membership.set(item.Id, libraryKeys);
		}
	}
	return membership;
}

/**
 * Keep only collection members proven to belong to the selected libraries and
 * derive the collection's library keys from those intersections. Display names
 * are deliberately ignored: native ids are the only grouping identity.
 */
export function scopeEmbyCollectionMembers(
	membersResponse: RawEmbyItemsResponse | undefined | null,
	membership: EmbyLibraryMembershipIndex
): { membersResponse: RawEmbyItemsResponse; libraryKeys: string[] } {
	const members: RawEmbyItem[] = [];
	const libraryKeys: string[] = [];
	const seenMemberIds = new Set<string>();
	const seenLibraryKeys = new Set<string>();

	for (const member of membersResponse?.Items ?? []) {
		if (!member.Id || seenMemberIds.has(member.Id)) continue;
		const matchingLibraryKeys = membership.get(member.Id);
		if (!matchingLibraryKeys?.length) continue;

		seenMemberIds.add(member.Id);
		members.push(member);
		for (const libraryKey of matchingLibraryKeys) {
			if (!libraryKey || seenLibraryKeys.has(libraryKey)) continue;
			seenLibraryKeys.add(libraryKey);
			libraryKeys.push(libraryKey);
		}
	}

	return { membersResponse: { Items: members }, libraryKeys };
}

/** Map one BoxSet plus its exact child ids into the neutral native collection contract. */
export function mapNativeCollection(
	collection: RawEmbyItem,
	membersResponse: RawEmbyItemsResponse | undefined | null,
	baseUrl: string,
	apiKey: string,
	libraryKeys: string[]
): ServerNativeCollection | null {
	if (!collection.Id || collection.Type?.toLowerCase() !== 'boxset') return null;
	const members = (membersResponse?.Items ?? [])
		.filter((member) => Boolean(member.Id))
		.map((member) => ({
			id: member.Id,
			title: member.Name?.trim() || null,
			year: typeof member.ProductionYear === 'number' ? member.ProductionYear : null
		}));
	return {
		id: collection.Id,
		name: collection.Name?.trim() || collection.Id,
		members,
		currentPosterUrl: buildEmbyImageUrl(
			baseUrl,
			collection.Id,
			'Primary',
			collection.ImageTags?.Primary,
			apiKey
		),
		currentBackgroundUrl: buildEmbyImageUrl(
			baseUrl,
			collection.Id,
			'Backdrop',
			collection.BackdropImageTags?.[0],
			apiKey
		),
		libraryKeys: [...new Set(libraryKeys)],
		capabilities: { posterWrite: 'supported', backgroundWrite: 'supported' }
	};
}
