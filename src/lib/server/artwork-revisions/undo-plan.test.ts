import { describe, expect, it } from 'vitest';
import { canonicalJsonDigest } from '$lib/server/plans/canonical-json';
import {
	assertUndoPlanPayload,
	buildUndoPlan,
	buildUndoPlanPayload,
	type BuildUndoPlanInput,
	type FrozenUndoCurrentState,
	type FrozenUndoSnapshot,
	type UndoPlanCandidate,
	type UndoPlanScope,
	type UndoPlanSlot,
	type UndoPlanTarget
} from './undo-plan';

const PLANNED_AT = '2026-07-11T12:00:00.000Z';
const PRESENT_FINGERPRINT = 'a'.repeat(64);
const CURRENT_FINGERPRINT = 'b'.repeat(64);
const ITEM_ONE = { kind: 'item', mediaItemId: 1 } as const;
const ITEM_TWO = { kind: 'item', mediaItemId: 2 } as const;
const COLLECTION = { kind: 'collection', mediaCollectionId: 'tmdb:collection-10' } as const;
const ROOT_POSTER = { kind: 'poster', season: null, episode: null } as const;

interface CandidateOptions {
	revisionId: string;
	revisionGroupId?: string;
	revisionCreatedAt?: string;
	serverInstanceId?: string;
	target?: UndoPlanTarget;
	destination?: 'server' | 'kometa';
	targetId?: string;
	slot?: UndoPlanSlot;
	beforeSnapshotId?: string;
	current?: FrozenUndoCurrentState;
	snapshot?: FrozenUndoSnapshot;
}

function candidate(options: CandidateOptions): UndoPlanCandidate {
	return {
		revisionId: options.revisionId,
		revisionGroupId: options.revisionGroupId ?? 'group-1',
		revisionCreatedAt: options.revisionCreatedAt ?? '2026-07-11T11:00:00.000Z',
		serverInstanceId: options.serverInstanceId ?? 'server-1',
		target: options.target ?? ITEM_ONE,
		destination: options.destination ?? 'server',
		targetId: options.targetId ?? 'target-1',
		slot: options.slot ?? ROOT_POSTER,
		beforeSnapshotId: options.beforeSnapshotId ?? `snapshot-${options.revisionId}`,
		current: options.current ?? {
			state: 'present',
			fingerprint: CURRENT_FINGERPRINT,
			artworkVersion: 4
		},
		snapshot: options.snapshot ?? {
			state: 'present',
			fingerprint: PRESENT_FINGERPRINT,
			restorable: true
		}
	};
}

function scope(kind: UndoPlanScope['kind'], fields: Record<string, unknown>): UndoPlanScope {
	return { kind, serverInstanceId: 'server-1', ...fields } as UndoPlanScope;
}

function build(scopeValue: UndoPlanScope, operations: UndoPlanCandidate[]) {
	return buildUndoPlanPayload({ plannedAt: PLANNED_AT, scope: scopeValue, operations });
}

function scopedCandidates(): UndoPlanCandidate[] {
	return [
		candidate({
			revisionId: 'rev-root-server',
			revisionCreatedAt: '2026-07-11T11:06:00.000Z'
		}),
		candidate({
			revisionId: 'rev-root-kometa',
			revisionCreatedAt: '2026-07-11T11:05:00.000Z',
			destination: 'kometa',
			targetId: 'tmdb-1'
		}),
		candidate({
			revisionId: 'rev-season-poster',
			revisionCreatedAt: '2026-07-11T11:04:00.000Z',
			targetId: 'season-target-1',
			slot: { kind: 'poster', season: 1, episode: null }
		}),
		candidate({
			revisionId: 'rev-title-card',
			revisionCreatedAt: '2026-07-11T11:03:00.000Z',
			targetId: 'episode-target-2',
			slot: { kind: 'title_card', season: 1, episode: 2 }
		}),
		candidate({
			revisionId: 'rev-other-item',
			revisionCreatedAt: '2026-07-11T11:02:00.000Z',
			target: ITEM_TWO,
			targetId: 'target-2'
		}),
		candidate({
			revisionId: 'rev-collection',
			revisionCreatedAt: '2026-07-11T11:01:00.000Z',
			target: COLLECTION,
			targetId: 'collection-target-10',
			slot: { kind: 'background', season: null, episode: null }
		})
	];
}

describe('undo plan scopes', () => {
	it.each([
		['revision', scope('revision', { revisionId: 'rev-root-kometa' }), ['rev-root-kometa']],
		[
			'slot across destinations',
			scope('slot', { target: ITEM_ONE, slot: ROOT_POSTER }),
			['rev-root-server', 'rev-root-kometa']
		],
		[
			'season including episode child slots',
			scope('season', { mediaItemId: 1, season: 1 }),
			['rev-season-poster', 'rev-title-card']
		],
		[
			'item',
			scope('item', { mediaItemId: 1 }),
			['rev-root-server', 'rev-season-poster', 'rev-title-card', 'rev-root-kometa']
		],
		[
			'destination',
			scope('destination', { target: ITEM_ONE, destination: 'server' }),
			['rev-root-server', 'rev-season-poster', 'rev-title-card']
		],
		[
			'group including item and collection targets',
			scope('group', { revisionGroupId: 'group-1' }),
			[
				'rev-root-server',
				'rev-season-poster',
				'rev-title-card',
				'rev-root-kometa',
				'rev-other-item',
				'rev-collection'
			]
		]
	] as const)('selects the exact %s scope', (_label, selectedScope, expectedRevisionIds) => {
		const payload = build(selectedScope, scopedCandidates());
		expect(payload.operations.map((operation) => operation.revisionId)).toEqual(
			expectedRevisionIds
		);
		expect(() => assertUndoPlanPayload(payload)).not.toThrow();
	});

	it('supports a collection destination scope without broadening to sibling targets', () => {
		const payload = build(
			scope('destination', { target: COLLECTION, destination: 'server' }),
			scopedCandidates()
		);
		expect(payload.operations.map((operation) => operation.revisionId)).toEqual(['rev-collection']);
	});
});

describe('undo operation materialization', () => {
	it('deduplicates a destination slot to its newest revision independent of input order', () => {
		const older = candidate({
			revisionId: 'rev-older',
			revisionCreatedAt: '2026-07-11T09:00:00.000Z',
			beforeSnapshotId: 'snapshot-older'
		});
		const newer = candidate({
			revisionId: 'rev-newer',
			revisionCreatedAt: '2026-07-11T10:00:00.000Z',
			beforeSnapshotId: 'snapshot-newer'
		});
		const selectedScope = scope('item', { mediaItemId: 1 });
		const forward = buildUndoPlan({
			plannedAt: PLANNED_AT,
			scope: selectedScope,
			operations: [older, newer]
		});
		const reverse = buildUndoPlan({
			plannedAt: PLANNED_AT,
			scope: selectedScope,
			operations: [newer, older]
		});

		expect(forward.payload.operations).toHaveLength(1);
		expect(forward.payload.operations[0]).toMatchObject({
			revisionId: 'rev-newer',
			beforeSnapshotId: 'snapshot-newer'
		});
		expect(reverse).toEqual(forward);
	});

	it('freezes server and Kometa states while representing absent and unavailable snapshots', () => {
		const operations = [
			candidate({ revisionId: 'rev-present' }),
			candidate({
				revisionId: 'rev-absent',
				destination: 'kometa',
				targetId: 'tmdb-1',
				current: {
					state: 'absent',
					fingerprint: null,
					artworkVersion: null
				},
				snapshot: { state: 'absent', fingerprint: null, restorable: true }
			}),
			candidate({
				revisionId: 'rev-unavailable',
				targetId: 'season-target-2',
				slot: { kind: 'poster', season: 2, episode: null },
				current: { state: 'unavailable', fingerprint: null, artworkVersion: 4 },
				snapshot: { state: 'unavailable', fingerprint: null, restorable: false }
			})
		];
		const payload = build(scope('item', { mediaItemId: 1 }), operations);

		expect(payload.summary).toEqual({
			operationCount: 3,
			actionableCount: 2,
			unavailableCount: 1,
			targetCount: 1,
			slotCount: 2,
			destinations: { server: 2, kometa: 1 },
			restoreStates: { present: 1, absent: 1, unavailable: 1 }
		});
		expect(
			payload.operations.find((operation) => operation.destination === 'kometa')
		).toMatchObject({
			current: { state: 'absent', fingerprint: null, artworkVersion: null },
			snapshot: { state: 'absent', fingerprint: null, restorable: true }
		});
		expect(
			payload.operations.find((operation) => operation.snapshot.state === 'unavailable')
		).toMatchObject({
			current: { state: 'unavailable', fingerprint: null, artworkVersion: 4 },
			snapshot: { restorable: false }
		});
	});

	it('sorts targets, destinations, root slots, season slots, and episode slots deterministically', () => {
		const candidates = scopedCandidates();
		const selectedScope = scope('group', { revisionGroupId: 'group-1' });
		const forward = buildUndoPlan({
			plannedAt: PLANNED_AT,
			scope: selectedScope,
			operations: candidates
		});
		const reverse = buildUndoPlan({
			plannedAt: PLANNED_AT,
			scope: selectedScope,
			operations: [...candidates].reverse()
		});

		expect(forward.payload.operations.map((operation) => operation.revisionId)).toEqual([
			'rev-root-server',
			'rev-season-poster',
			'rev-title-card',
			'rev-root-kometa',
			'rev-other-item',
			'rev-collection'
		]);
		expect(reverse).toEqual(forward);
	});

	it('returns canonical JSON and a canonical SHA-256 digest without public raw state', () => {
		const result = buildUndoPlan({
			plannedAt: PLANNED_AT,
			scope: scope('slot', { target: ITEM_ONE, slot: ROOT_POSTER }),
			operations: scopedCandidates()
		});

		expect(result.digest).toMatch(/^[0-9a-f]{64}$/);
		expect(canonicalJsonDigest(result.payload)).toEqual({
			canonicalJson: result.canonicalJson,
			digest: result.digest
		});
		expect(result.digest).toBe('bdb03e3b997316f60d5b5ce47dc59354f5738cd123144d33716606fa67bc3782');
		expect(result.canonicalJson).not.toMatch(
			/https?:|storagePath|storage_path|"url"|"value"|bytes|secret|token/i
		);
	});
});

describe('undo plan validation', () => {
	function baseInput(): BuildUndoPlanInput {
		return {
			plannedAt: PLANNED_AT,
			scope: scope('item', { mediaItemId: 1 }),
			operations: [candidate({ revisionId: 'rev-valid' })]
		};
	}

	it.each([
		[
			'missing before snapshot',
			(input: BuildUndoPlanInput): void => {
				input.operations[0].beforeSnapshotId = '';
			}
		],
		[
			'unsafe target URL',
			(input: BuildUndoPlanInput): void => {
				input.operations[0].targetId = 'https://server/token';
			}
		],
		[
			'non-hash current fingerprint',
			(input: BuildUndoPlanInput): void => {
				input.operations[0].current.fingerprint = 'raw-server-url';
			}
		],
		[
			'invalid child slot',
			(input: BuildUndoPlanInput): void => {
				input.operations[0].slot = { kind: 'title_card', season: 1, episode: null };
			}
		],
		[
			'non-restorable absent snapshot',
			(input: BuildUndoPlanInput): void => {
				input.operations[0].snapshot = {
					state: 'absent',
					fingerprint: null,
					restorable: false
				} as unknown as FrozenUndoSnapshot;
			}
		],
		[
			'restorable unavailable snapshot',
			(input: BuildUndoPlanInput): void => {
				input.operations[0].snapshot = {
					state: 'unavailable',
					fingerprint: null,
					restorable: true
				} as unknown as FrozenUndoSnapshot;
			}
		],
		[
			'raw value field',
			(input: BuildUndoPlanInput): void => {
				Object.assign(input.operations[0], { value: 'https://secret.example/poster?token=x' });
			}
		],
		[
			'negative season scope',
			(input: BuildUndoPlanInput): void => {
				input.scope = scope('season', { mediaItemId: 1, season: -1 });
			}
		]
	] as const)('rejects %s', (_label, mutate) => {
		const input = baseInput();
		mutate(input);
		expect(() => buildUndoPlanPayload(input)).toThrow(/undo|snapshot|scope|fingerprint|slot|safe/i);
	});

	it('rejects a scope with no matching revision', () => {
		const input = baseInput();
		input.scope = scope('revision', { revisionId: 'rev-not-found' });
		expect(() => buildUndoPlanPayload(input)).toThrow(/no matching revision/i);
	});

	it.each([
		[
			'operation id',
			(payload: Record<string, any>): void => {
				payload.operations[0].id = 'd'.repeat(64);
			}
		],
		[
			'source fingerprint',
			(payload: Record<string, any>): void => {
				payload.sourceFingerprint = 'd'.repeat(64);
			}
		],
		[
			'summary',
			(payload: Record<string, any>): void => {
				payload.summary.actionableCount = 99;
			}
		],
		[
			'ordering',
			(payload: Record<string, any>): void => {
				payload.operations = [...payload.operations].reverse();
			}
		],
		[
			'extra public field',
			(payload: Record<string, any>): void => {
				payload.operations[0].storagePath = '/data/snapshots/secret';
			}
		]
	] as const)('detects tampered %s', (_label, mutate) => {
		const payload = structuredClone(
			build(scope('slot', { target: ITEM_ONE, slot: ROOT_POSTER }), scopedCandidates())
		) as unknown as Record<string, any>;
		mutate(payload);
		expect(() => assertUndoPlanPayload(payload)).toThrow();
	});

	it('detects duplicate destination slots even when operation ids remain individually valid', () => {
		const payload = structuredClone(
			build(scope('slot', { target: ITEM_ONE, slot: ROOT_POSTER }), scopedCandidates())
		);
		payload.operations.push(payload.operations[0]);
		expect(() => assertUndoPlanPayload(payload)).toThrow(/duplicate destination slot/i);
	});
});
