import { describe, expect, it } from 'vitest';
import { isCovered, isIndeterminate } from '$lib/artwork-coverage';
import type { ApplySlot } from '$lib/server/plans/apply-plan';
import { coverageOccurrenceKey } from './occurrences';
import {
	reconcileServerCoverage,
	type ServerCoverageRequest,
	type ServerRevisionEvidence,
	type ServerSlotObservation
} from './reconcile-server';

const POSTER: ApplySlot = { kind: 'poster', season: null, episode: null };
const BACKGROUND: ApplySlot = { kind: 'background', season: null, episode: null };
const EPISODE_CARD: ApplySlot = { kind: 'title_card', season: 1, episode: 2 };

/** A byte digest is bare hex; a URL identity is prefixed. The distinction is load-bearing. */
const APPLIED = 'a'.repeat(64);
const SOMETHING_ELSE = 'b'.repeat(64);

const AT = new Date('2026-02-01T00:00:00Z');
const LATER = new Date('2026-02-02T00:00:00Z');

function request(overrides: Partial<ServerCoverageRequest> = {}): ServerCoverageRequest {
	const serverInstanceId = overrides.serverInstanceId ?? 'plex-1';
	const mediaItemId = overrides.mediaItemId ?? 1;
	return {
		occurrenceKey: coverageOccurrenceKey(serverInstanceId, mediaItemId),
		serverInstanceId,
		mediaItemId,
		identityKey: 'movie:105',
		slots: [POSTER],
		...overrides
	};
}

function revision(overrides: Partial<ServerRevisionEvidence> = {}): ServerRevisionEvidence {
	return {
		revisionId: 'rev-1',
		serverInstanceId: 'plex-1',
		mediaItemId: 1,
		destination: 'server',
		action: 'apply',
		kind: 'poster',
		season: null,
		episode: null,
		outcome: 'success',
		verification: 'exact',
		proposedFingerprint: APPLIED,
		createdAt: AT,
		completedAt: AT,
		...overrides
	};
}

function observation(overrides: Partial<ServerSlotObservation> = {}): ServerSlotObservation {
	return {
		serverInstanceId: 'plex-1',
		mediaItemId: 1,
		kind: 'poster',
		season: null,
		episode: null,
		currentFingerprint: APPLIED,
		lastObservedAt: AT,
		lastVerifiedAt: AT,
		...overrides
	};
}

function statuses(input: Parameters<typeof reconcileServerCoverage>[0]): string[] {
	return reconcileServerCoverage(input).map((evidence) => evidence.status);
}

describe('direct server coverage reconciliation', () => {
	it('reports applied when the expected fingerprint still matches the current one', () => {
		const [evidence] = reconcileServerCoverage({
			requests: [request()],
			revisions: [revision()],
			observations: [observation()]
		});

		expect(evidence.status).toBe('applied_on_server');
		expect(isCovered(evidence.status)).toBe(true);
		expect(evidence).toMatchObject({
			destination: 'server',
			slotKey: 'poster:root:root',
			revisionId: 'rev-1',
			fingerprint: APPLIED,
			observedAt: AT,
			identityKey: 'movie:105'
		});
	});

	it('reports unverified when the revision exists but nothing observed the slot', () => {
		expect(statuses({ requests: [request()], revisions: [revision()], observations: [] })).toEqual([
			'recorded_unverified'
		]);
	});

	it('reports unverified when the revision recorded no expected fingerprint', () => {
		expect(
			statuses({
				requests: [request()],
				revisions: [revision({ proposedFingerprint: null })],
				observations: [observation()]
			})
		).toEqual(['recorded_unverified']);
	});

	it('reports unverified when the current observation carries no fingerprint', () => {
		expect(
			statuses({
				requests: [request()],
				revisions: [revision()],
				observations: [observation({ currentFingerprint: null })]
			})
		).toEqual(['recorded_unverified']);
	});

	it('reports externally changed when the current artwork no longer matches', () => {
		const [evidence] = reconcileServerCoverage({
			requests: [request()],
			revisions: [revision()],
			observations: [observation({ currentFingerprint: SOMETHING_ELSE, lastObservedAt: LATER })]
		});

		expect(evidence.status).toBe('externally_changed');
		expect(isCovered(evidence.status)).toBe(false);
		expect(evidence.fingerprint).toBe(SOMETHING_ELSE);
		expect(evidence.observedAt).toEqual(LATER);
	});

	it('does not call a best-effort URL identity an external change', () => {
		// A rescan that could not read bytes stores `url:<hash>`. Comparing it against
		// a byte digest would flag every such observation as somebody else's edit.
		expect(
			statuses({
				requests: [request()],
				revisions: [revision()],
				observations: [observation({ currentFingerprint: `url:${'c'.repeat(64)}` })]
			})
		).toEqual(['recorded_unverified']);
	});

	it('uses a recorded external change when the fingerprints cannot be compared', () => {
		expect(
			statuses({
				requests: [request()],
				revisions: [revision()],
				observations: [
					observation({ currentFingerprint: `url:${'c'.repeat(64)}`, externalChangedAt: LATER })
				]
			})
		).toEqual(['externally_changed']);
	});

	it('reports missing when the complete ledger holds no successful apply', () => {
		expect(statuses({ requests: [request()], revisions: [], observations: [] })).toEqual([
			'missing'
		]);
		expect(
			statuses({
				requests: [request()],
				revisions: [revision({ outcome: 'failed', verification: 'failed' })],
				observations: [observation({ currentFingerprint: SOMETHING_ELSE })]
			})
		).toEqual(['missing']);
	});

	it('withdraws the claim after a successful undo', () => {
		expect(
			statuses({
				requests: [request()],
				revisions: [
					revision(),
					revision({ revisionId: 'rev-2', action: 'undo', createdAt: LATER, completedAt: LATER })
				],
				observations: [observation()]
			})
		).toEqual(['missing']);
	});

	it('re-applies after an undo when a later apply succeeds', () => {
		expect(
			statuses({
				requests: [request()],
				revisions: [
					revision({ revisionId: 'rev-2', action: 'undo' }),
					revision({ revisionId: 'rev-3', createdAt: LATER, completedAt: LATER })
				],
				observations: [observation()]
			})
		).toEqual(['applied_on_server']);
	});

	it('reports unknown, never missing, when the ledger could not be read in full', () => {
		const [evidence] = reconcileServerCoverage({
			requests: [request()],
			revisions: [],
			observations: [],
			historyComplete: false
		});

		expect(evidence.status).toBe('unknown');
		expect(isIndeterminate(evidence.status)).toBe(true);
	});

	it('never derives server coverage from a Kometa revision', () => {
		expect(
			statuses({
				requests: [request()],
				revisions: [revision({ destination: 'kometa' })],
				observations: [observation()]
			})
		).toEqual(['missing']);
	});

	it('ignores collection-scoped revisions, which carry no canonical identity', () => {
		expect(
			statuses({
				requests: [request()],
				revisions: [revision({ mediaItemId: null, mediaCollectionId: 'col-1' })],
				observations: [observation()]
			})
		).toEqual(['missing']);
	});

	it('treats an external observation as evidence, not as a claim of its own', () => {
		expect(
			statuses({
				requests: [request()],
				revisions: [revision({ action: 'external_observation' })],
				observations: [observation()]
			})
		).toEqual(['missing']);
	});

	it('derives each slot independently: poster present, background absent', () => {
		const results = reconcileServerCoverage({
			requests: [request({ slots: [POSTER, BACKGROUND] })],
			revisions: [revision()],
			observations: [observation()]
		});

		expect(results.map((evidence) => [evidence.slotKey, evidence.status])).toEqual([
			['poster:root:root', 'applied_on_server'],
			['background:root:root', 'missing']
		]);
	});

	it('keeps season and episode slots distinct from the root slot', () => {
		const results = reconcileServerCoverage({
			requests: [request({ slots: [POSTER, EPISODE_CARD] })],
			revisions: [revision({ revisionId: 'rev-card', kind: 'title_card', season: 1, episode: 2 })],
			observations: [observation({ kind: 'title_card', season: 1, episode: 2 })]
		});

		expect(results.map((evidence) => [evidence.slotKey, evidence.status])).toEqual([
			['poster:root:root', 'missing'],
			['title_card:1:2', 'applied_on_server']
		]);
	});

	it('does not let one server’s evidence cover the same title on another', () => {
		const results = reconcileServerCoverage({
			requests: [
				request({ serverInstanceId: 'plex-1', mediaItemId: 1 }),
				request({ serverInstanceId: 'jellyfin-1', mediaItemId: 7 })
			],
			revisions: [revision()],
			observations: [observation()]
		});

		expect(results.map((evidence) => [evidence.serverInstanceId, evidence.status])).toEqual([
			['plex-1', 'applied_on_server'],
			['jellyfin-1', 'missing']
		]);
	});

	it('distinguishes an unread ledger from a ledger that holds nothing', () => {
		const source = (input: Parameters<typeof reconcileServerCoverage>[0]) =>
			reconcileServerCoverage(input).map((evidence) => evidence.evidenceSource);

		expect(source({ requests: [request()], revisions: [], observations: [] })).toEqual([
			'server_no_revision'
		]);
		expect(
			source({ requests: [request()], revisions: [], observations: [], historyComplete: false })
		).toEqual(['server_history_incomplete']);
	});

	it('emits one row per requested slot even when a slot is requested twice', () => {
		const results = reconcileServerCoverage({
			requests: [request({ slots: [POSTER, { ...POSTER }] })],
			revisions: [revision()],
			observations: [observation()]
		});

		expect(results).toHaveLength(1);
	});
});
