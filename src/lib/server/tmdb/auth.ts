import type { PlexGuids, TmdbMediaType, TmdbResolution } from '$lib/server/types';

/**
 * Pure TMDB helpers: credential parsing, GUID precedence, and `find` parsing.
 *
 * This module intentionally has no runtime dependency on $env, the database, the
 * HTTP layer, or config — only on shared type declarations — so the logic can be
 * unit-tested in isolation.
 */

/** Auth material for a TMDB request: a header map plus an optional query string. */
export interface TmdbAuth {
	headers: Record<string, string>;
	/** Query string fragment (e.g. `api_key=...`), or `''` for header-based auth. */
	query: string;
}

/** Which external GUID was selected and the TMDB `find` source name for it. */
export interface ExternalIdSelection {
	id: string;
	source: 'tmdb' | 'imdb_id' | 'tvdb_id';
}

/** Shape of the relevant fields returned by the TMDB `find` endpoint. */
interface TmdbFindResult {
	movie_results?: Array<{ id: number | string }>;
	tv_results?: Array<{ id: number | string }>;
}

/**
 * Build TMDB authentication material, auto-detecting the credential format.
 *
 * A v4 bearer token / JWT (starts with `eyJ` or is already prefixed with `Bearer `)
 * is sent via the `Authorization` header. Anything else is treated as a v3 API key
 * and returned as an `api_key=...` query fragment.
 *
 * @param key The configured TMDB credential.
 * @returns Headers and query fragment to apply to a request.
 */
export function tmdbAuth(key: string): TmdbAuth {
	const accept = { accept: 'application/json' };
	if (key.startsWith('Bearer ')) {
		return { headers: { Authorization: key, ...accept }, query: '' };
	}
	if (key.startsWith('eyJ')) {
		return { headers: { Authorization: `Bearer ${key}`, ...accept }, query: '' };
	}
	return { headers: { ...accept }, query: `api_key=${key}` };
}

/**
 * Select the external identifier to resolve, applying precedence tmdb > imdb > tvdb.
 *
 * @param guids The GUIDs carried by a Plex item.
 * @returns The chosen id and its TMDB `find` source, or null when no GUID is present.
 */
export function pickExternalId(guids: PlexGuids): ExternalIdSelection | null {
	if (guids.tmdb) return { id: guids.tmdb, source: 'tmdb' };
	if (guids.imdb) return { id: guids.imdb, source: 'imdb_id' };
	if (guids.tvdb) return { id: guids.tvdb, source: 'tvdb_id' };
	return null;
}

/**
 * Interpret a TMDB `find` response within the caller's expected media namespace.
 *
 * @param json The parsed `find` endpoint payload.
 * @param expectedMediaType The only result bucket that may satisfy the lookup.
 * @returns The resolved TMDB id and media type, or null when there are no results.
 */
export function parseFindResult(
	json: unknown,
	expectedMediaType: TmdbMediaType
): TmdbResolution | null {
	const data = (json ?? {}) as TmdbFindResult;
	const result = expectedMediaType === 'movie' ? data.movie_results?.[0] : data.tv_results?.[0];
	return result ? { tmdbId: String(result.id), mediaType: expectedMediaType } : null;
}
