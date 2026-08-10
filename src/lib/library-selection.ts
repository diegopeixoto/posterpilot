import { hashCanonicalJson } from '$lib/server/plans/canonical-json';
import type { LibraryFilterParsed } from '$lib/library-filter';
import type { LibrarySort } from '$lib/library-sort';

export interface LibrarySelectionFingerprintInput {
	serverInstanceId: string;
	filter: LibraryFilterParsed;
	effectiveSort: LibrarySort;
	orderedItemIds: number[];
}

/** Bind an all-results selection to its server, normalized query, order, and exact ids. */
export function fingerprintLibrarySelection(input: LibrarySelectionFingerprintInput): string {
	return hashCanonicalJson({
		version: 1,
		serverInstanceId: input.serverInstanceId,
		filter: {
			type: input.filter.type ?? null,
			ignored: input.filter.ignored ?? null,
			missingPoster: Boolean(input.filter.missingPoster),
			hasCandidates: Boolean(input.filter.hasCandidates),
			hasMediux: Boolean(input.filter.hasMediux),
			unchanged: Boolean(input.filter.unchanged),
			minRating: input.filter.minRating ?? null,
			genre: input.filter.genre ?? null,
			sort: input.effectiveSort,
			dir: input.filter.dir ?? null,
			q: input.filter.q ?? null,
			// Every dimension of the parsed filter must be bound, or a drifted or
			// replayed query could swap the one unbound filter without tripping the
			// result_set_changed guard — two "select all matching" selections that
			// differ only in coverage would otherwise hash identically.
			coverage: input.filter.coverage ?? null
		},
		orderedItemIds: input.orderedItemIds
	});
}
