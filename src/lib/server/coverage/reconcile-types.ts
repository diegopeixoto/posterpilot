/**
 * The row shape both reconcilers produce, and the guards that keep them honest.
 *
 * Reconcilers are pure functions over evidence the caller supplies. They read no
 * database and touch no filesystem, so every branch below — including the ones
 * that only fire on an unreadable file or a contested legacy key — is reachable
 * from a single function call in a test.
 */

import { applySlotKey, type ApplySlot } from '$lib/server/plans/apply-plan';
import {
	isStatusValidForDestination,
	type CoverageDestination,
	type CoverageStatus
} from '$lib/artwork-coverage';
import { LEGACY_FILENAME, type KometaMetadataFilename } from '$lib/server/kometa/destination';

/** Any metadata file coverage can cite, including the pre-split shared one. */
export type CoverageMetadataFilename = KometaMetadataFilename | typeof LEGACY_FILENAME;

/** The concrete copy a coverage row belongs to. */
export interface CoverageOccurrenceRef {
	occurrenceKey: string;
	serverInstanceId: string;
	mediaItemId: number;
	/** Canonical identity, or `null` for an unresolved copy that owns only its own evidence. */
	identityKey: string | null;
}

/**
 * Locale-neutral code naming *why* a status was chosen.
 *
 * The status alone loses the distinction the feature exists for: an unreadable
 * file, a file nobody looked at, and a destination that could not be resolved
 * are all `unknown`, and only this code tells the UI and the support bundle
 * which one happened.
 */
export type CoverageEvidenceSource =
	/** Expected fingerprint still matches the current server artwork. */
	| 'server_verified_match'
	/** Expected and current fingerprints are comparable and differ. */
	| 'server_fingerprint_mismatch'
	/** Fingerprints were not comparable, but the ledger recorded a later external change. */
	| 'server_external_change_recorded'
	/** A revision exists; current server state could not be verified against it. */
	| 'server_unverified'
	/** The complete ledger holds no live claim on this slot. */
	| 'server_no_revision'
	/** The ledger could not be read in full, so absence proves nothing. */
	| 'server_history_incomplete'
	/** The current typed metadata file carries the slot URL. */
	| 'kometa_typed_export'
	/** A provably owned legacy entry carries the slot URL. */
	| 'kometa_legacy_export'
	/** The file was read and holds no entry or no URL for this slot. */
	| 'kometa_no_entry'
	/** The item carries no identifier Kometa can match, so nothing could address it. */
	| 'kometa_unidentified'
	/** The file could not be read or parsed. */
	| 'kometa_file_unreadable'
	/** The caller supplied no state for the file this occurrence addresses. */
	| 'kometa_file_not_inspected'
	/** The occurrence's typed destination could not be determined. */
	| 'kometa_destination_unknown'
	/** Two entries in one file share a logical key. */
	| 'kometa_duplicate_key'
	/** A legacy entry could be this item's, and nothing proves it either way. */
	| 'kometa_legacy_ambiguous';

/** One reconciled `(occurrence, destination, slot)` fact. */
export interface CoverageEvidence extends CoverageOccurrenceRef {
	destination: CoverageDestination;
	slot: ApplySlot;
	slotKey: string;
	status: CoverageStatus;
	evidenceSource: CoverageEvidenceSource;
	/** The revision that produced the status, when a revision did. */
	revisionId: string | null;
	/** The metadata file that proved an export, when a file did. */
	metadataFilename: CoverageMetadataFilename | null;
	/**
	 * What the status was decided against: an artwork hash for server evidence,
	 * an exported-URL hash for Kometa evidence. Never the URL itself — a provider
	 * URL can carry a signature, and this value reaches the projection.
	 */
	fingerprint: string | null;
	/** When the evidence was observed, or `null` when nothing was observed. */
	observedAt: Date | null;
}

/**
 * Build a row, refusing a status the destination cannot hold.
 *
 * This is where the feature's central exclusion becomes executable rather than a
 * convention: writing a YAML file proves nothing about what a media server
 * serves, so no Kometa code path can produce `applied_on_server` even by
 * accident. `isStatusValidForDestination` owns the table; this only enforces it.
 */
export function buildCoverageEvidence(
	occurrence: CoverageOccurrenceRef,
	destination: CoverageDestination,
	slot: ApplySlot,
	status: CoverageStatus,
	evidenceSource: CoverageEvidenceSource,
	evidence: Partial<
		Pick<CoverageEvidence, 'revisionId' | 'metadataFilename' | 'fingerprint' | 'observedAt'>
	> = {}
): CoverageEvidence {
	if (!isStatusValidForDestination(destination, status)) {
		throw new TypeError(`Coverage status ${status} is not valid for destination ${destination}`);
	}
	return {
		occurrenceKey: occurrence.occurrenceKey,
		serverInstanceId: occurrence.serverInstanceId,
		mediaItemId: occurrence.mediaItemId,
		identityKey: occurrence.identityKey,
		destination,
		slot: { kind: slot.kind, season: slot.season, episode: slot.episode },
		slotKey: applySlotKey(slot),
		status,
		evidenceSource,
		revisionId: evidence.revisionId ?? null,
		metadataFilename: evidence.metadataFilename ?? null,
		fingerprint: evidence.fingerprint ?? null,
		observedAt: evidence.observedAt ?? null
	};
}

/**
 * Drop repeated slots, keeping request order.
 *
 * The projection is keyed by `(occurrence, destination, slot)`, so a duplicated
 * request would otherwise produce two rows competing for one key.
 */
export function dedupeSlots(slots: readonly ApplySlot[]): ApplySlot[] {
	const seen = new Set<string>();
	const out: ApplySlot[] = [];
	for (const slot of slots) {
		const key = applySlotKey(slot);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(slot);
	}
	return out;
}
