/**
 * Pure parsing/mapping helpers for the Jellyfin/Emby provider.
 *
 * Like `plex/parse.ts`, these functions avoid any framework or I/O imports
 * ($env, db, config, http) so they can be unit-tested without a network. All
 * logic that maps Jellyfin/Emby JSON shapes into our neutral domain lives here.
 */

import type { PlexGuids } from '$lib/server/types';
import type { ServerChild, ServerItem, ServerLibrary } from './types';

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
}

/** Shape of the `/Items` (and `/Library/MediaFolders`) response envelope. */
export interface RawEmbyItemsResponse {
	Items?: RawEmbyItem[];
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
export function mapChildren(response: RawEmbyItemsResponse | undefined | null): ServerChild[] {
	const items = response?.Items ?? [];
	const result: ServerChild[] = [];
	for (const item of items) {
		if (item.Id && typeof item.IndexNumber === 'number') {
			result.push({ id: item.Id, number: item.IndexNumber });
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
			currentBackgroundUrl: buildEmbyImageUrl(baseUrl, item.Id, 'Backdrop', backdropTag, apiKey)
		});
	}
	return result;
}
