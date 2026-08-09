import { describe, expect, it } from 'vitest';
import { isCovered, isStatusValidForDestination } from '$lib/artwork-coverage';
import type { ApplySlot } from '$lib/server/plans/apply-plan';
import {
	LEGACY_FILENAME,
	MOVIE_FILENAME,
	SHOW_FILENAME,
	legacyKometaDestinationKey,
	parseKometaLegacyDestinationKey,
	resolveKometaDestination,
	type KometaDestinationV2
} from '$lib/server/kometa/destination';
import { kometaSlotFingerprint } from '$lib/server/revisions/kometa-state';
import { coverageOccurrenceKey } from './occurrences';
import { buildCoverageEvidence } from './reconcile-types';
import {
	reconcileKometaCoverage,
	type KometaCoverageInput,
	type KometaCoverageRequest
} from './reconcile-kometa';

const POSTER: ApplySlot = { kind: 'poster', season: null, episode: null };
const BACKGROUND: ApplySlot = { kind: 'background', season: null, episode: null };
const SEASON_POSTER: ApplySlot = { kind: 'poster', season: 2, episode: null };

const POSTER_URL = 'https://images.example/poster.jpg';
const OBSERVED_AT = new Date('2026-03-01T00:00:00Z');

function movieDestination(tmdbId = '105'): KometaDestinationV2 {
	const resolved = resolveKometaDestination({ type: 'movie', tmdbId });
	if (!resolved.ok) throw new Error('fixture destination must resolve');
	return resolved.destination;
}

function showDestination(tvdbId = '900'): KometaDestinationV2 {
	const resolved = resolveKometaDestination({ type: 'show', tvdbId });
	if (!resolved.ok) throw new Error('fixture destination must resolve');
	return resolved.destination;
}

function legacyDestination(mappingId: string) {
	const parsed = parseKometaLegacyDestinationKey(legacyKometaDestinationKey(mappingId));
	if (!parsed) throw new Error('fixture legacy destination must parse');
	return parsed;
}

function request(overrides: Partial<KometaCoverageRequest> = {}): KometaCoverageRequest {
	const serverInstanceId = overrides.serverInstanceId ?? 'plex-1';
	const mediaItemId = overrides.mediaItemId ?? 1;
	return {
		occurrenceKey: coverageOccurrenceKey(serverInstanceId, mediaItemId),
		serverInstanceId,
		mediaItemId,
		identityKey: 'movie:105',
		tmdbId: '105',
		destination: { state: 'resolved', destination: movieDestination() },
		slots: [POSTER],
		...overrides
	};
}

function statuses(input: KometaCoverageInput): string[] {
	return reconcileKometaCoverage(input).coverage.map((evidence) => evidence.status);
}

describe('Kometa coverage reconciliation', () => {
	it('reports exported when the current typed file carries the slot URL', () => {
		const { coverage } = reconcileKometaCoverage({
			requests: [request()],
			files: [
				{
					filename: MOVIE_FILENAME,
					state: 'parsed',
					entries: [{ mappingKey: 105, slots: [{ slot: POSTER, url: POSTER_URL }] }]
				}
			],
			observedAt: OBSERVED_AT
		});

		expect(coverage[0]).toMatchObject({
			destination: 'kometa',
			status: 'exported_to_kometa',
			metadataFilename: MOVIE_FILENAME,
			fingerprint: kometaSlotFingerprint({ state: 'present', url: POSTER_URL }),
			observedAt: OBSERVED_AT,
			revisionId: null
		});
		expect(isCovered(coverage[0].status)).toBe(true);
	});

	it('treats a quoted and an unquoted mapping key as the same entry', () => {
		expect(
			statuses({
				requests: [request()],
				files: [
					{
						filename: MOVIE_FILENAME,
						state: 'parsed',
						entries: [{ mappingKey: '105', slots: [{ slot: POSTER, url: POSTER_URL }] }]
					}
				]
			})
		).toEqual(['exported_to_kometa']);
	});

	it('never reports a Kometa export as applied on a media server', () => {
		const { coverage } = reconcileKometaCoverage({
			requests: [request()],
			files: [
				{
					filename: MOVIE_FILENAME,
					state: 'parsed',
					entries: [{ mappingKey: 105, slots: [{ slot: POSTER, url: POSTER_URL }] }]
				}
			]
		});

		expect(coverage.every((evidence) => evidence.destination === 'kometa')).toBe(true);
		expect(coverage.every((evidence) => evidence.status !== 'applied_on_server')).toBe(true);
		expect(isStatusValidForDestination('kometa', 'applied_on_server')).toBe(false);
		expect(() =>
			buildCoverageEvidence(request(), 'kometa', POSTER, 'applied_on_server', 'kometa_typed_export')
		).toThrow(TypeError);
	});

	it('reports missing when the file exists and holds no entry or slot', () => {
		expect(
			statuses({
				requests: [request()],
				files: [{ filename: MOVIE_FILENAME, state: 'parsed', entries: [] }]
			})
		).toEqual(['missing']);
		expect(
			statuses({
				requests: [request()],
				files: [
					{
						filename: MOVIE_FILENAME,
						state: 'parsed',
						entries: [{ mappingKey: 105, slots: [{ slot: POSTER, url: null }] }]
					}
				]
			})
		).toEqual(['missing']);
	});

	it('reports missing when the typed file does not exist', () => {
		expect(
			statuses({ requests: [request()], files: [{ filename: MOVIE_FILENAME, state: 'absent' }] })
		).toEqual(['missing']);
	});

	it('reports unknown, never missing, when the file cannot be read or parsed', () => {
		expect(
			statuses({
				requests: [request()],
				files: [{ filename: MOVIE_FILENAME, state: 'unreadable' }]
			})
		).toEqual(['unknown']);
	});

	it('reports unknown when the caller never mentioned the addressed file', () => {
		expect(statuses({ requests: [request()], files: [] })).toEqual(['unknown']);
		expect(
			statuses({
				requests: [request()],
				files: [{ filename: SHOW_FILENAME, state: 'parsed', entries: [] }]
			})
		).toEqual(['unknown']);
	});

	it('reports unknown when two entries share one logical key', () => {
		expect(
			statuses({
				requests: [request()],
				files: [
					{
						filename: MOVIE_FILENAME,
						state: 'parsed',
						entries: [
							{ mappingKey: 105, slots: [{ slot: POSTER, url: POSTER_URL }] },
							{ mappingKey: '105', slots: [] }
						]
					}
				]
			})
		).toEqual(['unknown']);
	});

	it('reports missing when the item has no identifier Kometa can match', () => {
		expect(
			statuses({
				requests: [request({ destination: { state: 'unidentified' }, tmdbId: null })],
				files: [{ filename: MOVIE_FILENAME, state: 'parsed', entries: [] }]
			})
		).toEqual(['missing']);
	});

	it('reports unknown when the destination itself could not be determined', () => {
		expect(
			statuses({
				requests: [request({ destination: { state: 'unknown' } })],
				files: [{ filename: MOVIE_FILENAME, state: 'parsed', entries: [] }]
			})
		).toEqual(['unknown']);
	});

	it('derives each slot independently: poster exported, background absent', () => {
		const { coverage } = reconcileKometaCoverage({
			requests: [request({ slots: [POSTER, BACKGROUND, SEASON_POSTER] })],
			files: [
				{
					filename: MOVIE_FILENAME,
					state: 'parsed',
					entries: [{ mappingKey: 105, slots: [{ slot: POSTER, url: POSTER_URL }] }]
				}
			]
		});

		expect(coverage.map((evidence) => [evidence.slotKey, evidence.status])).toEqual([
			['poster:root:root', 'exported_to_kometa'],
			['background:root:root', 'missing'],
			['poster:2:root', 'missing']
		]);
	});

	it('keeps a movie and a show with the same number in their own files', () => {
		const { coverage } = reconcileKometaCoverage({
			requests: [
				request({ mediaItemId: 1 }),
				request({
					mediaItemId: 2,
					identityKey: 'tv:105',
					tmdbId: '105',
					destination: { state: 'resolved', destination: showDestination('105') }
				})
			],
			files: [
				{
					filename: MOVIE_FILENAME,
					state: 'parsed',
					entries: [{ mappingKey: 105, slots: [{ slot: POSTER, url: POSTER_URL }] }]
				},
				{ filename: SHOW_FILENAME, state: 'parsed', entries: [] }
			]
		});

		expect(coverage.map((evidence) => evidence.status)).toEqual(['exported_to_kometa', 'missing']);
	});
});

describe('legacy Kometa metadata', () => {
	it('contributes coverage when retained provenance ties the entry to one item', () => {
		const { coverage, unassignedLegacyEntries } = reconcileKometaCoverage({
			requests: [request({ legacyDestination: legacyDestination('105') })],
			files: [{ filename: MOVIE_FILENAME, state: 'parsed', entries: [] }],
			legacyFile: {
				state: 'parsed',
				entries: [{ mappingKey: 105, slots: [{ slot: POSTER, url: POSTER_URL }] }]
			}
		});

		expect(coverage[0]).toMatchObject({
			status: 'exported_to_kometa',
			metadataFilename: LEGACY_FILENAME
		});
		expect(unassignedLegacyEntries).toEqual([]);
	});

	it('leaves an untied entry unknown and unassigned to either kind', () => {
		const { coverage, unassignedLegacyEntries } = reconcileKometaCoverage({
			requests: [
				request({ mediaItemId: 1, identityKey: 'movie:105', tmdbId: '105' }),
				request({
					mediaItemId: 2,
					identityKey: 'tv:105',
					tmdbId: '105',
					destination: { state: 'resolved', destination: showDestination('900') }
				})
			],
			files: [
				{ filename: MOVIE_FILENAME, state: 'parsed', entries: [] },
				{ filename: SHOW_FILENAME, state: 'parsed', entries: [] }
			],
			legacyFile: {
				state: 'parsed',
				entries: [{ mappingKey: 105, slots: [{ slot: POSTER, url: POSTER_URL }] }]
			}
		});

		expect(coverage.map((evidence) => evidence.status)).toEqual(['unknown', 'unknown']);
		expect(coverage.every((evidence) => evidence.metadataFilename === null)).toBe(true);
		expect(unassignedLegacyEntries).toEqual([{ mappingKey: '105', reason: 'ambiguous_identity' }]);
	});

	it('leaves a contested entry unknown when two items retained the same key', () => {
		const { coverage, unassignedLegacyEntries } = reconcileKometaCoverage({
			requests: [
				request({ mediaItemId: 1, legacyDestination: legacyDestination('105') }),
				request({
					mediaItemId: 2,
					identityKey: 'tv:105',
					destination: { state: 'resolved', destination: showDestination('900') },
					legacyDestination: legacyDestination('105')
				})
			],
			files: [
				{ filename: MOVIE_FILENAME, state: 'parsed', entries: [] },
				{ filename: SHOW_FILENAME, state: 'parsed', entries: [] }
			],
			legacyFile: {
				state: 'parsed',
				entries: [{ mappingKey: 105, slots: [{ slot: POSTER, url: POSTER_URL }] }]
			}
		});

		expect(coverage.map((evidence) => evidence.status)).toEqual(['unknown', 'unknown']);
		expect(unassignedLegacyEntries).toEqual([{ mappingKey: '105', reason: 'multiple_claimants' }]);
	});

	it('honors server-wide claimant counts over what the batch alone can see', () => {
		// A scoped refresh — an apply, an undo, a stale read — carries one copy of a
		// title whose twin in another library retained the same legacy key. Counted
		// from the batch alone the key looks uncontested; the caller-supplied
		// server-wide count is what keeps the badge from flip-flopping with scope.
		const { coverage, unassignedLegacyEntries } = reconcileKometaCoverage({
			requests: [request({ legacyDestination: legacyDestination('105') })],
			files: [{ filename: MOVIE_FILENAME, state: 'parsed', entries: [] }],
			legacyFile: {
				state: 'parsed',
				entries: [{ mappingKey: 105, slots: [{ slot: POSTER, url: POSTER_URL }] }]
			},
			legacyClaimantCounts: new Map([['105', 2]])
		});

		expect(coverage.map((evidence) => evidence.status)).toEqual(['unknown']);
		expect(unassignedLegacyEntries).toEqual([{ mappingKey: '105', reason: 'multiple_claimants' }]);
	});

	it('leaves a duplicated legacy key unknown', () => {
		const { coverage, unassignedLegacyEntries } = reconcileKometaCoverage({
			requests: [request({ legacyDestination: legacyDestination('105') })],
			files: [{ filename: MOVIE_FILENAME, state: 'parsed', entries: [] }],
			legacyFile: {
				state: 'parsed',
				entries: [
					{ mappingKey: 105, slots: [{ slot: POSTER, url: POSTER_URL }] },
					{ mappingKey: '105', slots: [] }
				]
			}
		});

		expect(coverage.map((evidence) => evidence.status)).toEqual(['unknown']);
		expect(unassignedLegacyEntries).toEqual([{ mappingKey: '105', reason: 'duplicate_key' }]);
	});

	it('reports unknown when the legacy file cannot be read', () => {
		expect(
			statuses({
				requests: [request({ legacyDestination: legacyDestination('105') })],
				files: [{ filename: MOVIE_FILENAME, state: 'parsed', entries: [] }],
				legacyFile: { state: 'unreadable' }
			})
		).toEqual(['unknown']);
	});

	it('still reports a proven typed export when the legacy file is unreadable', () => {
		expect(
			statuses({
				requests: [request()],
				files: [
					{
						filename: MOVIE_FILENAME,
						state: 'parsed',
						entries: [{ mappingKey: 105, slots: [{ slot: POSTER, url: POSTER_URL }] }]
					}
				],
				legacyFile: { state: 'unreadable' }
			})
		).toEqual(['exported_to_kometa']);
	});

	it('reports missing when the legacy file exists and holds nothing for the item', () => {
		expect(
			statuses({
				requests: [request({ legacyDestination: legacyDestination('105') })],
				files: [{ filename: MOVIE_FILENAME, state: 'parsed', entries: [] }],
				legacyFile: { state: 'parsed', entries: [{ mappingKey: 777, slots: [] }] }
			})
		).toEqual(['missing']);
	});

	it('names a legacy key no legacy destination could ever address', () => {
		const { unassignedLegacyEntries } = reconcileKometaCoverage({
			requests: [request()],
			files: [{ filename: MOVIE_FILENAME, state: 'parsed', entries: [] }],
			legacyFile: { state: 'parsed', entries: [{ mappingKey: 'tt0111161', slots: [] }] }
		});

		expect(unassignedLegacyEntries).toEqual([
			{ mappingKey: 'tt0111161', reason: 'unsupported_key' }
		]);
	});

	it('distinguishes the three ways coverage can be unknown', () => {
		const source = (input: KometaCoverageInput) =>
			reconcileKometaCoverage(input).coverage[0].evidenceSource;

		expect(
			source({ requests: [request()], files: [{ filename: MOVIE_FILENAME, state: 'unreadable' }] })
		).toBe('kometa_file_unreadable');
		expect(source({ requests: [request()], files: [] })).toBe('kometa_file_not_inspected');
		expect(
			source({
				requests: [request({ destination: { state: 'unknown' } })],
				files: [{ filename: MOVIE_FILENAME, state: 'parsed', entries: [] }]
			})
		).toBe('kometa_destination_unknown');
		expect(
			source({
				requests: [request()],
				files: [{ filename: MOVIE_FILENAME, state: 'parsed', entries: [] }],
				legacyFile: {
					state: 'parsed',
					entries: [{ mappingKey: 105, slots: [{ slot: POSTER, url: POSTER_URL }] }]
				}
			})
		).toBe('kometa_legacy_ambiguous');
		expect(
			source({
				requests: [request({ destination: { state: 'unidentified' }, tmdbId: null })],
				files: []
			})
		).toBe('kometa_unidentified');
	});

	it('does not report legacy entries that belong to titles outside the batch', () => {
		const { unassignedLegacyEntries } = reconcileKometaCoverage({
			requests: [request()],
			files: [{ filename: MOVIE_FILENAME, state: 'parsed', entries: [] }],
			legacyFile: { state: 'parsed', entries: [{ mappingKey: 424242, slots: [] }] }
		});

		expect(unassignedLegacyEntries).toEqual([]);
	});
});
