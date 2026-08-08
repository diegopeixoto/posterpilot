/**
 * Kometa coverage, reconciled from the current typed metadata files and from
 * legacy `posterpilot.yml` entries only where their owner is provable.
 *
 * Two rules shape everything here.
 *
 * A Kometa export is a line in a YAML file. It does not prove Kometa ran, that a
 * media server accepted the result, or that the URL still resolves — so the
 * strongest status this module can return is `exported_to_kometa`, and
 * `buildCoverageEvidence` refuses anything stronger.
 *
 * A read or parse failure produces `unknown`, never `missing`. `missing` is a
 * claim about the file's contents; an unreadable file has no contents we know
 * of. Getting that backwards would mark a fully exported library as uncovered
 * and invite the user to re-export everything.
 *
 * The legacy file adds a third: a bare numeric key in a mixed-kind file cannot
 * say whether it belongs to movie 105 or show 105. It contributes coverage only
 * when a retained destination or revision provenance ties it to exactly one
 * item, and otherwise leaves that item `unknown` rather than guessing.
 */

import type { ApplySlot } from '$lib/server/plans/apply-plan';
import { applySlotKey } from '$lib/server/plans/apply-plan';
import {
	isCanonicalKometaImdbId,
	isCanonicalKometaNumericId,
	isKometaDestinationV2,
	isKometaLegacyDestinationV1,
	LEGACY_FILENAME,
	type KometaDestinationV2,
	type KometaLegacyDestinationV1,
	type KometaMetadataFilename
} from '$lib/server/kometa/destination';
import { kometaSlotFingerprint } from '$lib/server/revisions/kometa-state';
import {
	buildCoverageEvidence,
	dedupeSlots,
	type CoverageEvidence,
	type CoverageEvidenceSource,
	type CoverageMetadataFilename,
	type CoverageOccurrenceRef
} from './reconcile-types';

/** One slot's exported URL, as parsed out of a metadata entry. */
export interface KometaSlotEvidence {
	slot: ApplySlot;
	/** The exported URL. Null or empty is an absent slot, never an export. */
	url: string | null;
}

/** One `metadata:` entry, keyed as it literally appears in the file. */
export interface KometaEntryEvidence {
	/** The YAML mapping key exactly as parsed: `105`, `'105'`, or `tt0111161`. */
	mappingKey: string | number;
	/** Slots present in the entry. Absent slots may be omitted or carry a null url. */
	slots: KometaSlotEvidence[];
}

/**
 * The state of one typed metadata file.
 *
 * `absent` means the file does not exist, which is a reliable observation that
 * nothing is exported there. `unreadable` means we tried and could not tell.
 */
export type KometaFileEvidence =
	| { filename: KometaMetadataFilename; state: 'parsed'; entries: KometaEntryEvidence[] }
	| { filename: KometaMetadataFilename; state: 'absent' }
	| { filename: KometaMetadataFilename; state: 'unreadable' };

/** The state of the pre-split shared file, if the installation still has one. */
export type KometaLegacyFileEvidence =
	| { state: 'parsed'; entries: KometaEntryEvidence[] }
	| { state: 'absent' }
	| { state: 'unreadable' };

/** How an occurrence maps onto a typed metadata file. */
export type KometaDestinationResolution =
	/** `resolveKometaDestination` returned a destination. */
	| { state: 'resolved'; destination: KometaDestinationV2 }
	/** `missing_kometa_identifier`: nothing addressable, so nothing can have been exported. */
	| { state: 'unidentified' }
	/** The destination could not be determined at all; coverage stays unknown. */
	| { state: 'unknown' };

export interface KometaCoverageRequest extends CoverageOccurrenceRef {
	destination: KometaDestinationResolution;
	/**
	 * A legacy destination recovered from this occurrence's own revision
	 * provenance (see `recordedKometaDestination`). It is the only thing that can
	 * tie an untyped numeric key to this item.
	 */
	legacyDestination?: KometaLegacyDestinationV1 | null;
	/**
	 * `media_items.tmdb_id`. Used only to notice that a legacy key *could* be this
	 * item's, which is what makes an untied entry `unknown` rather than `missing`.
	 */
	tmdbId?: string | null;
	slots: ApplySlot[];
}

export interface KometaCoverageInput {
	requests: readonly KometaCoverageRequest[];
	/**
	 * Every typed file the requests address. A file the caller does not mention is
	 * treated as `unknown`: silence is not evidence of absence.
	 */
	files: readonly KometaFileEvidence[];
	/**
	 * The shared pre-split file. Omit it when the installation has none — that is
	 * the normal post-migration state. A caller that could not inspect it must say
	 * so with `{ state: 'unreadable' }` rather than omitting it.
	 */
	legacyFile?: KometaLegacyFileEvidence;
	/** When the files were read. Stamped onto every row this call produces. */
	observedAt?: Date | null;
}

/** Why a legacy entry could not be attributed to exactly one movie or show. */
export type UnassignedLegacyReason =
	/** More than one occurrence retained the same legacy key. */
	| 'multiple_claimants'
	/** No occurrence retained it, but the key matches an item's TMDB id. */
	| 'ambiguous_identity'
	/** The same logical key appears more than once in the file. */
	| 'duplicate_key'
	/** The key is not a canonical numeric id, so no legacy destination can address it. */
	| 'unsupported_key';

export interface UnassignedLegacyEntry {
	/** The key as it appeared, normalized when that was possible. */
	mappingKey: string;
	reason: UnassignedLegacyReason;
}

export interface KometaCoverageReconciliation {
	coverage: CoverageEvidence[];
	/**
	 * Legacy entries that could be ours but cannot be proven to be. Reported so
	 * the migration UI can name them; never folded into a title's coverage.
	 */
	unassignedLegacyEntries: UnassignedLegacyEntry[];
}

/** What one source of evidence says about one slot, and why. */
type SlotOutcome =
	| {
			state: 'exported';
			filename: CoverageMetadataFilename;
			url: string;
			source: CoverageEvidenceSource;
	  }
	| { state: 'absent'; source: CoverageEvidenceSource }
	| { state: 'unknown'; source: CoverageEvidenceSource };

function absent(source: CoverageEvidenceSource): SlotOutcome {
	return { state: 'absent', source };
}

function unknown(source: CoverageEvidenceSource): SlotOutcome {
	return { state: 'unknown', source };
}

/**
 * Reduce a YAML mapping key to the identifier it denotes, or null when it
 * denotes none. `105` and `'105'` are the same entry to Kometa and must be to us.
 */
function normalizeTypedMappingKey(value: string | number): string | null {
	if (typeof value === 'number') {
		return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
	}
	const trimmed = value.trim();
	if (isCanonicalKometaNumericId(trimmed) || isCanonicalKometaImdbId(trimmed)) return trimmed;
	return null;
}

/**
 * The same reduction for the shared file, minus IMDb.
 *
 * A `KometaLegacyDestinationV1` is TMDb-numeric by construction, so no retained
 * provenance can ever name a `tt...` key. Such an entry is real, but nothing we
 * hold can claim it.
 */
function normalizeLegacyMappingKey(value: string | number): string | null {
	const normalized = normalizeTypedMappingKey(value);
	return normalized !== null && isCanonicalKometaNumericId(normalized) ? normalized : null;
}

/** Index an entry's slots, keeping only URLs that actually export something. */
function exportedSlotUrls(entry: KometaEntryEvidence): Map<string, string> {
	const urls = new Map<string, string>();
	for (const evidence of entry.slots) {
		const url = evidence.url?.trim();
		if (!url) continue;
		urls.set(applySlotKey(evidence.slot), url);
	}
	return urls;
}

/**
 * Group a file's entries by the identifier they denote.
 *
 * Entries are kept as arrays, not overwritten: two entries under one logical key
 * are contradictory, and picking one would invent an answer the file does not
 * contain.
 */
function indexEntries(
	entries: readonly KometaEntryEvidence[],
	normalize: (value: string | number) => string | null
): Map<string, Map<string, string>[]> {
	const index = new Map<string, Map<string, string>[]>();
	for (const entry of entries) {
		const key = normalize(entry.mappingKey);
		if (key === null) continue;
		const bucket = index.get(key);
		if (bucket) bucket.push(exportedSlotUrls(entry));
		else index.set(key, [exportedSlotUrls(entry)]);
	}
	return index;
}

function lookupSlot(
	buckets: Map<string, string>[] | undefined,
	slotKey: string,
	filename: CoverageMetadataFilename
): SlotOutcome {
	if (!buckets) return absent('kometa_no_entry');
	if (buckets.length > 1) return unknown('kometa_duplicate_key');
	const url = buckets[0].get(slotKey);
	return url === undefined
		? absent('kometa_no_entry')
		: {
				state: 'exported',
				filename,
				url,
				source: filename === LEGACY_FILENAME ? 'kometa_legacy_export' : 'kometa_typed_export'
			};
}

/** What the current typed file says about this occurrence's slot. */
function typedOutcome(
	request: KometaCoverageRequest,
	slotKey: string,
	typedIndexes: Map<
		KometaMetadataFilename,
		Map<string, Map<string, string>[]> | 'unknown' | 'absent'
	>
): SlotOutcome {
	if (request.destination.state === 'unknown') return unknown('kometa_destination_unknown');
	if (request.destination.state === 'unidentified') {
		// The item carries no identifier Kometa can match on, so no typed writer
		// could ever have addressed it. Nothing is there, and we know why.
		return absent('kometa_unidentified');
	}
	const destination = request.destination.destination;
	// A destination that does not validate cannot be trusted to name a file.
	if (!isKometaDestinationV2(destination)) return unknown('kometa_destination_unknown');

	const index = typedIndexes.get(destination.filename);
	if (index === undefined) return unknown('kometa_file_not_inspected');
	if (index === 'unknown') return unknown('kometa_file_unreadable');
	if (index === 'absent') return absent('kometa_no_entry');
	return lookupSlot(index.get(destination.mappingId), slotKey, destination.filename);
}

/** The legacy key this occurrence can prove is its own, if any. */
function retainedLegacyMappingId(request: KometaCoverageRequest): string | null {
	const retained = request.legacyDestination;
	return retained && isKometaLegacyDestinationV1(retained) ? retained.mappingId : null;
}

export function reconcileKometaCoverage(input: KometaCoverageInput): KometaCoverageReconciliation {
	const observedAt = input.observedAt ?? null;

	const typedIndexes = new Map<
		KometaMetadataFilename,
		Map<string, Map<string, string>[]> | 'unknown' | 'absent'
	>();
	for (const file of input.files) {
		typedIndexes.set(
			file.filename,
			file.state === 'parsed'
				? indexEntries(file.entries, normalizeTypedMappingKey)
				: file.state === 'absent'
					? 'absent'
					: 'unknown'
		);
	}

	const legacyFile = input.legacyFile ?? { state: 'absent' as const };
	const legacyIndex =
		legacyFile.state === 'parsed'
			? indexEntries(legacyFile.entries, normalizeLegacyMappingKey)
			: null;

	// Which occurrences claim which legacy key. Two claimants on one key means the
	// pre-split file lost the distinction between them, and neither may have it.
	const legacyClaimants = new Map<string, number>();
	for (const request of input.requests) {
		const mappingId = retainedLegacyMappingId(request);
		if (mappingId === null) continue;
		legacyClaimants.set(mappingId, (legacyClaimants.get(mappingId) ?? 0) + 1);
	}
	const requestTmdbIds = new Set(
		input.requests
			.map((request) => request.tmdbId)
			.filter((tmdbId): tmdbId is string => isCanonicalKometaNumericId(tmdbId))
	);

	const legacyOutcome = (request: KometaCoverageRequest, slotKey: string): SlotOutcome => {
		if (legacyFile.state === 'absent') return absent('kometa_no_entry');
		if (legacyFile.state === 'unreadable' || legacyIndex === null) {
			return unknown('kometa_file_unreadable');
		}

		const mappingId = retainedLegacyMappingId(request);
		if (mappingId === null) {
			// No provenance ties any legacy entry to this item. If the file holds an
			// entry under this item's TMDB number, that entry might be this movie's or
			// the show that shares the number — unprovable either way, so this item's
			// legacy coverage is unknown rather than absent.
			const possible =
				isCanonicalKometaNumericId(request.tmdbId) && legacyIndex.has(request.tmdbId);
			return possible ? unknown('kometa_legacy_ambiguous') : absent('kometa_no_entry');
		}
		if ((legacyClaimants.get(mappingId) ?? 0) > 1) return unknown('kometa_legacy_ambiguous');
		return lookupSlot(legacyIndex.get(mappingId), slotKey, LEGACY_FILENAME);
	};

	const coverage: CoverageEvidence[] = [];
	for (const request of input.requests) {
		for (const slot of dedupeSlots(request.slots)) {
			const slotKey = applySlotKey(slot);
			const typed = typedOutcome(request, slotKey, typedIndexes);
			// A proven export is proof regardless of the typed file, so the legacy
			// layer is consulted whenever the typed one did not already prove it.
			const legacy =
				typed.state === 'exported' ? absent('kometa_no_entry') : legacyOutcome(request, slotKey);
			const exported =
				typed.state === 'exported' ? typed : legacy.state === 'exported' ? legacy : null;

			if (exported) {
				coverage.push(
					buildCoverageEvidence(request, 'kometa', slot, 'exported_to_kometa', exported.source, {
						metadataFilename: exported.filename,
						fingerprint: kometaSlotFingerprint({ state: 'present', url: exported.url }),
						observedAt
					})
				);
				continue;
			}
			// Whichever source could not answer explains the row; the typed file is the
			// primary one, so it names the reason whenever it is the one in doubt.
			const doubt = typed.state === 'unknown' ? typed : legacy.state === 'unknown' ? legacy : null;
			coverage.push(
				buildCoverageEvidence(
					request,
					'kometa',
					slot,
					doubt ? 'unknown' : 'missing',
					doubt ? doubt.source : typed.source,
					{ observedAt }
				)
			);
		}
	}

	return {
		coverage,
		unassignedLegacyEntries: unassignedLegacy(legacyFile, legacyClaimants, requestTmdbIds)
	};
}

/**
 * Legacy entries we could not attribute to exactly one title.
 *
 * Only entries that could plausibly be ours are reported. An entry for an item
 * that is not in this batch is somebody else's row in a shared file, not an
 * ambiguity, and listing it would bury the collisions that matter.
 */
function unassignedLegacy(
	legacyFile: KometaLegacyFileEvidence,
	claimants: Map<string, number>,
	requestTmdbIds: Set<string>
): UnassignedLegacyEntry[] {
	if (legacyFile.state !== 'parsed') return [];

	const counts = new Map<string, number>();
	for (const entry of legacyFile.entries) {
		const key = normalizeLegacyMappingKey(entry.mappingKey);
		if (key === null) continue;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}

	const reported = new Set<string>();
	const out: UnassignedLegacyEntry[] = [];
	for (const entry of legacyFile.entries) {
		const key = normalizeLegacyMappingKey(entry.mappingKey);
		if (key === null) {
			out.push({ mappingKey: String(entry.mappingKey), reason: 'unsupported_key' });
			continue;
		}
		if (reported.has(key)) continue;
		const claimCount = claimants.get(key) ?? 0;
		const reason: UnassignedLegacyReason | null =
			(counts.get(key) ?? 0) > 1
				? 'duplicate_key'
				: claimCount > 1
					? 'multiple_claimants'
					: claimCount === 0 && requestTmdbIds.has(key)
						? 'ambiguous_identity'
						: null;
		if (reason === null) continue;
		reported.add(key);
		out.push({ mappingKey: key, reason });
	}
	return out;
}
