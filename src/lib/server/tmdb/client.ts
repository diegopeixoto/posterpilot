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

function isTmdbNotFound(error: unknown): boolean {
	const message = error instanceof Error ? error.message : '';
	return /HTTP (?:400|404)\b/u.test(message);
}

async function validateTmdbIdStrict(
	tmdbId: string,
	expectedMediaType: TmdbMediaType,
	auth: TmdbAuth,
	cacheTtlDays: number,
	forceRefresh: boolean
): Promise<boolean> {
	const url = withAuthQuery(`${TMDB_BASE}/${expectedMediaType}/${tmdbId}`, auth.query);
	try {
		const json = await fetchJson<unknown>(url, {
			headers: auth.headers,
			cacheTtlDays,
			cacheNamespace: `tmdb-resolution:${expectedMediaType}`,
			forceRefresh
		});
		return isTmdbEntity(json);
	} catch (error) {
		// A 404/400 means only that this id is absent from the authoritative namespace.
		// Network, auth, and upstream failures remain distinguishable from no-match.
		if (isTmdbNotFound(error)) return false;
		throw error;
	}
}

export interface ResolveTmdbOptions {
	/** Namespace derived from the authoritative source item type. */
	expectedMediaType: TmdbMediaType;
	forceRefresh?: boolean;
	cacheTtlDays?: number;
}

/**
 * Resolve a Plex/external GUID set to a canonical TMDB id and media type.
 *
 * Precedence is tmdb > imdb > tvdb. A direct TMDB id is validated only through the
 * expected movie or TV endpoint; an imdb/tvdb id is resolved through the TMDB `find`
 * endpoint and only the expected result bucket is accepted. Results are cached using
 * both the external identifier and expected media namespace.
 *
 * @param guids The GUIDs carried by a Plex item.
 * @param key The TMDB credential (v3 API key or v4 bearer/JWT).
 * @param opts Expected media namespace and optional cache controls.
 * @returns The resolved TMDB id and media type, or null when nothing resolves.
 */
export async function resolveTmdbStrict(
	guids: PlexGuids,
	key: string,
	opts: ResolveTmdbOptions
): Promise<TmdbResolution | null> {
	const selected = pickExternalId(guids);
	if (!selected) return null;

	const { expectedMediaType, forceRefresh = false, cacheTtlDays = DEFAULT_CACHE_TTL_DAYS } = opts;
	const auth = tmdbAuth(key);

	if (selected.source === 'tmdb') {
		const matched = await validateTmdbIdStrict(
			selected.id,
			expectedMediaType,
			auth,
			cacheTtlDays,
			forceRefresh
		);
		if (matched) return { tmdbId: selected.id, mediaType: expectedMediaType };
		// The authoritative namespace wins, but an id absent from it can still be
		// real: a miniseries filed in a movie library carries a TV id. Probing the
		// other namespace stays type-safe — the id is accepted only where TMDB
		// actually has it, and an id present in both namespaces already returned
		// above — while items whose library type disagrees with their TMDB
		// namespace keep resolving instead of becoming permanent no-matches.
		const fallbackMediaType = otherTmdbMediaType(expectedMediaType);
		const crossMatched = await validateTmdbIdStrict(
			selected.id,
			fallbackMediaType,
			auth,
			cacheTtlDays,
			forceRefresh
		);
		return crossMatched ? { tmdbId: selected.id, mediaType: fallbackMediaType } : null;
	}

	const url = withAuthQuery(
		`${TMDB_BASE}/find/${selected.id}?external_source=${selected.source}`,
		auth.query
	);
	try {
		const json = await fetchJson<unknown>(url, {
			headers: auth.headers,
			cacheTtlDays,
			cacheNamespace: `tmdb-resolution:${expectedMediaType}`,
			forceRefresh
		});
		// Same cross-namespace tolerance as the direct-id path: only the other
		// bucket of the same authoritative `find` response, never a guess.
		return (
			parseFindResult(json, expectedMediaType) ??
			parseFindResult(json, otherTmdbMediaType(expectedMediaType))
		);
	} catch (error) {
		if (isTmdbNotFound(error)) return null;
		throw error;
	}
}

function otherTmdbMediaType(mediaType: TmdbMediaType): TmdbMediaType {
	return mediaType === 'movie' ? 'tv' : 'movie';
}

/** Compatibility resolver: transient failures degrade to null for legacy callers. */
export async function resolveTmdb(
	guids: PlexGuids,
	key: string,
	opts: ResolveTmdbOptions
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
