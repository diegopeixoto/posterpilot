import type { TmdbCastMember, TmdbMediaType, TmdbMetadata } from '$lib/server/types';

/**
 * Pure parsing of TMDB display metadata from the detail (+credits) response and the
 * images response. No network or DB access — these functions are unit-tested in
 * isolation; the network calls live in `client.ts`.
 */

const IMAGE_BASE = 'https://image.tmdb.org/t/p';
const BACKDROP_SIZE = 'w1280';
const LOGO_SIZE = 'w500';
const PROFILE_SIZE = 'w185';
const MAX_CAST = 8;

/** Build an absolute TMDB image URL for a path + size, or null when the path is missing. */
export function tmdbImageUrl(path: string | null | undefined, size: string): string | null {
	if (!path) return null;
	return `${IMAGE_BASE}/${size}${path}`;
}

interface TmdbGenre {
	name?: string;
}
interface TmdbCredit {
	name?: string;
	character?: string;
	profile_path?: string | null;
}
interface TmdbDetail {
	overview?: string;
	tagline?: string;
	genres?: TmdbGenre[];
	runtime?: number;
	episode_run_time?: number[];
	vote_average?: number;
	backdrop_path?: string | null;
	number_of_seasons?: number;
	number_of_episodes?: number;
	credits?: { cast?: TmdbCredit[] };
	belongs_to_collection?: { id?: number | string; name?: string } | null;
}

/** Normalize an empty string to null. */
function nz(s: string | undefined): string | null {
	const t = (s ?? '').trim();
	return t ? t : null;
}

function collectionRef(
	value: TmdbDetail['belongs_to_collection'],
	mediaType: TmdbMediaType
): TmdbMetadata['collection'] {
	if (mediaType !== 'movie' || !value) return null;
	const id = typeof value.id === 'number' || typeof value.id === 'string' ? String(value.id) : '';
	const name = nz(value.name);
	return /^[1-9]\d*$/.test(id) && name ? { id, name } : null;
}

/**
 * Extract display metadata from a TMDB detail response fetched with
 * `append_to_response=credits`. Logo is fetched separately (see `pickLogoUrl`).
 */
export function parseDetailMetadata(
	json: unknown,
	mediaType: TmdbMediaType
): Omit<TmdbMetadata, 'logoUrl'> {
	const d = (json ?? {}) as TmdbDetail;

	const genres = (d.genres ?? []).map((g) => g.name).filter((n): n is string => Boolean(n));

	const runtime = mediaType === 'tv' ? (d.episode_run_time?.[0] ?? null) : (d.runtime ?? null);

	const rating = typeof d.vote_average === 'number' && d.vote_average > 0 ? d.vote_average : null;

	const cast: TmdbCastMember[] = (d.credits?.cast ?? []).slice(0, MAX_CAST).map((c) => ({
		name: c.name ?? '',
		character: nz(c.character),
		profileUrl: tmdbImageUrl(c.profile_path, PROFILE_SIZE)
	}));

	return {
		overview: nz(d.overview),
		tagline: nz(d.tagline),
		genres,
		runtime,
		rating,
		backdropUrl: tmdbImageUrl(d.backdrop_path, BACKDROP_SIZE),
		seasonCount: mediaType === 'tv' ? (d.number_of_seasons ?? null) : null,
		episodeCount: mediaType === 'tv' ? (d.number_of_episodes ?? null) : null,
		cast,
		collection: collectionRef(d.belongs_to_collection, mediaType)
	};
}

interface TmdbImages {
	logos?: Array<{ iso_639_1?: string | null; file_path?: string }>;
}

/** Pick a clearlogo URL from the TMDB images response, preferring an English logo. */
export function pickLogoUrl(json: unknown): string | null {
	const logos = ((json ?? {}) as TmdbImages).logos ?? [];
	if (!logos.length) return null;
	const en = logos.find((l) => l.iso_639_1 === 'en');
	const chosen = en ?? logos[0];
	return tmdbImageUrl(chosen.file_path ?? null, LOGO_SIZE);
}
