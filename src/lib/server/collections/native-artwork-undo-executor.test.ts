import { describe, expect, it, vi } from 'vitest';
import type { ArtworkSnapshot } from '$lib/server/db/schema';
import type { MediaServer, ServerArtwork } from '$lib/server/media-server';
import { createArtworkUndoExecutor } from '$lib/server/artwork-revisions/undo-executor';
import { buildUndoPlan, type UndoPlanCandidate } from '$lib/server/artwork-revisions/undo-plan';
import { sha256Bytes } from '$lib/server/revisions/verification';

const NOW = new Date('2026-07-11T12:00:00.000Z');

function buffer(...values: number[]): ArrayBuffer {
	return Uint8Array.from(values).buffer;
}

function artwork(kind: 'poster' | 'background', values: number[]): ServerArtwork {
	return {
		kind,
		url: `https://media.safe/${kind}?X-Plex-Token=must-not-persist`,
		identity: `${kind}:${values.join('-')}`,
		data: buffer(...values),
		contentType: 'image/jpeg'
	};
}

function snapshot(id: string, kind: 'poster' | 'background', values: number[]): ArtworkSnapshot {
	return {
		id,
		serverInstanceId: 'server-a',
		mediaItemId: null,
		mediaCollectionId: 'collection-a',
		destination: 'server',
		kind,
		season: null,
		episode: null,
		state: 'present',
		sha256: sha256Bytes(buffer(...values)),
		storagePath: `/private/${id}`,
		contentType: 'image/jpeg',
		sizeBytes: values.length,
		value: null,
		metadata: null,
		isOriginal: false,
		retainedUntil: null,
		createdAt: NOW
	};
}

function candidate(input: {
	revisionId: string;
	kind: 'poster' | 'background';
	current: ServerArtwork;
	desired: ArtworkSnapshot;
}): UndoPlanCandidate {
	return {
		revisionId: input.revisionId,
		revisionGroupId: 'apply-group',
		revisionCreatedAt: '2026-07-11T11:00:00.000Z',
		serverInstanceId: 'server-a',
		target: { kind: 'collection', mediaCollectionId: 'collection-a' },
		destination: 'server',
		targetId: 'native-77',
		slot: { kind: input.kind, season: null, episode: null },
		beforeSnapshotId: input.desired.id,
		current: {
			state: 'present',
			fingerprint: sha256Bytes(input.current.data),
			artworkVersion: 4
		},
		snapshot: {
			state: 'present',
			fingerprint: input.desired.sha256!,
			restorable: true
		}
	};
}

function harness(options: { backgroundFails?: boolean } = {}) {
	const current: Record<'poster' | 'background', ServerArtwork> = {
		poster: artwork('poster', [1, 1]),
		background: artwork('background', [2, 2])
	};
	const desiredPoster = snapshot('desired-poster', 'poster', [9, 9]);
	const desiredBackground = snapshot('desired-background', 'background', [8, 8]);
	const desired = new Map([
		[desiredPoster.id, desiredPoster],
		[desiredBackground.id, desiredBackground]
	]);
	const desiredBytes = new Map([
		[desiredPoster.id, Buffer.from([9, 9])],
		[desiredBackground.id, Buffer.from([8, 8])]
	]);
	const records: Array<Record<string, unknown>> = [];
	let captureId = 0;
	const applyCollectionPosterBytes = vi.fn(async (_id: string, data: ArrayBuffer) => {
		current.poster = artwork('poster', [...new Uint8Array(data)]);
	});
	const applyCollectionBackgroundBytes = vi.fn(async (_id: string, data: ArrayBuffer) => {
		if (options.backgroundFails) throw new Error('api_key=secret');
		current.background = artwork('background', [...new Uint8Array(data)]);
	});
	const server: MediaServer = {
		type: 'plex',
		identity: { instanceId: 'server-a', name: 'Primary', type: 'plex' },
		capabilities: {
			posterWrite: 'supported',
			backgroundWrite: 'supported',
			seasonWrite: 'supported',
			episodeWrite: 'supported',
			fieldLock: 'supported',
			currentImageRetrieval: 'supported',
			artworkDelete: 'supported',
			collectionArtwork: 'supported',
			evidence: 'provider_contract',
			limitations: []
		},
		testConnection: vi.fn(),
		listLibraries: vi.fn(),
		listItems: vi.fn(),
		listSeasons: vi.fn(),
		listEpisodes: vi.fn(),
		applyPosterUrl: vi.fn(),
		applyPosterBytes: vi.fn(),
		lockField: vi.fn(),
		readCollectionArtwork: vi.fn(
			async (_id: string, kind: 'poster' | 'background') => current[kind]
		),
		applyCollectionPosterBytes,
		applyCollectionBackgroundBytes
	};
	const executor = createArtworkUndoExecutor({
		serverRegistry: {
			resolve: vi.fn(async () => ({
				serverInstanceId: 'server-a',
				server,
				fingerprint: 'a'.repeat(64)
			}))
		},
		snapshots: {
			get: vi.fn(async (id) => desired.get(id) ?? null),
			readBytes: vi.fn(async (row) => desiredBytes.get(row.id) ?? Buffer.alloc(0)),
			captureServer: vi.fn(async (input) => ({
				id: `captured-${++captureId}`,
				serverInstanceId: input.serverInstanceId,
				mediaItemId: null,
				mediaCollectionId: input.mediaCollectionId ?? null,
				destination: 'server' as const,
				kind: input.slot.kind,
				season: null,
				episode: null,
				state: input.artwork
					? ('present' as const)
					: input.artwork === null
						? ('absent' as const)
						: ('unavailable' as const),
				sha256: input.artwork ? sha256Bytes(input.artwork.data) : null,
				storagePath: input.artwork ? '/private/captured' : null,
				contentType: input.artwork?.contentType ?? null,
				sizeBytes: input.artwork?.data.byteLength ?? null,
				value: null,
				metadata: null,
				isOriginal: false,
				retainedUntil: null,
				createdAt: NOW
			})),
			captureValue: vi.fn()
		},
		ledger: {
			createGroup: vi.fn(async () => ({ id: 'undo-group' }) as never),
			recordOutcome: vi.fn(async (input) => {
				records.push(input as unknown as Record<string, unknown>);
				return {
					revision: {} as never,
					currentSlotState: input.slotState ? ({ artworkVersion: 5 } as never) : null
				};
			}),
			finalizeGroup: vi.fn(async () => {
				const successes = records.filter((record) => record.outcome === 'success').length;
				return {
					outcome: successes === records.length ? 'success' : successes === 0 ? 'failed' : 'partial'
				} as never;
			})
		},
		readKometa: vi.fn(async () => undefined),
		mutateKometa: vi.fn(),
		clock: () => NOW
	});
	return {
		executor,
		current,
		desiredPoster,
		desiredBackground,
		records,
		applyCollectionPosterBytes,
		applyCollectionBackgroundBytes
	};
}

describe('native collection revision undo', () => {
	it('restores exact native collection bytes and records a credential-free collection revision', async () => {
		const test = harness();
		const built = buildUndoPlan({
			plannedAt: NOW.toISOString(),
			scope: {
				kind: 'revision',
				serverInstanceId: 'server-a',
				revisionId: 'revision-poster'
			},
			operations: [
				candidate({
					revisionId: 'revision-poster',
					kind: 'poster',
					current: test.current.poster,
					desired: test.desiredPoster
				})
			]
		});
		const result = await test.executor({
			planId: 'undo-plan',
			digest: built.digest,
			payload: built.payload
		});
		expect(result.status).toBe('success');
		expect(test.applyCollectionPosterBytes).toHaveBeenCalledWith(
			'native-77',
			expect.any(ArrayBuffer),
			'image/jpeg'
		);
		expect([...new Uint8Array(test.current.poster.data)]).toEqual([9, 9]);
		expect(test.records[0]).toMatchObject({
			mediaItemId: null,
			mediaCollectionId: 'collection-a',
			undoOfRevisionId: 'revision-poster',
			outcome: 'success',
			verification: 'exact',
			slotState: { currentUrl: 'https://media.safe/poster', advanceArtworkVersion: true }
		});
		expect(JSON.stringify(test.records)).not.toContain('must-not-persist');
	});

	it('continues the second native slot and reports a partial undo when one write fails', async () => {
		const test = harness({ backgroundFails: true });
		const built = buildUndoPlan({
			plannedAt: NOW.toISOString(),
			scope: {
				kind: 'group',
				serverInstanceId: 'server-a',
				revisionGroupId: 'apply-group'
			},
			operations: [
				candidate({
					revisionId: 'revision-background',
					kind: 'background',
					current: test.current.background,
					desired: test.desiredBackground
				}),
				candidate({
					revisionId: 'revision-poster',
					kind: 'poster',
					current: test.current.poster,
					desired: test.desiredPoster
				})
			]
		});
		const result = await test.executor({
			planId: 'undo-plan',
			digest: built.digest,
			payload: built.payload
		});
		expect(result.status).toBe('partial');
		expect(result.summary).toEqual({ total: 2, succeeded: 1, failed: 1, skipped: 0 });
		expect(test.applyCollectionBackgroundBytes).toHaveBeenCalledTimes(1);
		expect(test.applyCollectionPosterBytes).toHaveBeenCalledTimes(1);
		expect(test.records).toHaveLength(2);
		expect(test.records.every((record) => record.mediaCollectionId === 'collection-a')).toBe(true);
	});

	it('rejects a stale native destination before restoring snapshot bytes', async () => {
		const test = harness();
		const built = buildUndoPlan({
			plannedAt: NOW.toISOString(),
			scope: {
				kind: 'revision',
				serverInstanceId: 'server-a',
				revisionId: 'revision-poster'
			},
			operations: [
				candidate({
					revisionId: 'revision-poster',
					kind: 'poster',
					current: artwork('poster', [7, 7]),
					desired: test.desiredPoster
				})
			]
		});
		const result = await test.executor({
			planId: 'undo-plan',
			digest: built.digest,
			payload: built.payload
		});
		expect(result.operations[0]).toMatchObject({
			status: 'failed',
			verification: 'mismatch',
			errorCode: 'undo_stale_destination'
		});
		expect(test.applyCollectionPosterBytes).not.toHaveBeenCalled();
	});
});
