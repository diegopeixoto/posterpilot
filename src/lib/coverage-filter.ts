/**
 * The artwork-coverage filter as it travels through a list URL.
 *
 * Pure and `$env`-free so the library page, the review page, and their tests all
 * read one parse without dragging the server-only coverage query layer into the
 * browser bundle.
 *
 * The values are the query layer's own `CoverageSelection` strings verbatim, not
 * a friendlier URL vocabulary translated into them. A route parses one here and
 * hands it straight to `LibraryFilter.coverage` / `ReviewFilter.coverage`, so a
 * divergence is a type error at that call rather than a filter that quietly
 * matches nothing — and the same link means the same thing on either list.
 */

/** The search param both lists share. */
export const COVERAGE_FILTER_PARAM = 'coverage';

/**
 * The coverage questions a user can ask of a list.
 *
 * Not the raw status vocabulary: the first two ask about one destination,
 * `needs_artwork` asks about both at once, and `unknown` asks about the quality
 * of the evidence rather than its verdict. Notably absent is anything that reads
 * as "has no artwork" — a title someone poster-ed by hand in Plex is uncovered
 * *by PosterPilot*, and claiming its artwork is missing would be false.
 */
export const COVERAGE_FILTER_VALUES = [
	'applied_on_this_server',
	'exported_to_kometa',
	'needs_artwork',
	'unknown'
] as const;
export type CoverageFilterValue = (typeof COVERAGE_FILTER_VALUES)[number];

export function isCoverageFilterValue(value: unknown): value is CoverageFilterValue {
	return COVERAGE_FILTER_VALUES.includes(value as CoverageFilterValue);
}

/**
 * Read the coverage filter out of a URL.
 *
 * Anything unrecognized — absent, empty, a stale bookmark, a hand-typed guess,
 * or a raw status name like `missing` that is not one of the questions above —
 * yields `undefined`, which adds no predicate and therefore shows everything.
 * Failing open is the point: the alternative is a URL that silently narrows a
 * library to nothing with no control showing the user what did it.
 */
export function parseCoverageFilter(params: URLSearchParams): CoverageFilterValue | undefined {
	const raw = params.get(COVERAGE_FILTER_PARAM);
	return isCoverageFilterValue(raw) ? raw : undefined;
}

/**
 * Normalize a control's value back into a param value.
 *
 * "Any coverage" is `undefined` rather than an empty string so callers drop the
 * key instead of writing `coverage=`: the unfiltered list keeps exactly one URL,
 * and `parseCoverageFilter` round-trips whatever this returns.
 */
export function serializeCoverageFilter(
	value: string | null | undefined
): CoverageFilterValue | undefined {
	return isCoverageFilterValue(value) ? value : undefined;
}
