/**
 * Filter model for the Fun random picker, plus its URL-param parsing, kept
 * $env/db-free (like `plex/parse.ts`) so it can be unit-tested in isolation.
 */

/** Criteria the random picker selects under. */
export interface PickFilter {
	/** Restrict to one media type; undefined = movies and shows. */
	type?: 'movie' | 'show';
	/** Restrict to items tagged with this genre; undefined = all genres. */
	genre?: string;
	/** Inclusive release-year bounds; undefined = unbounded. */
	yearMin?: number;
	yearMax?: number;
	/** When true, items synced as watched are excluded. */
	excludeWatched: boolean;
}

/** A year is only meaningful as a positive 4-ish digit integer; else unset. */
function parseYear(value: string | null): number | undefined {
	if (!value) return undefined;
	const n = Number.parseInt(value, 10);
	return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Parse the picker's filter from URL search params (`type`, `genre`, `yearMin`,
 * `yearMax`, `excludeWatched`). Unknown or malformed values fall back to the
 * unrestricted default rather than erroring.
 */
export function parsePickFilter(params: URLSearchParams): PickFilter {
	const rawType = params.get('type');
	const genre = params.get('genre');
	return {
		type: rawType === 'movie' || rawType === 'show' ? rawType : undefined,
		genre: genre || undefined,
		yearMin: parseYear(params.get('yearMin')),
		yearMax: parseYear(params.get('yearMax')),
		excludeWatched: params.get('excludeWatched') === '1'
	};
}
