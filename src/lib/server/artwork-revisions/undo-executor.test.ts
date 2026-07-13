import { describe, expect, it, vi } from 'vitest';
import type { ArtworkRevisionGroup, ArtworkSnapshot } from '$lib/server/db/schema';
import type { MediaServer, ServerArtwork, ServerType } from '$lib/server/media-server';
import { canonicalJsonDigest } from '$lib/server/plans/canonical-json';
import {
	kometaSlotFingerprint,
	readKometaSlot,
	restoreKometaSlot,
	type KometaSlotSnapshotValue
} from '$lib/server/revisions/kometa-state';
import { sha256Bytes } from '$lib/server/revisions/verification';
import {
	ArtworkUndoExecutionError,
	createArtworkUndoExecutor,
	type ArtworkUndoExecutorDependencies,
	type UndoKometaMutationInput
} from './undo-executor';
import {
	buildUndoPlan,
	type FrozenUndoCurrentState,
	type FrozenUndoSnapshot,
	type UndoPlanCandidate,
	type UndoPlanSlot
} from './undo-plan';

const NOW = new Date('2026-07-11T12:00:00.000Z');
const ROOT_POSTER = { kind: 'poster', season: null, episode: null } as const;
const ROOT_BACKGROUND = { kind: 'background', season: null, episode: null } as const;

function data(...values: number[]): ArrayBuffer {
	return Uint8Array.from(values).buffer;
}

function artwork(
	values: number[],
	identity = `identity-${values.join('-')}`,
	kind: 'poster' | 'background' = 'poster'
): ServerArtwork {
	return {
		kind,
		url: `https://server.invalid/private/${identity}`,
		identity,
		data: data(...values),
		contentType: 'image/jpeg'
	};
}

interface ServerHarness {
	server: MediaServer;
	getCurrent(): ServerArtwork | null;
	applyPosterBytes: ReturnType<typeof vi.fn>;
	applyBackgroundBytes: ReturnType<typeof vi.fn>;
	deleteArtwork: ReturnType<typeof vi.fn>;
}

function serverHarness(input: {
	type?: ServerType;
	current: ServerArtwork | null;
	afterPoster?: ServerArtwork;
	afterBackground?: ServerArtwork;
	deleteSupported?: boolean;
	posterFails?: boolean;
	backgroundFails?: boolean;
}): ServerHarness {
	let current = input.current;
	const applyPosterBytes = vi.fn(async (_id: string, bytes: ArrayBuffer) => {
		if (input.posterFails) throw new Error('token=https://secret.invalid');
		current = input.afterPoster ?? artwork([...new Uint8Array(bytes)], 'poster-written');
	});
	const applyBackgroundBytes = vi.fn(async (_id: string, bytes: ArrayBuffer) => {
		if (input.backgroundFails) throw new Error('/private/kometa/config.yml');
		current =
			input.afterBackground ??
			artwork([...new Uint8Array(bytes)], 'background-written', 'background');
	});
	const deleteArtwork = vi.fn(async () => {
		current = null;
	});
	const type = input.type ?? 'plex';
	const server: MediaServer = {
		type,
		identity: { instanceId: 'server-1', name: 'Test server', type },
		capabilities: {
			posterWrite: 'supported',
			backgroundWrite: 'supported',
			seasonWrite: 'supported',
			episodeWrite: 'supported',
			fieldLock: type === 'plex' ? 'supported' : 'unsupported',
			currentImageRetrieval: 'supported',
			artworkDelete: input.deleteSupported ? 'supported' : 'unsupported',
			evidence: 'provider_contract',
			limitations: []
		},
		testConnection: vi.fn(),
		listLibraries: vi.fn(),
		listItems: vi.fn(),
		listSeasons: vi.fn(),
		listEpisodes: vi.fn(),
		applyPosterUrl: vi.fn(),
		applyPosterBytes,
		applyBackgroundBytes,
		readArtwork: vi.fn(async () => current),
		...(input.deleteSupported ? { deleteArtwork } : {}),
		lockField: vi.fn()
	};
	return {
		server,
		getCurrent: () => current,
		applyPosterBytes,
		applyBackgroundBytes,
		deleteArtwork
	};
}

function snapshot(
	id: string,
	input: Partial<ArtworkSnapshot> & Pick<ArtworkSnapshot, 'destination' | 'kind' | 'state'>
): ArtworkSnapshot {
	return {
		id,
		serverInstanceId: 'server-1',
		mediaItemId: 1,
		mediaCollectionId: null,
		destination: input.destination,
		kind: input.kind,
		season: input.season ?? null,
		episode: input.episode ?? null,
		state: input.state,
		sha256: input.sha256 ?? null,
		storagePath: input.storagePath ?? null,
		contentType: input.contentType ?? null,
		sizeBytes: input.sizeBytes ?? null,
		value: input.value ?? null,
		metadata: input.metadata ?? null,
		isOriginal: input.isOriginal ?? false,
		retainedUntil: input.retainedUntil ?? null,
		createdAt: input.createdAt ?? NOW
	};
}

interface SnapshotHarness {
	repository: ArtworkUndoExecutorDependencies['snapshots'];
	rows: Map<string, ArtworkSnapshot>;
	captureServer: ReturnType<typeof vi.fn>;
	captureValue: ReturnType<typeof vi.fn>;
}

function snapshotHarness(
	desired: Array<{ row: ArtworkSnapshot; bytes?: Uint8Array }>
): SnapshotHarness {
	const rows = new Map(desired.map(({ row }) => [row.id, row]));
	const bytes = new Map(
		desired.flatMap((entry) => (entry.bytes ? [[entry.row.id, entry.bytes] as const] : []))
	);
	let id = 0;
	const captureServer = vi.fn(
		async (input: Parameters<ArtworkUndoExecutorDependencies['snapshots']['captureServer']>[0]) => {
			const row = snapshot(`captured-server-${++id}`, {
				destination: 'server',
				kind: input.slot.kind,
				season: input.slot.season,
				episode: input.slot.episode,
				state:
					input.artwork === undefined
						? 'unavailable'
						: input.artwork === null
							? 'absent'
							: 'present',
				sha256: input.artwork ? sha256Bytes(input.artwork.data) : null,
				storagePath: input.artwork ? `/private/snapshots/${id}` : null,
				contentType: input.artwork?.contentType ?? null,
				sizeBytes: input.artwork?.data.byteLength ?? null
			});
			rows.set(row.id, row);
			return row;
		}
	);
	const captureValue = vi.fn(
		async (input: Parameters<ArtworkUndoExecutorDependencies['snapshots']['captureValue']>[0]) => {
			const row = snapshot(`captured-value-${++id}`, {
				destination: 'kometa',
				kind: input.slot.kind,
				season: input.slot.season,
				episode: input.slot.episode,
				state: input.state,
				value: input.value ?? null,
				metadata: input.metadata ?? null
			});
			rows.set(row.id, row);
			return row;
		}
	);
	return {
		repository: {
			get: vi.fn(async (snapshotId: string) => rows.get(snapshotId) ?? null),
			readBytes: vi.fn(async (row: ArtworkSnapshot) => {
				const stored = bytes.get(row.id);
				if (!stored) throw new Error(`/private/snapshots/${row.id}`);
				return Buffer.from(stored);
			}),
			captureServer,
			captureValue
		},
		rows,
		captureServer,
		captureValue
	};
}

interface LedgerHarness {
	ledger: ArtworkUndoExecutorDependencies['ledger'];
	records: Array<Record<string, unknown>>;
	createGroup: ReturnType<typeof vi.fn>;
	finalizeGroup: ReturnType<typeof vi.fn>;
}

function ledgerHarness(): LedgerHarness {
	const records: Array<Record<string, unknown>> = [];
	let nextGroup = 0;
	const groupServer = new Map<string, string>();
	const createGroup = vi.fn(async (input: { serverInstanceId: string }) => {
		const id = `undo-group-${++nextGroup}`;
		groupServer.set(id, input.serverInstanceId);
		return { id, outcome: 'pending' } as ArtworkRevisionGroup;
	});
	const finalizeGroup = vi.fn(async (input: { groupId: string; serverInstanceId: string }) => {
		const outcomes = records
			.filter((record) => record.groupId === input.groupId)
			.map((record) => record.outcome);
		const success = outcomes.filter((outcome) => outcome === 'success').length;
		const outcome = success === outcomes.length ? 'success' : success === 0 ? 'failed' : 'partial';
		return {
			id: input.groupId,
			serverInstanceId: input.serverInstanceId,
			outcome
		} as ArtworkRevisionGroup;
	});
	return {
		ledger: {
			createGroup: createGroup as ArtworkUndoExecutorDependencies['ledger']['createGroup'],
			recordOutcome: vi.fn(async (input) => {
				records.push(input as unknown as Record<string, unknown>);
				const slotState = input.slotState
					? ({ artworkVersion: input.slotState.advanceArtworkVersion ? 6 : 5 } as never)
					: null;
				return { revision: {} as never, currentSlotState: slotState };
			}),
			finalizeGroup: finalizeGroup as ArtworkUndoExecutorDependencies['ledger']['finalizeGroup']
		},
		records,
		createGroup,
		finalizeGroup
	};
}

interface CandidateInput {
	revisionId: string;
	destination?: 'server' | 'kometa';
	targetId?: string;
	slot?: UndoPlanSlot;
	current: FrozenUndoCurrentState;
	snapshot: FrozenUndoSnapshot;
	beforeSnapshotId: string;
}

function candidate(input: CandidateInput): UndoPlanCandidate {
	return {
		revisionId: input.revisionId,
		revisionGroupId: 'source-group',
		revisionCreatedAt: '2026-07-11T11:00:00.000Z',
		serverInstanceId: 'server-1',
		target: { kind: 'item', mediaItemId: 1 },
		destination: input.destination ?? 'server',
		targetId: input.targetId ?? 'server-target-1',
		slot: input.slot ?? ROOT_POSTER,
		beforeSnapshotId: input.beforeSnapshotId,
		current: input.current,
		snapshot: input.snapshot
	};
}

function builtPlan(candidates: UndoPlanCandidate[]) {
	return buildUndoPlan({
		plannedAt: NOW.toISOString(),
		scope: { kind: 'item', serverInstanceId: 'server-1', mediaItemId: 1 },
		operations: candidates
	});
}

function defaultKometa() {
	let raw = 'metadata: {}\n';
	return {
		read: vi.fn(async () => raw),
		mutate: vi.fn(async (input: UndoKometaMutationInput) => {
			const current = readKometaSlot(raw, input.tmdbId, input.slot);
			const fingerprint = current.state === 'present' ? kometaSlotFingerprint(current) : null;
			if (
				current.state !== input.expectedCurrent.state ||
				fingerprint !== input.expectedCurrent.fingerprint
			) {
				throw new Error('stale');
			}
			raw = restoreKometaSlot(raw, input.tmdbId, input.slot, input.restore);
		}),
		setRaw(value: string) {
			raw = value;
		},
		getRaw() {
			return raw;
		}
	};
}

function executorHarness(input: {
	server?: MediaServer;
	snapshots: SnapshotHarness;
	ledger?: LedgerHarness;
	kometa?: ReturnType<typeof defaultKometa>;
	serverUnavailable?: boolean;
}) {
	const ledger = input.ledger ?? ledgerHarness();
	const kometa = input.kometa ?? defaultKometa();
	const executor = createArtworkUndoExecutor({
		serverRegistry: {
			resolve: vi.fn(async () => {
				if (input.serverUnavailable || !input.server) throw new Error('token=secret');
				return { serverInstanceId: 'server-1', server: input.server, fingerprint: 'a'.repeat(64) };
			})
		},
		snapshots: input.snapshots.repository,
		ledger: ledger.ledger,
		readKometa: kometa.read,
		mutateKometa: kometa.mutate,
		clock: () => NOW
	});
	return { executor, ledger, kometa };
}

async function execute(
	executor: ReturnType<typeof createArtworkUndoExecutor>,
	plan: ReturnType<typeof builtPlan>,
	digest = plan.digest
) {
	return executor({ planId: 'undo-plan-1', digest, payload: plan.payload });
}

describe('server artwork undo execution', () => {
	it('restores exact snapshot bytes, verifies them, records an undo revision, and advances version', async () => {
		const old = Uint8Array.from([9, 8, 7]);
		const current = artwork([1, 2, 3], 'current-secret');
		const desired = snapshot('snapshot-exact', {
			destination: 'server',
			kind: 'poster',
			state: 'present',
			sha256: sha256Bytes(old),
			storagePath: '/private/snapshots/exact',
			contentType: 'image/jpeg',
			sizeBytes: old.byteLength
		});
		const snapshots = snapshotHarness([{ row: desired, bytes: old }]);
		const server = serverHarness({ current });
		const plan = builtPlan([
			candidate({
				revisionId: 'revision-exact',
				beforeSnapshotId: desired.id,
				current: {
					state: 'present',
					fingerprint: sha256Bytes(current.data),
					artworkVersion: 5
				},
				snapshot: { state: 'present', fingerprint: sha256Bytes(old), restorable: true }
			})
		]);
		const harness = executorHarness({ server: server.server, snapshots });

		const result = await execute(harness.executor, plan);

		expect(result.status).toBe('success');
		expect(result.operations[0]).toMatchObject({
			status: 'success',
			verification: 'exact',
			errorCode: null,
			artworkVersion: 6
		});
		expect(server.applyPosterBytes).toHaveBeenCalledWith(
			'server-target-1',
			expect.any(ArrayBuffer),
			'image/jpeg'
		);
		expect([...new Uint8Array(server.getCurrent()!.data)]).toEqual([...old]);
		expect(harness.ledger.records[0]).toMatchObject({
			action: 'undo',
			undoOfRevisionId: 'revision-exact',
			beforeSnapshotId: expect.stringMatching(/^captured-server-/),
			afterSnapshotId: expect.stringMatching(/^captured-server-/),
			outcome: 'success',
			verification: 'exact',
			slotState: { advanceArtworkVersion: true }
		});
		expect(harness.ledger.createGroup).toHaveBeenCalledTimes(1);
		expect(harness.ledger.finalizeGroup).toHaveBeenCalledTimes(1);
		const publicResult = JSON.stringify(result);
		expect(publicResult).not.toMatch(/https?:|\/private\/|storagePath|bytes|url/i);
	});

	it('accepts a provider transcode only as best-effort verification', async () => {
		const old = Uint8Array.from([9, 9, 9]);
		const current = artwork([1, 1, 1], 'before');
		const transcoded = artwork([7, 7, 7], 'after-transcode');
		const desired = snapshot('snapshot-transcoded', {
			destination: 'server',
			kind: 'poster',
			state: 'present',
			sha256: sha256Bytes(old),
			storagePath: '/private/snapshots/transcoded'
		});
		const snapshots = snapshotHarness([{ row: desired, bytes: old }]);
		const server = serverHarness({ current, afterPoster: transcoded });
		const plan = builtPlan([
			candidate({
				revisionId: 'revision-transcoded',
				beforeSnapshotId: desired.id,
				current: {
					state: 'present',
					fingerprint: sha256Bytes(current.data),
					artworkVersion: 1
				},
				snapshot: { state: 'present', fingerprint: sha256Bytes(old), restorable: true }
			})
		]);
		const harness = executorHarness({ server: server.server, snapshots });

		const result = await execute(harness.executor, plan);

		expect(result.operations[0]).toMatchObject({
			status: 'success',
			verification: 'best_effort',
			artworkVersion: 6
		});
		expect(harness.ledger.records[0]).toMatchObject({
			verification: 'best_effort',
			slotState: { advanceArtworkVersion: true }
		});
	});

	it.each(['jellyfin', 'emby'] as const)(
		'restores true absence through %s deleteArtwork and verifies it exactly',
		async (type) => {
			const current = artwork([4, 5, 6], 'before-delete');
			const desired = snapshot(`snapshot-absent-${type}`, {
				destination: 'server',
				kind: 'poster',
				state: 'absent'
			});
			const snapshots = snapshotHarness([{ row: desired }]);
			const server = serverHarness({ type, current, deleteSupported: true });
			const plan = builtPlan([
				candidate({
					revisionId: `revision-absent-${type}`,
					beforeSnapshotId: desired.id,
					current: {
						state: 'present',
						fingerprint: sha256Bytes(current.data),
						artworkVersion: 2
					},
					snapshot: { state: 'absent', fingerprint: null, restorable: true }
				})
			]);
			const harness = executorHarness({ server: server.server, snapshots });

			const result = await execute(harness.executor, plan);

			expect(result.operations[0]).toMatchObject({ status: 'success', verification: 'exact' });
			expect(server.deleteArtwork).toHaveBeenCalledWith('server-target-1', 'poster');
			expect(server.getCurrent()).toBeNull();
			expect(harness.ledger.records[0]).toMatchObject({
				outcome: 'success',
				slotState: { currentUrl: null, currentFingerprint: null, advanceArtworkVersion: true }
			});
		}
	);

	it('fails explicitly when Plex cannot restore an absent slot', async () => {
		const current = artwork([1], 'plex-current');
		const desired = snapshot('snapshot-plex-absent', {
			destination: 'server',
			kind: 'poster',
			state: 'absent'
		});
		const snapshots = snapshotHarness([{ row: desired }]);
		const server = serverHarness({ type: 'plex', current, deleteSupported: false });
		const plan = builtPlan([
			candidate({
				revisionId: 'revision-plex-absent',
				beforeSnapshotId: desired.id,
				current: {
					state: 'present',
					fingerprint: sha256Bytes(current.data),
					artworkVersion: 3
				},
				snapshot: { state: 'absent', fingerprint: null, restorable: true }
			})
		]);
		const harness = executorHarness({ server: server.server, snapshots });

		const result = await execute(harness.executor, plan);

		expect(result.operations[0]).toMatchObject({
			status: 'failed',
			verification: 'failed',
			errorCode: 'undo_server_delete_unsupported',
			artworkVersion: 5
		});
		expect(server.deleteArtwork).not.toHaveBeenCalled();
		expect(harness.ledger.records[0]).toMatchObject({
			outcome: 'failed',
			slotState: { advanceArtworkVersion: false }
		});
	});

	it('skips an unavailable prior snapshot without attempting a mutation', async () => {
		const current = artwork([1], 'current');
		const desired = snapshot('snapshot-unavailable', {
			destination: 'server',
			kind: 'poster',
			state: 'unavailable'
		});
		const snapshots = snapshotHarness([{ row: desired }]);
		const server = serverHarness({ current });
		const plan = builtPlan([
			candidate({
				revisionId: 'revision-unavailable',
				beforeSnapshotId: desired.id,
				current: {
					state: 'present',
					fingerprint: sha256Bytes(current.data),
					artworkVersion: 4
				},
				snapshot: { state: 'unavailable', fingerprint: null, restorable: false }
			})
		]);
		const harness = executorHarness({ server: server.server, snapshots });

		const result = await execute(harness.executor, plan);

		expect(result.operations[0]).toMatchObject({
			status: 'skipped',
			verification: 'unavailable',
			errorCode: 'undo_snapshot_unavailable'
		});
		expect(server.applyPosterBytes).not.toHaveBeenCalled();
	});
});

describe('Kometa undo execution', () => {
	it.each([
		{
			label: 'present value',
			restore: { state: 'present', url: 'https://images.invalid/original.jpg' } as const,
			snapshotState: 'present' as const
		},
		{
			label: 'absent value',
			restore: { state: 'absent', url: null } as const,
			snapshotState: 'absent' as const
		}
	])('restores a $label while preserving comments and sibling entries', async (testCase) => {
		const current: KometaSlotSnapshotValue = {
			state: 'present',
			url: 'https://images.invalid/current.jpg'
		};
		const desired = snapshot(`snapshot-kometa-${testCase.snapshotState}`, {
			destination: 'kometa',
			kind: 'poster',
			state: testCase.snapshotState,
			value: testCase.snapshotState === 'present' ? testCase.restore : null,
			metadata: { tmdbId: '100' }
		});
		const snapshots = snapshotHarness([{ row: desired }]);
		const server = serverHarness({ current: artwork([1]) });
		const kometa = defaultKometa();
		kometa.setRaw(
			'# keep this comment\nmetadata:\n  100:\n    title: Keep title\n    url_poster: https://images.invalid/current.jpg\n  200:\n    url_poster: https://images.invalid/sibling.jpg\n'
		);
		const plan = builtPlan([
			candidate({
				revisionId: `revision-kometa-${testCase.snapshotState}`,
				destination: 'kometa',
				targetId: 'kometa:100',
				beforeSnapshotId: desired.id,
				current: {
					state: 'present',
					fingerprint: kometaSlotFingerprint(current),
					artworkVersion: null
				},
				snapshot:
					testCase.snapshotState === 'present'
						? {
								state: 'present',
								fingerprint: kometaSlotFingerprint(testCase.restore),
								restorable: true
							}
						: { state: 'absent', fingerprint: null, restorable: true }
			})
		]);
		const harness = executorHarness({ server: server.server, snapshots, kometa });

		const result = await execute(harness.executor, plan);

		expect(result.operations[0]).toMatchObject({ status: 'success', verification: 'exact' });
		expect(readKometaSlot(kometa.getRaw(), '100', ROOT_POSTER)).toEqual(testCase.restore);
		expect(readKometaSlot(kometa.getRaw(), '200', ROOT_POSTER)).toEqual({
			state: 'present',
			url: 'https://images.invalid/sibling.jpg'
		});
		expect(kometa.getRaw()).toContain('# keep this comment');
		expect(kometa.getRaw()).toContain('title: Keep title');
		expect(harness.ledger.records[0]).toMatchObject({
			action: 'undo',
			destination: 'kometa',
			outcome: 'success',
			verification: 'exact'
		});
	});
});

describe('isolated failures and plan safety', () => {
	it('continues independent operations and finalizes a partial group', async () => {
		const current = artwork([1], 'before');
		const posterBytes = Uint8Array.from([2]);
		const backgroundBytes = Uint8Array.from([3]);
		const posterSnapshot = snapshot('snapshot-partial-poster', {
			destination: 'server',
			kind: 'poster',
			state: 'present',
			sha256: sha256Bytes(posterBytes),
			storagePath: '/private/poster'
		});
		const backgroundSnapshot = snapshot('snapshot-partial-background', {
			destination: 'server',
			kind: 'background',
			state: 'present',
			sha256: sha256Bytes(backgroundBytes),
			storagePath: '/private/background'
		});
		const snapshots = snapshotHarness([
			{ row: posterSnapshot, bytes: posterBytes },
			{ row: backgroundSnapshot, bytes: backgroundBytes }
		]);
		const server = serverHarness({ current, backgroundFails: true });
		const frozenCurrent = {
			state: 'present' as const,
			fingerprint: sha256Bytes(current.data),
			artworkVersion: 5
		};
		const plan = builtPlan([
			candidate({
				revisionId: 'revision-partial-poster',
				beforeSnapshotId: posterSnapshot.id,
				current: frozenCurrent,
				snapshot: {
					state: 'present',
					fingerprint: sha256Bytes(posterBytes),
					restorable: true
				}
			}),
			candidate({
				revisionId: 'revision-partial-background',
				beforeSnapshotId: backgroundSnapshot.id,
				slot: ROOT_BACKGROUND,
				current: {
					state: 'present',
					fingerprint: sha256Bytes(posterBytes),
					artworkVersion: 5
				},
				snapshot: {
					state: 'present',
					fingerprint: sha256Bytes(backgroundBytes),
					restorable: true
				}
			})
		]);
		const harness = executorHarness({ server: server.server, snapshots });

		const result = await execute(harness.executor, plan);

		expect(result.status).toBe('partial');
		expect(result.summary).toEqual({ total: 2, succeeded: 1, failed: 1, skipped: 0 });
		expect(result.operations.map((operation) => operation.status)).toEqual(['success', 'failed']);
		expect(server.applyPosterBytes).toHaveBeenCalledTimes(1);
		expect(server.applyBackgroundBytes).toHaveBeenCalledTimes(1);
		expect(harness.ledger.records).toHaveLength(2);
		expect(harness.ledger.finalizeGroup).toHaveBeenCalledTimes(1);
	});

	it('rejects a stale operation before writing and records the observed state without version advance', async () => {
		const previewCurrent = artwork([1], 'preview');
		const liveCurrent = artwork([2], 'changed-externally');
		const restoreBytes = Uint8Array.from([9]);
		const desired = snapshot('snapshot-stale', {
			destination: 'server',
			kind: 'poster',
			state: 'present',
			sha256: sha256Bytes(restoreBytes),
			storagePath: '/private/stale'
		});
		const snapshots = snapshotHarness([{ row: desired, bytes: restoreBytes }]);
		const server = serverHarness({ current: liveCurrent });
		const plan = builtPlan([
			candidate({
				revisionId: 'revision-stale',
				beforeSnapshotId: desired.id,
				current: {
					state: 'present',
					fingerprint: sha256Bytes(previewCurrent.data),
					artworkVersion: 8
				},
				snapshot: {
					state: 'present',
					fingerprint: sha256Bytes(restoreBytes),
					restorable: true
				}
			})
		]);
		const harness = executorHarness({ server: server.server, snapshots });

		const result = await execute(harness.executor, plan);

		expect(result.operations[0]).toMatchObject({
			status: 'failed',
			verification: 'mismatch',
			errorCode: 'undo_stale_destination'
		});
		expect(server.applyPosterBytes).not.toHaveBeenCalled();
		expect(harness.ledger.records[0]).toMatchObject({
			outcome: 'failed',
			slotState: { advanceArtworkVersion: false }
		});
	});

	it('records an unavailable named server and never redirects to another provider', async () => {
		const restoreBytes = Uint8Array.from([9]);
		const desired = snapshot('snapshot-server-unavailable', {
			destination: 'server',
			kind: 'poster',
			state: 'present',
			sha256: sha256Bytes(restoreBytes),
			storagePath: '/private/unavailable'
		});
		const snapshots = snapshotHarness([{ row: desired, bytes: restoreBytes }]);
		const plan = builtPlan([
			candidate({
				revisionId: 'revision-server-unavailable',
				beforeSnapshotId: desired.id,
				current: {
					state: 'present',
					fingerprint: 'a'.repeat(64),
					artworkVersion: 2
				},
				snapshot: {
					state: 'present',
					fingerprint: sha256Bytes(restoreBytes),
					restorable: true
				}
			})
		]);
		const harness = executorHarness({ snapshots, serverUnavailable: true });

		const result = await execute(harness.executor, plan);

		expect(result.operations[0]).toMatchObject({
			status: 'failed',
			verification: 'unavailable',
			errorCode: 'undo_server_unavailable'
		});
		expect(harness.ledger.records[0]).toMatchObject({
			errorCode: 'undo_server_unavailable',
			error: 'The selected media server is unavailable.'
		});
	});

	it('rejects a digest mismatch before resolving a server or creating a ledger group', async () => {
		const restoreBytes = Uint8Array.from([9]);
		const current = artwork([1]);
		const desired = snapshot('snapshot-digest', {
			destination: 'server',
			kind: 'poster',
			state: 'present',
			sha256: sha256Bytes(restoreBytes),
			storagePath: '/private/digest'
		});
		const snapshots = snapshotHarness([{ row: desired, bytes: restoreBytes }]);
		const server = serverHarness({ current });
		const plan = builtPlan([
			candidate({
				revisionId: 'revision-digest',
				beforeSnapshotId: desired.id,
				current: {
					state: 'present',
					fingerprint: sha256Bytes(current.data),
					artworkVersion: 1
				},
				snapshot: {
					state: 'present',
					fingerprint: sha256Bytes(restoreBytes),
					restorable: true
				}
			})
		]);
		const harness = executorHarness({ server: server.server, snapshots });
		const badDigest = canonicalJsonDigest({ different: true }).digest;

		await expect(execute(harness.executor, plan, badDigest)).rejects.toEqual(
			expect.objectContaining<Partial<ArtworkUndoExecutionError>>({
				code: 'undo_plan_digest_mismatch'
			})
		);
		expect(harness.ledger.createGroup).not.toHaveBeenCalled();
		expect(server.applyPosterBytes).not.toHaveBeenCalled();
	});
});
