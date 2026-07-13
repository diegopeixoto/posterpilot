/**
 * Build a grid-sized poster URL for the thumbnail proxy. Pure and `$env`-free.
 *
 * The media server resizes for us where it can, so no image-processing dependency
 * is needed: Emby/Jellyfin honor a `fillWidth` query param on their image URLs.
 * Plex needs its `/photo/:/transcode` endpoint, which is fragile to construct from a
 * stored URL, so Plex (and any unknown backend) falls back to the full-size image —
 * still a large win, since the proxy caches it on disk and keeps the token
 * server-side. The `serverType` comes from config (type-only import, erased at runtime).
 */
import type { ServerType } from '$lib/server/config';

/** Target width (px) for a grid poster thumbnail. */
export const GRID_THUMB_WIDTH = 360;

/** Add a scoped cache version without dropping existing server auth/query fields. */
export function versionedArtworkUrl(originalUrl: string, artworkVersion: number): string {
	if (!originalUrl) return originalUrl;
	const safeVersion = Number.isInteger(artworkVersion) && artworkVersion >= 0 ? artworkVersion : 0;
	const url = new URL(originalUrl);
	url.searchParams.set('posterpilot_v', String(safeVersion));
	return url.toString();
}

/**
 * Given an item's stored (token-bearing) poster URL, return the URL to fetch for a
 * grid-sized thumbnail. Returns the input unchanged when it can't safely resize.
 */
export function resizedPosterUrl(
	serverType: ServerType,
	originalUrl: string,
	width: number = GRID_THUMB_WIDTH
): string {
	if (!originalUrl) return originalUrl;
	if (serverType === 'jellyfin' || serverType === 'emby') {
		const sep = originalUrl.includes('?') ? '&' : '?';
		return `${originalUrl}${sep}fillWidth=${width}&quality=90`;
	}
	// Plex / unknown: serve and cache the full-size image (no reliable in-URL resize).
	return originalUrl;
}
