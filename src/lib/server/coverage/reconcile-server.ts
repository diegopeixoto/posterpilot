/**
 * Direct media-server coverage, reconciled from the immutable revision ledger
 * plus the current per-slot observation.
 *
 * Two records answer the question together and neither answers it alone. The
 * ledger says *we wrote this, and this is the fingerprint we expected to end up
 * there*; `artwork_slot_states` says *this is what the server serves right now*.
 * Coverage is the agreement between them, which is why an item someone
 * re-postered in Plex reports `externally_changed` instead of quietly staying
 * green.
 *
 * Pure by design: the caller supplies the evidence, so nothing here needs a
 * database and every branch is one function call away in a test.
 */

import type { ApplySlot, ApplySlotKind } from '$lib/server/plans/apply-plan';
import { applySlotKey } from '$lib/server/plans/apply-plan';
import {
	buildCoverageEvidence,
	dedupeSlots,
	type CoverageEvidence,
	type CoverageOccurrenceRef
} from './reconcile-types';

/**
 * The `artwork_revisions` columns coverage reads.
 *
 * `destination` and `mediaCollectionId` are included so this function can reject
 * rows rather than trust the caller to have filtered them: a Kometa revision
 * reaching this code path must never become server coverage.
 */
export interface ServerRevisionEvidence {
	revisionId: string;
	serverInstanceId: string;
	/** Coverage is per media item; a collection-scoped revision has no canonical identity. */
	mediaItemId: number | null;
	mediaCollectionId?: string | null;
	destination: 'server' | 'kometa';
	action: 'apply' | 'undo' | 'external_observation';
	kind: ApplySlotKind;
	season: number | null;
	episode: number | null;
	outcome: 'pending' | 'success' | 'failed' | 'skipped';
	verification: 'pending' | 'exact' | 'best_effort' | 'unavailable' | 'mismatch' | 'failed';
	/** The fingerprint the write was expected to leave behind. */
	proposedFingerprint: string | null;
	createdAt: Date;
	completedAt?: Date | null;
}

/** The `artwork_slot_states` columns coverage reads: what the server serves now. */
export interface ServerSlotObservation {
	serverInstanceId: string;
	mediaItemId: number;
	kind: ApplySlotKind;
	season: number | null;
	episode: number | null;
	currentFingerprint: string | null;
	lastObservedAt?: Date | null;
	lastVerifiedAt?: Date | null;
	externalChangedAt?: Date | null;
}

export interface ServerCoverageRequest extends CoverageOccurrenceRef {
	/** The root and child slots coverage was asked about. Absence is computed against these. */
	slots: ApplySlot[];
}

export interface ServerCoverageInput {
	requests: readonly ServerCoverageRequest[];
	revisions: readonly ServerRevisionEvidence[];
	observations: readonly ServerSlotObservation[];
	/**
	 * Set `false` when the revision ledger could not be read in full.
	 *
	 * The absence of a successful revision is normally *proof* we never applied
	 * anything — the ledger is append-only and ours. A partial read must not be
	 * allowed to impersonate that proof, or a failed query would mark a fully
	 * applied library as missing. Defaults to `true` because the caller reads the
	 * ledger in the same transaction, where failure throws instead of returning
	 * an empty list.
	 */
	historyComplete?: boolean;
}

/**
 * Weak-identity prefix produced by `fingerprintArtworkUrl` when the artwork
 * bytes could not be read and only the URL could be hashed.
 */
const URL_IDENTITY_PREFIX = 'url:';

/**
 * Fingerprints only mean the same thing inside one evidence class.
 *
 * A `url:` identity is a hash of a redacted URL; a bare hex digest is a hash of
 * the image bytes. They never match even when the artwork is identical, so
 * comparing across classes would report every best-effort observation as an
 * external change. Mixed classes are "cannot verify", not "changed".
 */
function comparableFingerprints(expected: string, current: string): boolean {
	return expected.startsWith(URL_IDENTITY_PREFIX) === current.startsWith(URL_IDENTITY_PREFIX);
}

function revisionSlotKey(revision: ServerRevisionEvidence): string {
	return applySlotKey({ kind: revision.kind, season: revision.season, episode: revision.episode });
}

function observationSlotKey(observation: ServerSlotObservation): string {
	return applySlotKey({
		kind: observation.kind,
		season: observation.season,
		episode: observation.episode
	});
}

function occurrenceSlotIndexKey(
	serverInstanceId: string,
	mediaItemId: number,
	slotKey: string
): string {
	return JSON.stringify([serverInstanceId, mediaItemId, slotKey]);
}

function revisionTime(revision: ServerRevisionEvidence): number {
	return (revision.completedAt ?? revision.createdAt).getTime();
}

/** Chronological, then stable on id so equal timestamps cannot reorder between runs. */
function compareRevisions(a: ServerRevisionEvidence, b: ServerRevisionEvidence): number {
	return (
		revisionTime(a) - revisionTime(b) ||
		a.createdAt.getTime() - b.createdAt.getTime() ||
		a.revisionId.localeCompare(b.revisionId)
	);
}

function latestTimestamp(...values: (Date | null | undefined)[]): Date | null {
	let latest: Date | null = null;
	for (const value of values) {
		if (!value) continue;
		if (latest === null || value.getTime() > latest.getTime()) latest = value;
	}
	return latest;
}

/**
 * The revision that currently claims the slot, or `null` when nothing does.
 *
 * A successful apply makes a claim. A successful undo withdraws it — the whole
 * point of an undo is that our artwork is no longer there, so continuing to
 * report the slot as applied would describe the state we deliberately left.
 * Failed, skipped, and still-pending rows claim nothing: they record an attempt,
 * not an outcome. `external_observation` rows are somebody else's write and
 * never claim coverage; their effect reaches us through the slot observation
 * they wrote alongside.
 */
function currentClaim(revisions: ServerRevisionEvidence[]): ServerRevisionEvidence | null {
	let claim: ServerRevisionEvidence | null = null;
	for (const revision of revisions) {
		if (revision.outcome !== 'success') continue;
		if (revision.action === 'apply') claim = revision;
		else if (revision.action === 'undo') claim = null;
	}
	return claim;
}

function reconcileSlot(
	request: ServerCoverageRequest,
	slot: ApplySlot,
	slotRevisions: ServerRevisionEvidence[],
	observation: ServerSlotObservation | undefined,
	historyComplete: boolean
): CoverageEvidence {
	// Nothing below can be trusted if we could not see the whole ledger.
	if (!historyComplete) {
		return buildCoverageEvidence(request, 'server', slot, 'unknown', 'server_history_incomplete', {
			observedAt: latestTimestamp(observation?.lastVerifiedAt, observation?.lastObservedAt)
		});
	}

	const claim = currentClaim(slotRevisions);
	if (!claim) {
		// The ledger is complete and holds no live claim, so we know we never put
		// artwork here. That is a reliable observation of absence, not an unknown.
		return buildCoverageEvidence(request, 'server', slot, 'missing', 'server_no_revision', {
			observedAt: latestTimestamp(observation?.lastVerifiedAt, observation?.lastObservedAt)
		});
	}

	const claimTime = revisionTime(claim);
	const observedAt =
		latestTimestamp(observation?.lastVerifiedAt, observation?.lastObservedAt) ??
		claim.completedAt ??
		claim.createdAt;
	// Strictly after: timestamps are whole seconds, so a change recorded in the
	// same second as the claim cannot prove it happened after our write. The tie
	// stays `recorded_unverified` — "we cannot say" — rather than accusing the
	// apply the user just made of having been overwritten.
	const changedAfterClaim =
		observation?.externalChangedAt != null && observation.externalChangedAt.getTime() > claimTime;

	// History exists but there is nothing to compare it against. Somebody else may
	// well have replaced the artwork; we simply cannot say, so this is `unverified`
	// unless the ledger independently recorded an external change after our write.
	const unprovable = (): CoverageEvidence =>
		buildCoverageEvidence(
			request,
			'server',
			slot,
			changedAfterClaim ? 'externally_changed' : 'recorded_unverified',
			changedAfterClaim ? 'server_external_change_recorded' : 'server_unverified',
			{
				revisionId: claim.revisionId,
				fingerprint: claim.proposedFingerprint,
				observedAt
			}
		);

	if (claim.proposedFingerprint === null) return unprovable();
	const current = observation?.currentFingerprint ?? null;
	if (current === null) return unprovable();
	if (!comparableFingerprints(claim.proposedFingerprint, current)) return unprovable();

	const matches = current === claim.proposedFingerprint;
	return buildCoverageEvidence(
		request,
		'server',
		slot,
		matches ? 'applied_on_server' : 'externally_changed',
		matches ? 'server_verified_match' : 'server_fingerprint_mismatch',
		{ revisionId: claim.revisionId, fingerprint: current, observedAt }
	);
}

/**
 * Reconcile direct-server coverage for every requested occurrence and slot.
 *
 * Slots are independent by construction: a poster and a background are separate
 * requests through separate revisions, so an item can be covered for one and
 * missing for the other without either implying anything about the other.
 */
export function reconcileServerCoverage(input: ServerCoverageInput): CoverageEvidence[] {
	const historyComplete = input.historyComplete ?? true;

	const revisionsBySlot = new Map<string, ServerRevisionEvidence[]>();
	for (const revision of input.revisions) {
		// A Kometa revision proves a file was written, never that a server serves it.
		if (revision.destination !== 'server') continue;
		// Collections carry no TMDB identity and are outside canonical coverage.
		if (revision.mediaItemId === null || revision.mediaCollectionId != null) continue;
		const key = occurrenceSlotIndexKey(
			revision.serverInstanceId,
			revision.mediaItemId,
			revisionSlotKey(revision)
		);
		const bucket = revisionsBySlot.get(key);
		if (bucket) bucket.push(revision);
		else revisionsBySlot.set(key, [revision]);
	}
	for (const bucket of revisionsBySlot.values()) bucket.sort(compareRevisions);

	const observationsBySlot = new Map<string, ServerSlotObservation>();
	for (const observation of input.observations) {
		observationsBySlot.set(
			occurrenceSlotIndexKey(
				observation.serverInstanceId,
				observation.mediaItemId,
				observationSlotKey(observation)
			),
			observation
		);
	}

	const results: CoverageEvidence[] = [];
	for (const request of input.requests) {
		for (const slot of dedupeSlots(request.slots)) {
			const key = occurrenceSlotIndexKey(
				request.serverInstanceId,
				request.mediaItemId,
				applySlotKey(slot)
			);
			results.push(
				reconcileSlot(
					request,
					slot,
					revisionsBySlot.get(key) ?? [],
					observationsBySlot.get(key),
					historyComplete
				)
			);
		}
	}
	return results;
}
