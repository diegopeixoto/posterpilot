/**
 * Pure parsing/URL helpers for the Plex client.
 *
 * These functions deliberately avoid any framework or I/O imports ($env, db,
 * config, http) so they can be unit-tested in isolation without a network or
 * database. Keep all logic that can be exercised by a test in here.
 */

import type { PlexGuids } from '$lib/server/types';

/** Raw `Guid` entry as returned inside a Plex `Metadata` object. */
export interface PlexRawGuid {
	id: string;
}

/** External-id sources Plex exposes via the `Guid[]` array, in our domain order. */
const GUID_SOURCES = ['tmdb', 'imdb', 'tvdb'] as const;
type GuidSource = (typeof GUID_SOURCES)[number];

/**
 * Extract tmdb/imdb/tvdb external ids from a Plex `Guid[]` array.
 *
 * Plex ids look like `tmdb://123`, `imdb://tt0111161`, `tvdb://456`. Unknown
 * sources (e.g. `plex://`, `local://`) are ignored. The first value seen for a
 * given source wins; an empty or malformed array yields an empty object.
 *
 * @param guidArray The `Guid` entries from a Plex `Metadata` object.
 * @returns A `PlexGuids` object containing only the sources that were present.
 */
export function parseGuids(guidArray: PlexRawGuid[] | undefined | null): PlexGuids {
	const guids: PlexGuids = {};
	if (!Array.isArray(guidArray)) return guids;

	for (const entry of guidArray) {
		const id = entry?.id;
		if (typeof id !== 'string') continue;

		const separator = id.indexOf('://');
		if (separator === -1) continue;

		const source = id.slice(0, separator) as GuidSource;
		const value = id.slice(separator + 3);
		if (!value) continue;

		if ((GUID_SOURCES as readonly string[]).includes(source) && guids[source] === undefined) {
			guids[source] = value;
		}
	}

	return guids;
}

/**
 * Convert a Plex `updatedAt` value (epoch seconds) to a `Date`.
 *
 * Plex reports an item's last-modified time as integer seconds since the Unix
 * epoch. Returns null when the field is absent, non-numeric, or zero.
 *
 * @param updatedAt The `updatedAt` value from a Plex `Metadata` object.
 * @returns The corresponding `Date`, or null when no usable timestamp is present.
 */
export function parseUpdatedAt(updatedAt: number | undefined | null): Date | null {
	if (typeof updatedAt !== 'number' || updatedAt <= 0) return null;
	return new Date(updatedAt * 1000);
}

/**
 * Build an absolute, token-authenticated URL for a Plex `thumb` path.
 *
 * Plex returns relative thumb paths (e.g. `/library/metadata/42/thumb/16800`)
 * that must be resolved against the server base URL and carry the access token
 * as a query parameter so the image can be fetched directly.
 *
 * @param baseUrl The Plex server base URL (trailing slash optional).
 * @param thumb The relative thumb path from a `Metadata` object, or null/empty.
 * @param token The `X-Plex-Token` used to authorize the image request.
 * @returns The absolute poster URL, or null when no thumb is available.
 */
export function buildPosterUrl(
	baseUrl: string,
	thumb: string | null | undefined,
	token: string
): string | null {
	if (!thumb) return null;
	const base = baseUrl.replace(/\/+$/, '');
	const path = thumb.startsWith('/') ? thumb : `/${thumb}`;
	const separator = path.includes('?') ? '&' : '?';
	return `${base}${path}${separator}X-Plex-Token=${encodeURIComponent(token)}`;
}
