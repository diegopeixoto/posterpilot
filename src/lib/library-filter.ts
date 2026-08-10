/**
 * Parse library filter/sort/paging from URL search params. Pure and `$env`-free so
 * both the page `load` and the `/api/library` endpoint share one source of truth.
 */
import { parseCoverageFilter, type CoverageFilterValue } from '$lib/coverage-filter';
import { parseLibrarySort, type LibrarySort, type SortDir } from '$lib/library-sort';

export interface LibraryFilterParsed {
	type?: 'movie' | 'show';
	ignored?: 'active' | 'ignored';
	missingPoster?: boolean;
	hasCandidates?: boolean;
	hasMediux?: boolean;
	unchanged?: boolean;
	minRating?: number;
	genre?: string;
	coverage?: CoverageFilterValue;
	sort?: LibrarySort;
	dir?: SortDir;
	q?: string;
}

/** Parse the library filter (filters + sort) from search params. */
export function parseLibraryFilter(params: URLSearchParams): LibraryFilterParsed {
	const type = params.get('type');
	const ignored = params.get('ignored');
	const dir = params.get('dir');
	const minRating = Number(params.get('minRating'));
	return {
		type: type === 'movie' || type === 'show' ? type : undefined,
		ignored: ignored === 'active' || ignored === 'ignored' ? ignored : undefined,
		missingPoster: params.get('missing') === '1',
		hasCandidates: params.get('covers') === '1',
		hasMediux: params.get('mediux') === '1',
		unchanged: params.get('unchanged') === '1',
		// Ignore missing/zero/non-numeric (libsql throws on NaN binds).
		minRating: Number.isFinite(minRating) && minRating > 0 ? minRating : undefined,
		genre: params.get('genre') || undefined,
		// Parsed here rather than at each call site so no consumer can silently
		// drop it. Two already did: infinite scroll appended unfiltered rows past
		// the first page, and "select all matching" materialized the *unfiltered*
		// id set — which a frozen apply plan would then write artwork to, for items
		// the user filtered away and never saw.
		coverage: parseCoverageFilter(params),
		sort: parseLibrarySort(params.get('sort')),
		dir: dir === 'asc' || dir === 'desc' ? dir : undefined,
		q: params.get('q') || undefined
	};
}

/** Parse a non-negative integer offset from a search param, defaulting to 0. */
export function parseOffset(raw: string | null): number {
	const n = Number(raw);
	return Number.isInteger(n) && n > 0 ? n : 0;
}
