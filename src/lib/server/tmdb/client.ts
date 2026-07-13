import { fetchJson } from '$lib/server/http';
import type { PlexGuids, TmdbMediaType, TmdbMetadata, TmdbResolution } from '$lib/server/types';
import { parseFindResult, pickExternalId, tmdbAuth, type TmdbAuth } from './auth';
import {
	parseTmdbManualSearchResults,
	parseVerifiedTmdbCandidate,
	type TmdbManualCandidate,
	type TmdbManualSearchType
} from './manual-search';
import { parseDetailMetadata, pickLogoUrl } from './metadata';

const TMDB_BASE = 'https://api.themoviedb.org/3';
const DEFAULT_CACHE_TTL_DAYS = 30;

/** Append an auth query fragment to a URL that may already carry a query string. */
function withAuthQuery(url: string, query: string): string {
	if (!query) return url;
	return url.includes('?') ? `${url}&${query}` : `${url}?${query}`;
}

/** True only when the JSON payload looks like a successful TMDB entity (has an `id`). */
function isTmdbEntity(json: unknown): boolean {
	return typeof json === 'object' && json !== null && 'id' in (json as Record<string, unknown>);
}

/**
 * Classify a known TMDB id as a movie or TV show by probing the movie endpoint first
 * and falling back to the TV endpoint.
 */
function isTmdbNotFound(error: unknown): boolean {
	const message = error instanceof Error ? error.message : '';
	return /HTTP (?:400|404)\b/u.test(message);
}

async function classifyTmdbIdStrict(
	tmdbId: string,
	auth: TmdbAuth,
	cacheTtlDays: number,
	forceRefresh: boolean
): Promise<TmdbMediaType | null> {
	const probe = async (mediaType: TmdbMediaType): Promise<boolean> => {
		const url = withAuthQuery(`${TMDB_BASE}/${mediaType}/${tmdbId}`, auth.query);
		try {
			const json = await fetchJson<unknown>(url, {
				headers: auth.headers,
				cacheTtlDays,
				forceRefresh
			});
			return isTmdbEntity(json);
		} catch (error) {
			// A 404/400 means only that this id is absent for this media type. Network,
			// auth, and upstream failures must remain distinguishable from no-match.
			if (isTmdbNotFound(error)) return false;
			throw error;
		}
	};

	if (await probe('movie')) return 'movie';
	if (await probe('tv')) return 'tv';
	return null;
}

/**
 * Resolve a Plex/external GUID set to a canonical TMDB id and media type.
 *
 * Precedence is tmdb > imdb > tvdb. A direct TMDB id is classified by probing the
 * movie endpoint then the TV endpoint; an imdb/tvdb id is resolved through the TMDB
 * `find` endpoint. Results are cached via the shared HTTP cache.
 *
 * @param guids The GUIDs carried by a Plex item.
 * @param key The TMDB credential (v3 API key or v4 bearer/JWT).
 * @param opts Optional cache controls.
 * @returns The resolved TMDB id and media type, or null when nothing resolves.
 */
export async function resolveTmdbStrict(
	guids: PlexGuids,
	key: string,
	opts: { forceRefresh?: boolean; cacheTtlDays?: number } = {}
): Promise<TmdbResolution | null> {
	const selected = pickExternalId(guids);
	if (!selected) return null;

	const { forceRefresh = false, cacheTtlDays = DEFAULT_CACHE_TTL_DAYS } = opts;
	const auth = tmdbAuth(key);

	if (selected.source === 'tmdb') {
		const mediaType = await classifyTmdbIdStrict(selected.id, auth, cacheTtlDays, forceRefresh);
		return mediaType ? { tmdbId: selected.id, mediaType } : null;
	}

	const url = withAuthQuery(
		`${TMDB_BASE}/find/${selected.id}?external_source=${selected.source}`,
		auth.query
	);
	try {
		const json = await fetchJson<unknown>(url, {
			headers: auth.headers,
			cacheTtlDays,
			forceRefresh
		});
		return parseFindResult(json);
	} catch (error) {
		if (isTmdbNotFound(error)) return null;
		throw error;
	}
}

/** Compatibility resolver: transient failures degrade to null for legacy callers. */
export async function resolveTmdb(
	guids: PlexGuids,
	key: string,
	opts: { forceRefresh?: boolean; cacheTtlDays?: number } = {}
): Promise<TmdbResolution | null> {
	try {
		return await resolveTmdbStrict(guids, key, opts);
	} catch {
		return null;
	}
}

export interface SearchTmdbInput {
	query: string;
	year?: number;
	mediaType: TmdbManualSearchType;
	language?: string;
}

function manualSearchUrl(input: SearchTmdbInput, mediaType: TmdbMediaType, auth: TmdbAuth): string {
	const params = new URLSearchParams({
		query: input.query,
		include_adult: 'false'
	});
	if (input.language) params.set('language', input.language);
	if (input.year !== undefined) {
		params.set(mediaType === 'movie' ? 'year' : 'first_air_date_year', String(input.year));
	}
	return withAuthQuery(`${TMDB_BASE}/search/${mediaType}?${params.toString()}`, auth.query);
}

/** Search movie, TV, or both TMDB catalogs without mutating local state. */
export async function searchTmdbCandidates(
	input: SearchTmdbInput,
	key: string
): Promise<TmdbManualCandidate[]> {
	const auth = tmdbAuth(key);
	const mediaTypes: TmdbMediaType[] =
		input.mediaType === 'both' ? ['movie', 'tv'] : [input.mediaType];
	const pages = await Promise.all(
		mediaTypes.map(async (mediaType) => {
			const json = await fetchJson<unknown>(manualSearchUrl(input, mediaType, auth), {
				headers: auth.headers,
				cacheTtlDays: 0
			});
			return parseTmdbManualSearchResults(json, mediaType);
		})
	);
	return pages.flat();
}

/**
 * Re-read the exact candidate immediately before pinning it. A true 404/400 means
 * the identity no longer exists; network/upstream failures remain distinguishable.
 */
export async function verifyTmdbCandidate(
	tmdbId: string,
	mediaType: TmdbMediaType,
	key: string,
	language?: string
): Promise<TmdbManualCandidate | null> {
	const auth = tmdbAuth(key);
	const params = new URLSearchParams();
	if (language) params.set('language', language);
	const suffix = params.size > 0 ? `?${params.toString()}` : '';
	const url = withAuthQuery(`${TMDB_BASE}/${mediaType}/${tmdbId}${suffix}`, auth.query);
	try {
		const json = await fetchJson<unknown>(url, {
			headers: auth.headers,
			cacheTtlDays: 0,
			forceRefresh: true
		});
		return parseVerifiedTmdbCandidate(json, mediaType, tmdbId);
	} catch (error) {
		const message = error instanceof Error ? error.message : '';
		if (/HTTP (?:400|404)\b/u.test(message)) return null;
		throw error;
	}
}

/**
 * Fetch display metadata for a resolved TMDB id: the detail document (with credits
 * appended) plus the images endpoint for a clearlogo. Parsing is delegated to the
 * pure helpers in `metadata.ts`. A failure on either request degrades gracefully —
 * the missing fields are simply left empty rather than aborting enrichment.
 *
 * @param tmdbId The resolved TMDB id.
 * @param mediaType The TMDB media type ('movie' or 'tv').
 * @param key The TMDB credential.
 * @param opts Optional cache controls and a flag to skip the (separate) logo call.
 */
export async function fetchMetadata(
	tmdbId: string,
	mediaType: TmdbMediaType,
	key: string,
	opts: { forceRefresh?: boolean; cacheTtlDays?: number; fetchLogo?: boolean } = {}
): Promise<TmdbMetadata> {
	const { forceRefresh = false, cacheTtlDays = DEFAULT_CACHE_TTL_DAYS, fetchLogo = true } = opts;
	const auth = tmdbAuth(key);

	const detailUrl = withAuthQuery(
		`${TMDB_BASE}/${mediaType}/${tmdbId}?append_to_response=credits`,
		auth.query
	);
	const detail = await fetchJson<unknown>(detailUrl, {
		headers: auth.headers,
		cacheTtlDays,
		forceRefresh
	});
	const base = parseDetailMetadata(detail, mediaType);

	let logoUrl: string | null = null;
	if (fetchLogo) {
		const imagesUrl = withAuthQuery(`${TMDB_BASE}/${mediaType}/${tmdbId}/images`, auth.query);
		try {
			const images = await fetchJson<unknown>(imagesUrl, {
				headers: auth.headers,
				cacheTtlDays,
				forceRefresh
			});
			logoUrl = pickLogoUrl(images);
		} catch {
			// No logo is fine — the hero falls back to the title text.
		}
	}

	return { ...base, logoUrl };
}
