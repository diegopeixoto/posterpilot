/**
 * Reading the coverage projection from the library and review queries.
 *
 * Three rules shape everything below.
 *
 * Status lists are never written by hand. They come from `coveredStatusesFor`
 * and `statusesFor`, which derive them from `isCovered` and
 * `isStatusValidForDestination` — so a SQL filter cannot drift from the shared
 * definition, and adding a status to the vocabulary cannot leave a stale
 * hand-copied list silently excluding it.
 *
 * Absence is an anti-join, never a row. Only observed slots get rows, so "needs
 * artwork" has to be `not exists (... covered ...)` rather than a lookup for a
 * `missing` status: an item nobody has ever applied artwork to has no coverage
 * rows at all, and a filter that required one would hide exactly the items the
 * filter exists to find.
 *
 * Nothing here writes. Coverage and `reviewedAt` are independent by design —
 * workflow completion is the user's statement about their queue, destination
 * evidence is ours about the world — so reading one must never touch the other.
 */

import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type * as schema from '$lib/server/db/schema';
import { artworkCoverage, mediaItems } from '$lib/server/db/schema';
import {
	COVERAGE_DESTINATIONS,
	isIndeterminate,
	type CoverageDestination,
	type CoverageStatus
} from '$lib/artwork-coverage';
import { coveredStatusesFor, statusesFor } from './store';

/**
 * The coverage states a user can filter a list by.
 *
 * Deliberately not the raw status vocabulary: the first two are questions about
 * one destination, `needs_artwork` is a question about both at once, and
 * `unknown` is a question about the quality of the evidence rather than its
 * verdict.
 */
export const COVERAGE_SELECTIONS = [
	'applied_on_this_server',
	'exported_to_kometa',
	'needs_artwork',
	'unknown'
] as const;
export type CoverageSelection = (typeof COVERAGE_SELECTIONS)[number];

export function isCoverageSelection(value: unknown): value is CoverageSelection {
	return COVERAGE_SELECTIONS.includes(value as CoverageSelection);
}

/**
 * Statuses that mean "we could not tell" at a destination.
 *
 * Derived by filtering the destination's own vocabulary through
 * `isIndeterminate`, so a future indeterminate status — or `recorded_unverified`
 * becoming valid somewhere new — needs no edit here.
 */
function indeterminateStatusesFor(destination: CoverageDestination): CoverageStatus[] {
	return statusesFor(destination).filter(isIndeterminate);
}

/** Bind each status as its own parameter; a joined literal list would not be one. */
function statusList(statuses: readonly CoverageStatus[]): SQL {
	return sql`(${sql.join(
		statuses.map((status) => sql`${status}`),
		sql`, `
	)})`;
}

/**
 * A correlated existence test against one occurrence's coverage.
 *
 * Correlated on `media_items` rather than joined so a filter can never multiply
 * an item's row by its slot count — an item with a poster and a background at
 * one destination is one library entry, not two.
 */
function coverageExists(condition: SQL): SQL {
	return sql`exists (
		select 1 from ${artworkCoverage} covered
		where covered.media_item_id = ${mediaItems.id}
			and covered.server_instance_id = ${mediaItems.serverInstanceId}
			and (${condition})
	)`;
}

function coveredAtCondition(destination: CoverageDestination): SQL {
	return sql`covered.destination = ${destination} and covered.status in ${statusList(
		coveredStatusesFor(destination)
	)}`;
}

/** Covered at one destination: at least one slot the shared contract calls covered. */
function coveredAt(destination: CoverageDestination): SQL {
	return coverageExists(coveredAtCondition(destination));
}

/**
 * Build the WHERE fragment for one coverage selection.
 *
 * The caller supplies its own `media_items` scope; this only adds the coverage
 * predicate, correlated on the item the surrounding query already filters.
 */
export function coverageSelectionCondition(selection: CoverageSelection): SQL {
	switch (selection) {
		case 'applied_on_this_server':
			return coveredAt('server');
		case 'exported_to_kometa':
			return coveredAt('kometa');
		case 'needs_artwork':
			// Covered at neither destination. A negated existence test rather than a
			// status lookup, so an item with no coverage rows at all — never applied,
			// never exported — matches, which an equality test never could.
			return and(
				...COVERAGE_DESTINATIONS.map((destination) => sql`not ${coveredAt(destination)}`)
			)!;
		case 'unknown':
			return coverageExists(
				sql.join(
					COVERAGE_DESTINATIONS.map(
						(destination) =>
							sql`(covered.destination = ${destination} and covered.status in ${statusList(
								indeterminateStatusesFor(destination)
							)})`
					),
					sql` or `
				)
			);
	}
}

/** Per-destination rollup for one occurrence, as the grid and detail pane render it. */
export interface CoverageDestinationSummary {
	destination: CoverageDestination;
	/** Zero-filled from `statusesFor`, so an absent status is a zero, not a gap. */
	byStatus: Record<string, number>;
	/** Slots the shared contract calls covered at this destination. */
	covered: number;
	/** Slots with evidence of any kind. Never the library's slot count. */
	observed: number;
}

export interface ItemCoverageSummary {
	mediaItemId: number;
	server: CoverageDestinationSummary;
	kometa: CoverageDestinationSummary;
}

function emptySummary(destination: CoverageDestination): CoverageDestinationSummary {
	return {
		destination,
		byStatus: Object.fromEntries(statusesFor(destination).map((status) => [status, 0])),
		covered: 0,
		observed: 0
	};
}

function emptyItemSummary(mediaItemId: number): ItemCoverageSummary {
	return { mediaItemId, server: emptySummary('server'), kometa: emptySummary('kometa') };
}

type CoverageQueryDatabase = Pick<LibSQLDatabase<typeof schema>, 'select'>;

/**
 * Per-destination, per-status slot counts for a bounded page of occurrences.
 *
 * One grouped query for the whole page rather than one per row, served end to
 * end by `artwork_coverage_item_idx`. Items with no evidence come back as
 * zero-filled summaries rather than missing keys, because the caller must not
 * have to tell "no rows" apart from "no such item".
 */
export async function loadItemCoverageSummaries(
	database: CoverageQueryDatabase,
	serverInstanceId: string,
	mediaItemIds: readonly number[]
): Promise<Map<number, ItemCoverageSummary>> {
	const summaries = new Map<number, ItemCoverageSummary>(
		mediaItemIds.map((mediaItemId) => [mediaItemId, emptyItemSummary(mediaItemId)])
	);
	if (mediaItemIds.length === 0) return summaries;

	const rows = await database
		.select({
			mediaItemId: artworkCoverage.mediaItemId,
			destination: artworkCoverage.destination,
			status: artworkCoverage.status,
			count: sql<number>`count(*)`
		})
		.from(artworkCoverage)
		.where(
			and(
				eq(artworkCoverage.serverInstanceId, serverInstanceId),
				inArray(artworkCoverage.mediaItemId, [...mediaItemIds])
			)
		)
		.groupBy(artworkCoverage.mediaItemId, artworkCoverage.destination, artworkCoverage.status);

	const covered = new Map<CoverageDestination, Set<string>>(
		COVERAGE_DESTINATIONS.map((destination) => [
			destination,
			new Set<string>(coveredStatusesFor(destination))
		])
	);
	for (const row of rows) {
		const summary = summaries.get(row.mediaItemId);
		if (!summary) continue;
		const destination = summary[row.destination];
		const count = Number(row.count);
		destination.byStatus[row.status] = count;
		destination.observed += count;
		if (covered.get(row.destination)?.has(row.status)) destination.covered += count;
	}
	return summaries;
}

/**
 * How many copies of a title exist, and how many of them are covered.
 *
 * `occurrences` counts active `media_items` rows sharing a canonical identity —
 * the same film on two servers, or twice on one server because it sits in both
 * `Movies` and `Movies 4K`. An unresolved item is its own group of one: it
 * carries no evidence that it is any particular title, and joining it to another
 * by name or year is exactly the guess the canonical key exists to prevent.
 */
export interface CoverageOccurrenceCounts {
	/** `movie:105`, `tv:105`, or null for an unresolved copy that stands alone. */
	canonicalKey: string | null;
	occurrences: number;
	servers: number;
	libraries: number;
	/**
	 * Occurrences with at least one covered slot, **per destination**.
	 *
	 * Never summed into one number: a copy exported to a Kometa file and a copy
	 * applied to a media server are not interchangeable, and "2 of 2 covered"
	 * built from one of each would claim artwork reached two servers when it
	 * reached one.
	 */
	coveredOccurrences: Record<CoverageDestination, number>;
}

/** Zero per destination, so an absent destination reads as zero rather than as a gap. */
function emptyCoveredCounts(): Record<CoverageDestination, number> {
	return Object.fromEntries(COVERAGE_DESTINATIONS.map((destination) => [destination, 0])) as Record<
		CoverageDestination,
		number
	>;
}

/** SQL twin of `canonicalIdentityKey`. Only rows already matched by a validated key are read. */
const canonicalKeyExpression = sql<string>`${mediaItems.mediaType} || ':' || trim(${mediaItems.tmdbId})`;

/**
 * Occurrence counts for a bounded page of items.
 *
 * Resolved items are counted across every server and library, not just the one
 * being browsed: "this title is also in your 4K library, and it is covered
 * there" is the question the count exists to answer. Coverage stays per
 * occurrence — a poster applied on one server proves nothing about the copy on
 * the other — so `coveredOccurrences` counts copies, never slots.
 */
export async function loadCoverageOccurrenceCounts(
	database: CoverageQueryDatabase,
	items: readonly { mediaItemId: number; canonicalKey: string | null }[]
): Promise<Map<number, CoverageOccurrenceCounts>> {
	const counts = new Map<number, CoverageOccurrenceCounts>(
		items.map((item) => [
			item.mediaItemId,
			{
				canonicalKey: item.canonicalKey,
				// An unresolved copy is a group of one, and it is uncovered until its own
				// evidence says otherwise. The grouped query below overwrites both for
				// every resolved identity it finds.
				occurrences: 1,
				servers: 1,
				libraries: 1,
				coveredOccurrences: emptyCoveredCounts()
			}
		])
	);
	const wanted = [
		...new Set(items.map((item) => item.canonicalKey).filter((key): key is string => key !== null))
	];
	if (wanted.length === 0) return counts;

	/** Covered at one named destination — deliberately not "covered anywhere". */
	const coveredAt = (destination: CoverageDestination) => sql`exists (
		select 1 from ${artworkCoverage} covered
		where covered.media_item_id = ${mediaItems.id}
			and covered.server_instance_id = ${mediaItems.serverInstanceId}
			and (${coveredAtCondition(destination)})
	)`;
	const rows = await database
		.select({
			canonicalKey: canonicalKeyExpression,
			occurrences: sql<number>`count(*)`,
			servers: sql<number>`count(distinct ${mediaItems.serverInstanceId})`,
			libraries: sql<number>`count(distinct ${mediaItems.serverInstanceId} || ':' || ${mediaItems.sectionKey})`,
			coveredOnServer: sql<number>`sum(case when ${coveredAt('server')} then 1 else 0 end)`,
			coveredInKometa: sql<number>`sum(case when ${coveredAt('kometa')} then 1 else 0 end)`
		})
		.from(mediaItems)
		.where(
			and(
				// A copy that left its library is not somewhere the title can be covered.
				isNull(mediaItems.sourceRemovedAt),
				inArray(canonicalKeyExpression, wanted)
			)
		)
		.groupBy(canonicalKeyExpression);

	const byIdentity = new Map(rows.map((row) => [row.canonicalKey, row]));
	for (const item of items) {
		if (item.canonicalKey === null) continue;
		const group = byIdentity.get(item.canonicalKey);
		const entry = counts.get(item.mediaItemId);
		if (!group || !entry) continue;
		entry.occurrences = Number(group.occurrences);
		entry.servers = Number(group.servers);
		entry.libraries = Number(group.libraries);
		entry.coveredOccurrences = {
			server: Number(group.coveredOnServer ?? 0),
			kometa: Number(group.coveredInKometa ?? 0)
		};
	}
	return counts;
}
