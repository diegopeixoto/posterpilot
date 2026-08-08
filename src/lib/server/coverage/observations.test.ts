import { describe, expect, it } from 'vitest';
import { buildCoverageEvidence, type CoverageOccurrenceRef } from './reconcile-types';
import { coverageSlot, toCoverageObservation, toCoverageObservations } from './observations';

const REFRESHED_AT = new Date('2026-08-08T12:00:00.000Z');
const OBSERVED_AT = new Date('2026-08-08T11:00:00.000Z');

const occurrence: CoverageOccurrenceRef = {
	occurrenceKey: JSON.stringify(['server-a', 91]),
	serverInstanceId: 'server-a',
	mediaItemId: 91,
	identityKey: 'movie:105'
};

describe('coverageSlot', () => {
	it('accepts the three slot shapes the projection indexes separately', () => {
		expect(coverageSlot({ kind: 'poster', season: null, episode: null })).toEqual({
			kind: 'poster',
			season: null,
			episode: null
		});
		expect(coverageSlot({ kind: 'background', season: 0, episode: null })).toEqual({
			kind: 'background',
			season: 0,
			episode: null
		});
		expect(coverageSlot({ kind: 'title_card', season: 2, episode: 7 })).toEqual({
			kind: 'title_card',
			season: 2,
			episode: 7
		});
	});

	it('rejects an episode slot with no season', () => {
		// NULLs are distinct in the episode unique index, so this shape would let the
		// projection accept duplicate rows for one logical slot.
		expect(coverageSlot({ kind: 'poster', season: null, episode: 3 })).toBeNull();
		expect(coverageSlot({ kind: 'title_card', season: null, episode: 3 })).toBeNull();
	});

	it('rejects a title card with no episode and any unknown kind', () => {
		expect(coverageSlot({ kind: 'title_card', season: 1, episode: null })).toBeNull();
		expect(coverageSlot({ kind: 'logo', season: null, episode: null })).toBeNull();
	});

	it('rejects negative and non-integer slot numbers', () => {
		expect(coverageSlot({ kind: 'poster', season: -1, episode: null })).toBeNull();
		expect(coverageSlot({ kind: 'title_card', season: 1, episode: 1.5 })).toBeNull();
	});
});

describe('toCoverageObservation', () => {
	it('flattens the nested slot and renames the evidence fields the store expects', () => {
		const evidence = buildCoverageEvidence(
			occurrence,
			'server',
			{ kind: 'title_card', season: 2, episode: 7 },
			'applied_on_server',
			'server_verified_match',
			{ revisionId: 'revision-1', fingerprint: 'sha-a', observedAt: OBSERVED_AT }
		);

		expect(toCoverageObservation(evidence, REFRESHED_AT)).toEqual({
			serverInstanceId: 'server-a',
			mediaItemId: 91,
			destination: 'server',
			kind: 'title_card',
			season: 2,
			episode: 7,
			status: 'applied_on_server',
			evidenceSource: 'server_verified_match',
			evidenceRevisionId: 'revision-1',
			evidenceFingerprint: 'sha-a',
			evidenceDetail: null,
			observedAt: OBSERVED_AT
		});
	});

	it('keeps the evidence observation time rather than the refresh instant', () => {
		const evidence = buildCoverageEvidence(
			occurrence,
			'server',
			{ kind: 'poster', season: null, episode: null },
			'applied_on_server',
			'server_verified_match',
			{ observedAt: OBSERVED_AT }
		);
		// Staleness-driven re-reconciliation reads observedAt, so stamping a replayed
		// hour-old verification as "just now" would hide the rows that need re-observing.
		expect(toCoverageObservation(evidence, REFRESHED_AT).observedAt).toBe(OBSERVED_AT);
	});

	it('falls back to the refresh instant only when nothing was observed', () => {
		const evidence = buildCoverageEvidence(
			occurrence,
			'server',
			{ kind: 'poster', season: null, episode: null },
			'missing',
			'server_no_revision'
		);
		expect(toCoverageObservation(evidence, REFRESHED_AT).observedAt).toBe(REFRESHED_AT);
	});

	it('carries only the metadata filename into the client-visible detail', () => {
		const evidence = buildCoverageEvidence(
			occurrence,
			'kometa',
			{ kind: 'poster', season: null, episode: null },
			'exported_to_kometa',
			'kometa_typed_export',
			{ metadataFilename: 'posterpilot-movies.yml', fingerprint: 'sha-b' }
		);
		const observation = toCoverageObservation(evidence, REFRESHED_AT);
		expect(observation.evidenceDetail).toEqual({ metadataFile: 'posterpilot-movies.yml' });
		// The fingerprint is a hash and has its own column; no URL reaches the detail.
		expect(JSON.stringify(observation.evidenceDetail)).not.toContain('http');
	});

	it('maps a batch in order', () => {
		const evidence = [
			buildCoverageEvidence(
				occurrence,
				'server',
				{ kind: 'poster', season: null, episode: null },
				'missing',
				'server_no_revision'
			),
			buildCoverageEvidence(
				occurrence,
				'kometa',
				{ kind: 'poster', season: null, episode: null },
				'exported_to_kometa',
				'kometa_typed_export'
			)
		];
		expect(toCoverageObservations(evidence, REFRESHED_AT).map((row) => row.destination)).toEqual([
			'server',
			'kometa'
		]);
	});
});
