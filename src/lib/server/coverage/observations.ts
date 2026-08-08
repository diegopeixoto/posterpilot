/**
 * The bridge between what the reconcilers decide and what the projection stores.
 *
 * `CoverageEvidence` is shaped for reasoning — a nested slot, the revision that
 * justified a status, the file that proved an export. `CoverageObservation` is
 * shaped for the table — flat slot columns, and no `librarySectionKey` or
 * `canonicalKey`, because the store resolves those from the media item so a
 * caller cannot file a title under the wrong library. Neither shape belongs in
 * the other: the reconcilers must not import `$lib/server/db`, and the store must
 * not know what a `CoverageEvidenceSource` means. This module owns the seam.
 *
 * Pure and `$env`-free — every import below is type-only or a plain function —
 * so the translation is unit-testable without a database.
 */

import type { ApplySlot, ApplySlotKind } from '$lib/server/plans/apply-plan';
import type { CoverageEvidence } from './reconcile-types';
import type { CoverageObservation, CoverageSlotKind } from './store';

/** Raw slot columns as they come off `artwork_revisions` or `artwork_slot_states`. */
export interface RawCoverageSlot {
	kind: string;
	season: number | null;
	episode: number | null;
}

/**
 * Validate a stored slot triple into an `ApplySlot`, or reject it.
 *
 * Rejection matters more than it looks: an episode slot with no season lands in
 * the projection's episode unique index against a NULL season, where NULLs are
 * distinct, so the slot would silently accept duplicates. A `title_card` without
 * an episode addresses nothing Kometa or a media server can serve. Rows shaped
 * that way are older data or a bug, and asking coverage about them would invent
 * a slot rather than report one.
 */
export function coverageSlot(raw: RawCoverageSlot): ApplySlot | null {
	const { kind, season, episode } = raw;
	if (kind !== 'poster' && kind !== 'background' && kind !== 'title_card') return null;
	if (season !== null && (!Number.isSafeInteger(season) || season < 0)) return null;
	if (episode !== null && (!Number.isSafeInteger(episode) || episode < 0)) return null;
	if (kind === 'title_card') {
		return season !== null && episode !== null ? { kind, season, episode } : null;
	}
	return episode === null ? { kind, season, episode: null } : null;
}

/**
 * Bounded structured context for the pane that explains a status.
 *
 * Only the metadata filename travels: it is one of three compile-time constants,
 * never a filesystem path. The fingerprint already has its own column and is a
 * hash, never a URL — this object reaches the client and the support bundle.
 */
function evidenceDetail(evidence: CoverageEvidence): Record<string, unknown> | null {
	return evidence.metadataFilename === null ? null : { metadataFile: evidence.metadataFilename };
}

/** `ApplySlotKind` and `CoverageSlotKind` are the same three slots, named twice. */
function slotKind(kind: ApplySlotKind): CoverageSlotKind {
	return kind;
}

/**
 * Translate one reconciled fact into a row the store will accept.
 *
 * `observedAt` falls back to the refresh instant only when nothing was observed
 * at all. Evidence that carries its own observation time keeps it: staleness-
 * driven re-reconciliation reads that column, and stamping a replayed hour-old
 * verification as "just now" would hide exactly the rows that need re-observing.
 */
export function toCoverageObservation(
	evidence: CoverageEvidence,
	refreshedAt: Date
): CoverageObservation {
	return {
		serverInstanceId: evidence.serverInstanceId,
		mediaItemId: evidence.mediaItemId,
		destination: evidence.destination,
		kind: slotKind(evidence.slot.kind),
		season: evidence.slot.season,
		episode: evidence.slot.episode,
		status: evidence.status,
		evidenceSource: evidence.evidenceSource,
		evidenceRevisionId: evidence.revisionId,
		evidenceFingerprint: evidence.fingerprint,
		evidenceDetail: evidenceDetail(evidence),
		observedAt: evidence.observedAt ?? refreshedAt
	};
}

export function toCoverageObservations(
	evidence: readonly CoverageEvidence[],
	refreshedAt: Date
): CoverageObservation[] {
	return evidence.map((row) => toCoverageObservation(row, refreshedAt));
}
