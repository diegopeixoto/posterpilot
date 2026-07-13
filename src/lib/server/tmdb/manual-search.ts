import type { TmdbMediaType } from '$lib/server/types';
import { tmdbImageUrl } from './metadata';

export type TmdbManualSearchType = TmdbMediaType | 'both';

export interface TmdbManualCandidate {
	tmdbId: string;
	mediaType: TmdbMediaType;
	title: string;
	originalTitle: string | null;
	year: number | null;
	overview: string | null;
	posterUrl: string | null;
}

interface RawTmdbCandidate {
	id?: number | string;
	title?: string;
	name?: string;
	original_title?: string;
	original_name?: string;
	release_date?: string;
	first_air_date?: string;
	overview?: string;
	poster_path?: string | null;
}

function nonEmpty(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed || null;
}

function releaseYear(value: unknown): number | null {
	const date = nonEmpty(value);
	if (!date || !/^\d{4}(?:-|$)/u.test(date)) return null;
	const year = Number.parseInt(date.slice(0, 4), 10);
	return Number.isInteger(year) && year > 0 ? year : null;
}

function parseCandidate(
	value: unknown,
	mediaType: TmdbMediaType,
	expectedId?: string
): TmdbManualCandidate | null {
	if (typeof value !== 'object' || value === null) return null;
	const raw = value as RawTmdbCandidate;
	if (raw.id === undefined || raw.id === null) return null;
	const tmdbId = String(raw.id);
	if (!/^\d+$/u.test(tmdbId) || tmdbId === '0' || (expectedId && tmdbId !== expectedId)) {
		return null;
	}
	const title = nonEmpty(mediaType === 'movie' ? raw.title : raw.name);
	if (!title) return null;
	const originalTitle = nonEmpty(mediaType === 'movie' ? raw.original_title : raw.original_name);
	return {
		tmdbId,
		mediaType,
		title,
		originalTitle,
		year: releaseYear(mediaType === 'movie' ? raw.release_date : raw.first_air_date),
		overview: nonEmpty(raw.overview),
		posterUrl: tmdbImageUrl(raw.poster_path, 'w342')
	};
}

/** Parse one TMDB search page into safe, disambiguating candidates. */
export function parseTmdbManualSearchResults(
	json: unknown,
	mediaType: TmdbMediaType
): TmdbManualCandidate[] {
	if (typeof json !== 'object' || json === null) return [];
	const results = (json as { results?: unknown }).results;
	if (!Array.isArray(results)) return [];
	return results
		.map((entry) => parseCandidate(entry, mediaType))
		.filter((entry): entry is TmdbManualCandidate => entry !== null);
}

/** Parse and identity-check a concrete movie/TV detail response. */
export function parseVerifiedTmdbCandidate(
	json: unknown,
	mediaType: TmdbMediaType,
	expectedId: string
): TmdbManualCandidate | null {
	return parseCandidate(json, mediaType, expectedId);
}
