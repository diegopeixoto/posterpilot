/**
 * How coverage is shown: status to label, icon, and tone; slots to scope names;
 * occurrences to a count.
 *
 * Pure and `$env`-free so the badge, the item-detail breakdown, and their tests all
 * read one mapping. Three rules are load-bearing.
 *
 * Every status carries text. A tone may repeat across two statuses, but the label
 * and the icon never do, so a colour-blind reader gets the same verdict as everyone
 * else — the badge is legible with the stylesheet removed.
 *
 * Nothing here answers "is this item done". There is no function that folds two
 * destinations, or a destination's slots, into one verdict: the moment they collapse
 * the UI starts telling someone their artwork is live when only a YAML entry exists.
 * `coverageBreakdown` therefore returns per-destination reports whose counts are
 * never summed, and each slot keeps the status the reconciler gave it.
 *
 * And the wording is the contract, not decoration. `missing` reads "Not applied by
 * PosterPilot" because a title someone postered by hand in Plex is `missing` here
 * and still has a poster; `externally_changed` is its own state because a user who
 * reads it as "missing" will reapply without ever learning what happened.
 */

import {
	COVERAGE_DESTINATIONS,
	isCovered,
	type CoverageDestination,
	type CoverageStatus
} from '$lib/artwork-coverage';
import { m } from '$lib/paraglide/messages';

/**
 * The artwork slots coverage is tracked for.
 *
 * Mirrors the store's `CoverageSlotKind`, declared here rather than imported so a
 * client bundle never pulls in a `$lib/server` module for a list of three strings.
 */
export const COVERAGE_SLOT_KINDS = ['poster', 'background', 'title_card'] as const;
export type CoverageSlotKind = (typeof COVERAGE_SLOT_KINDS)[number];

/**
 * The visual weights a status can be drawn at.
 *
 * Deliberately fewer names than there are statuses. A tone is a hint, never the
 * signal, and two statuses sharing one is harmless as long as neither tone
 * *contradicts* its label — which is why `exported_to_kometa` has its own quiet tone
 * instead of the green that `applied_on_server` earns.
 */
export const COVERAGE_TONES = [
	'covered',
	'exported',
	'changed',
	'unverified',
	'absent',
	'unknown'
] as const;
export type CoverageTone = (typeof COVERAGE_TONES)[number];

export interface CoverageStatusPresentation {
	status: CoverageStatus;
	/** Localized and always non-empty: the meaning has to survive without colour. */
	label: string;
	/** Decorative glyph, rendered `aria-hidden`. It repeats the label, never replaces it. */
	icon: string;
	tone: CoverageTone;
}

/**
 * The one place a status becomes something a person reads.
 *
 * Typed as a total `Record`, so adding a status to the shared vocabulary is a
 * compile error here rather than a badge that ships with no label.
 */
const STATUS_PRESENTATION: Record<
	CoverageStatus,
	{ icon: string; tone: CoverageTone; label: () => string }
> = {
	applied_on_server: {
		icon: '✓',
		tone: 'covered',
		label: () => m.coverage_status_applied_server()
	},
	// Not the `covered` tone, on purpose. A Kometa export is a line in a metadata file
	// on disk; drawing it the same green as a verified server write would make in
	// colour exactly the claim the wording refuses to make in words.
	exported_to_kometa: {
		icon: '↗',
		tone: 'exported',
		label: () => m.coverage_status_exported_kometa()
	},
	// Its own state, never folded into absence: something replaced our artwork, and a
	// user who reads that as "missing" reapplies without understanding what happened.
	externally_changed: {
		icon: '⚠',
		tone: 'changed',
		label: () => m.coverage_status_externally_changed()
	},
	// We wrote it; we cannot currently prove it. Half-filled rather than a tick.
	recorded_unverified: {
		icon: '◐',
		tone: 'unverified',
		label: () => m.coverage_status_unverified()
	},
	// "Not applied by PosterPilot" — a statement about what we did, never about what
	// the server holds. Saying "no artwork" here would be a lie about hand-set posters.
	missing: { icon: '○', tone: 'absent', label: () => m.coverage_status_missing() },
	// We could not observe reliably. Never conflated with `missing`.
	unknown: { icon: '?', tone: 'unknown', label: () => m.coverage_status_unknown() }
};

export function coverageStatusPresentation(status: CoverageStatus): CoverageStatusPresentation {
	const entry = STATUS_PRESENTATION[status];
	return { status, label: entry.label(), icon: entry.icon, tone: entry.tone };
}

export function coverageStatusLabel(status: CoverageStatus): string {
	return STATUS_PRESENTATION[status].label();
}

export function coverageDestinationLabel(destination: CoverageDestination): string {
	return destination === 'server'
		? m.coverage_destination_server()
		: m.coverage_destination_kometa();
}

/**
 * Slot kind names, reusing the item page's own artwork vocabulary.
 *
 * Keyed loosely so a kind the database grows later still reaches the fallback
 * instead of rendering a raw machine code at a user.
 */
const SLOT_KIND_LABEL: Record<string, () => string> = {
	poster: () => m.item_poster(),
	background: () => m.item_backdrop(),
	title_card: () => m.item_title_card()
};

/** One slot, named the way the artwork history names it: kind first, then scope. */
export function coverageSlotLabel(slot: {
	kind: string;
	season?: number | null;
	episode?: number | null;
}): string {
	const kind = (SLOT_KIND_LABEL[slot.kind] ?? (() => m.jobs_slot_other()))();
	const season = slot.season ?? null;
	const episode = slot.episode ?? null;
	// Season 0 is specials, not "no season", so the null check cannot be falsy.
	if (season === null) return kind;
	if (episode === null) return m.jobs_slot_scope_season({ kind, season });
	return m.jobs_slot_scope_episode({ kind, season, episode });
}

/** A stable `{#each}` key. Slots are unique per destination, kind, season, and episode. */
export function coverageSlotKey(slot: {
	destination: CoverageDestination;
	kind: string;
	season?: number | null;
	episode?: number | null;
}): string {
	return `${slot.destination}:${slot.kind}:${slot.season ?? ''}:${slot.episode ?? ''}`;
}

/** The projection row shape the breakdown needs, narrowed to what the UI reads. */
export interface CoverageSlotEvidence {
	destination: CoverageDestination;
	kind: string;
	season: number | null;
	episode: number | null;
	status: CoverageStatus;
}

export interface CoverageSlotReport {
	key: string;
	label: string;
	status: CoverageStatus;
	presentation: CoverageStatusPresentation;
}

export interface CoverageDestinationReport {
	destination: CoverageDestination;
	label: string;
	/** Slots the shared contract calls covered *here*. Never added to another destination's. */
	covered: number;
	/** Slots with evidence of any kind here. Never the library's slot count. */
	observed: number;
	slots: CoverageSlotReport[];
	/** No evidence at all at this destination. The caller states it, rather than omitting it. */
	empty: boolean;
	/**
	 * The caveat an export has to carry, or null.
	 *
	 * Present exactly when something is exported to Kometa: writing the file proves
	 * nothing about Kometa having run, so the badge's "Exported to Kometa" is
	 * accompanied by the sentence saying we cannot confirm it was applied.
	 */
	note: string | null;
}

const KIND_ORDER = new Map<string, number>(COVERAGE_SLOT_KINDS.map((kind, index) => [kind, index]));

/** Root slots first, then by season and episode, then by the artwork order the page uses. */
function compareSlots(a: CoverageSlotEvidence, b: CoverageSlotEvidence): number {
	const season = (a.season ?? -1) - (b.season ?? -1);
	if (season !== 0) return season;
	const episode = (a.episode ?? -1) - (b.episode ?? -1);
	if (episode !== 0) return episode;
	const kind =
		(KIND_ORDER.get(a.kind) ?? COVERAGE_SLOT_KINDS.length) -
		(KIND_ORDER.get(b.kind) ?? COVERAGE_SLOT_KINDS.length);
	return kind !== 0 ? kind : a.kind.localeCompare(b.kind);
}

/**
 * Group one occurrence's evidence into a report per destination.
 *
 * Every destination is always returned, in a fixed order, even with nothing observed
 * — a destination that disappears when it holds no evidence is a destination the
 * reader never learns to ask about. Counts stay inside their destination and each
 * slot keeps its own status, so a title verified on the server with a Kometa entry
 * for only some of its slots reports exactly that, and never one "completed".
 */
export function coverageBreakdown(
	rows: readonly CoverageSlotEvidence[]
): CoverageDestinationReport[] {
	return COVERAGE_DESTINATIONS.map((destination) => {
		const own = rows.filter((row) => row.destination === destination).sort(compareSlots);
		const slots = own.map((row) => ({
			key: coverageSlotKey(row),
			label: coverageSlotLabel(row),
			status: row.status,
			presentation: coverageStatusPresentation(row.status)
		}));
		return {
			destination,
			label: coverageDestinationLabel(destination),
			covered: own.filter((row) => isCovered(row.status)).length,
			observed: own.length,
			slots,
			empty: own.length === 0,
			note: own.some((row) => row.status === 'exported_to_kometa')
				? m.coverage_kometa_not_applied()
				: null
		};
	});
}

/** One destination's share of the copies, never merged with the other's. */
export interface CoverageOccurrenceDestinationReport {
	destination: CoverageDestination;
	/** Localized destination name, so the count is never a bare number. */
	destinationLabel: string;
	covered: number;
	total: number;
	/** Localized `{covered} of {total} copies covered`. */
	label: string;
}

export interface CoverageOccurrenceReport {
	total: number;
	/** One entry per destination, in the shared destination order. */
	destinations: CoverageOccurrenceDestinationReport[];
	/**
	 * Whether the count says anything the destination breakdown does not.
	 *
	 * A single copy has nothing to report "across servers and libraries", and
	 * "0 of 1 copies covered" beside a slot list that already says so is noise dressed
	 * as information.
	 */
	reportable: boolean;
}

/**
 * How many copies of this title exist, and how many are covered *at each
 * destination*.
 *
 * Reported per destination rather than as one total on purpose. A copy exported
 * to a Kometa file and a copy applied to a media server are not interchangeable,
 * so one of each summed to "2 of 2 copies covered" would claim artwork reached
 * two servers when it reached one — and the slot panels below describe only the
 * copy being viewed, so nothing else on the page would correct it.
 *
 * Counts are clamped: a stale count claiming three covered copies out of two is
 * not a rounding error to render, it is a sentence that cannot be true.
 */
export function coverageOccurrenceReport(counts: {
	occurrences: number;
	coveredOccurrences: Record<CoverageDestination, number>;
}): CoverageOccurrenceReport {
	const total = Math.max(0, Math.trunc(counts.occurrences));
	return {
		total,
		destinations: COVERAGE_DESTINATIONS.map((destination) => {
			const covered = Math.min(
				total,
				Math.max(0, Math.trunc(counts.coveredOccurrences[destination] ?? 0))
			);
			return {
				destination,
				destinationLabel: coverageDestinationLabel(destination),
				covered,
				total,
				label: m.coverage_occurrences({ covered, total })
			};
		}),
		reportable: total > 1
	};
}
