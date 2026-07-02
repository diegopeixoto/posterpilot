/**
 * Library sort options as a pure, $env-free module shared by server code
 * (config, queries, loaders) and client components, so the sort list and
 * natural-direction rule have one source of truth.
 */
export const LIBRARY_SORTS = ['title', 'year', 'rating', 'runtime', 'recent', 'added'] as const;

/** Sort orders offered by the library grid. */
export type LibrarySort = (typeof LIBRARY_SORTS)[number];

export type SortDir = 'asc' | 'desc';

/** The natural default direction for a sort field (title ascends; the rest descend). */
export function defaultSortDir(sort: LibrarySort | undefined): SortDir {
	return sort === 'title' || sort === undefined ? 'asc' : 'desc';
}

/**
 * Parse a library sort name (case/whitespace-insensitive), or undefined for
 * absent/unknown values so callers can distinguish "unset" from an explicit
 * choice and apply their own fallback.
 */
export function parseLibrarySort(value: string | undefined | null): LibrarySort | undefined {
	const v = value?.trim().toLowerCase();
	return (LIBRARY_SORTS as readonly string[]).includes(v ?? '') ? (v as LibrarySort) : undefined;
}
