import { describe, expect, it, vi } from 'vitest';

// The flow uses a purpose-built lifecycle store; keep this pure test `$env`-free.
vi.mock('$lib/server/db', () => ({ db: {} }));
import { DEFAULT_SCORE_WEIGHTS } from '$lib/server/posters/score';
import { selectAutomaticArtwork } from '$lib/server/posters/automatic-selection';
import {
	RemoteArtworkDownloadError,
	type RemoteArtworkDownloadErrorCode
} from '$lib/server/remote-artwork';
import { canonicalJsonDigest, hashCanonicalJson } from './canonical-json';
import { confirmApplyPlan, exactApplyPreviewResponse } from './apply-api';
import { executeFrozenApplyPlan, type ApplyPlanExecutorDependencies } from './apply-executor';
import {
	applySlotKey,
	type ApplyPlanDestination,
	type ApplyPlanPayloadV1,
	type ApplySlot,
	type FrozenApplyJobPayload
} from './apply-plan';
import {
	createApplyPlanner,
	type ApplyItemRef,
	type ApplyPlannerDependencies,
	type ApplyPlannerItemData,
	type PlannerCandidateSnapshot
} from './apply-planner';
import { assertApplyPlanFresh, assertApplyPlanPayload } from './apply-plan-validation';
import {
	OperationPlanError,
	type CreateOperationPlanInput,
	type OperationPlan,
	type OperationPlanExpectations
} from './operation-plan-store';
import { resolveKometaDestination } from '$lib/server/kometa/destination';

const NOW = new Date('2026-07-10T12:00:00.000Z');

function data(mediaItemId: number): ApplyPlannerItemData {
	const identity = {
		serverInstanceId: 'server-a',
		mediaItemId,
		librarySectionKey: 'movies',
		sourceId: `source-${mediaItemId}`,
		type: 'movie' as const,
		tmdbId: String(mediaItemId),
		imdbId: null,
		tvdbId: null,
		mediaType: 'movie' as const,
		updatedAt: '2026-07-10T11:00:00.000Z',
		selectionUpdatedAt: '2026-07-10T11:01:00.000Z',
		selectionRevision: 1
	};
	const candidate = (id: number, slot: ApplySlot): PlannerCandidateSnapshot => ({
		candidateId: id,
		serverInstanceId: identity.serverInstanceId,
		mediaItemId,
		discoveryRunId: `run-${mediaItemId}`,
		provider: 'mediux',
		providerAssetId: `asset-${id}`,
		setId: `set-${mediaItemId}`,
		setAuthor: 'author',
		designFamily: 'family',
		language: 'en',
		url: `https://art.example/${id}.jpg`,
		slot,
		resolvedTmdbId: identity.tmdbId,
		resolvedMediaType: 'movie',
		width: slot.kind === 'poster' ? 1000 : 1920,
		height: slot.kind === 'poster' ? 1500 : 1080,
		score: 1,
		active: true,
		stale: false,
		lastSeenAt: '2026-07-10T10:00:00.000Z'
	});
	return {
		item: {
			identity,
			ignored: false,
			sourceRemoved: false,
			discovery: {
				status: 'succeeded',
				runId: `run-${mediaItemId}`,
				completedAt: '2026-07-10T10:30:00.000Z'
			},
			currentSlots: [
				{
					slot: { kind: 'poster', season: null, episode: null },
					url: `https://current.example/${mediaItemId}.jpg?X-Plex-Token=server-secret`,
					fingerprint: `current-${mediaItemId}`,
					artworkVersion: 2,
					observedAt: '2026-07-10T09:00:00.000Z'
				},
				{
					slot: { kind: 'background', season: null, episode: null },
					url: null,
					fingerprint: null,
					artworkVersion: 2,
					observedAt: '2026-07-10T09:00:00.000Z'
				}
			]
		},
		candidates: [
			candidate(mediaItemId * 10 + 1, { kind: 'poster', season: null, episode: null }),
			candidate(mediaItemId * 10 + 2, { kind: 'background', season: null, episode: null })
		],
		storedSelections: []
	};
}

function testStore() {
	let current: OperationPlan<ApplyPlanPayloadV1> | null = null;
	let consumed = false;
	const check = (id: string, expected: OperationPlanExpectations = {}) => {
		if (!current || current.id !== id) throw new OperationPlanError('plan_not_found', id);
		if (consumed) throw new OperationPlanError('plan_consumed', id);
		if (expected.kind && expected.kind !== current.kind) {
			throw new OperationPlanError('plan_kind_mismatch', id);
		}
		if (expected.digest && expected.digest !== current.digest) {
			throw new OperationPlanError('plan_digest_mismatch', id);
		}
		if (
			Object.hasOwn(expected, 'serverInstanceId') &&
			expected.serverInstanceId !== current.serverInstanceId
		) {
			throw new OperationPlanError('plan_scope_mismatch', id);
		}
		return current;
	};
	return {
		async create(input: CreateOperationPlanInput<ApplyPlanPayloadV1>) {
			const payload = structuredClone(input.payload);
			current = {
				id: 'plan-1',
				kind: input.kind,
				serverInstanceId: input.serverInstanceId ?? null,
				librarySectionKey: input.librarySectionKey ?? null,
				payload,
				digest: canonicalJsonDigest(payload).digest,
				createdAt: NOW,
				expiresAt: new Date(NOW.getTime() + 60_000),
				consumedAt: null
			};
			return current;
		},
		async validate<T>(id: string, expected?: OperationPlanExpectations) {
			return check(id, expected) as OperationPlan<T>;
		},
		async consume<T>(id: string, expected?: OperationPlanExpectations) {
			const plan = check(id, expected);
			consumed = true;
			return { ...plan, consumedAt: NOW } as OperationPlan<T>;
		}
	};
}

function setup() {
	const items = [data(1), data(2)];
	const kometaFileFingerprints = { movie: 'movie-file-v1', show: 'show-file-v1' };
	const byRef = new Map(items.map((item) => [`server-a:${item.item.identity.mediaItemId}`, item]));
	const store = testStore();
	const loadItemData = async (ref: ApplyItemRef) =>
		byRef.get(`${ref.serverInstanceId}:${ref.mediaItemId}`) ?? null;
	const resolveDestinationSlots: ApplyPlannerDependencies['resolveDestinationSlots'] = async ({
		target,
		selections,
		destinations
	}) =>
		selections.flatMap((selection) =>
			destinations.map((destination: ApplyPlanDestination) => {
				const current = target.item.currentSlots.find(
					(state) => applySlotKey(state.slot) === applySlotKey(selection.slot)
				);
				const kometa =
					destination === 'kometa'
						? resolveKometaDestination({
								type: target.item.identity.type,
								tmdbId: target.item.identity.tmdbId,
								tvdbId: target.item.identity.tvdbId,
								imdbId: target.item.identity.imdbId
							})
						: null;
				return {
					destination,
					...(kometa?.ok
						? {
								kometaDestination: kometa.destination,
								kometaFileFingerprint: hashCanonicalJson({
									exists: true,
									content: kometaFileFingerprints[target.item.identity.type]
								})
							}
						: {}),
					slot: selection.slot,
					targetId:
						destination === 'server'
							? `${destination}-${target.item.identity.mediaItemId}-${applySlotKey(selection.slot)}`
							: kometa?.ok
								? kometa.destination.key
								: null,
					capability: 'supported' as const,
					current: {
						url: current?.url ?? null,
						fingerprint: current?.fingerprint ?? null,
						artworkVersion: current?.artworkVersion ?? null,
						observedAt: current?.observedAt ?? null,
						destinationFingerprint:
							destination === 'kometa'
								? `kometa-state-${target.item.identity.mediaItemId}-${kometaFileFingerprints[target.item.identity.type]}`
								: `server-state-${target.item.identity.mediaItemId}`
					},
					skipCode:
						destination === 'kometa' && !kometa?.ok ? ('missing_kometa_identifier' as const) : null,
					parameters: {}
				};
			})
		);
	const planner = createApplyPlanner({
		loadItemData,
		loadDefaults: async () => ({
			defaultMethod: 'both',
			providerPriority: ['mediux'],
			scoreWeights: DEFAULT_SCORE_WEIGHTS
		}),
		selectAutomatic: async (ref, inputs) => {
			const item = (await loadItemData(ref))!;
			return selectAutomaticArtwork(
				item.candidates.map((candidate) => ({
					id: candidate.candidateId,
					provider: candidate.provider,
					setId: candidate.setId,
					setAuthor: candidate.setAuthor,
					url: candidate.url,
					kind: candidate.slot.kind,
					season: candidate.slot.season,
					episode: candidate.slot.episode,
					width: candidate.width,
					height: candidate.height
				})),
				inputs
			);
		},
		resolveDestinationSlots,
		persistPlan: (input) => store.create(input),
		clock: () => NOW
	});
	return {
		items,
		planner,
		store,
		loadItemData,
		resolveDestinationSlots,
		kometaFileFingerprints
	};
}

function asLegacyRevisionlessPlan(payload: ApplyPlanPayloadV1): ApplyPlanPayloadV1 {
	const legacy = structuredClone(payload);
	if (legacy.context.source === 'cross_server') {
		Reflect.deleteProperty(legacy.context.sourceItem, 'selectionRevision');
	}
	for (const item of legacy.items) {
		Reflect.deleteProperty(item.target, 'selectionRevision');
		Reflect.deleteProperty(item.selectionFrom, 'selectionRevision');
		for (const operation of item.operations) {
			Reflect.deleteProperty(operation.target, 'selectionRevision');
		}
		item.selectionFingerprint = hashCanonicalJson({
			selectionUpdatedAt: item.selectionFrom.selectionUpdatedAt,
			discoveryFingerprint: item.discovery.fingerprint,
			selections: item.selections
		});
		item.sourceFingerprint = hashCanonicalJson({
			target: item.target,
			selectionFrom: item.selectionFrom,
			selectionFingerprint: item.selectionFingerprint,
			currentStateFingerprint: item.currentStateFingerprint,
			operations: item.operations.map((operation) => operation.id),
			skips: item.skips
		});
	}
	legacy.sourceFingerprint = hashCanonicalJson({
		context: legacy.context,
		defaults: legacy.defaults,
		items: legacy.items.map((item) => item.sourceFingerprint)
	});
	return legacy;
}

function rehashApplyPlanSources(payload: ApplyPlanPayloadV1): void {
	for (const item of payload.items) {
		item.sourceFingerprint = hashCanonicalJson({
			target: item.target,
			selectionFrom: item.selectionFrom,
			selectionFingerprint: item.selectionFingerprint,
			currentStateFingerprint: item.currentStateFingerprint,
			operations: item.operations.map((operation) => operation.id),
			skips: item.skips
		});
	}
	payload.sourceFingerprint = hashCanonicalJson({
		context: payload.context,
		defaults: payload.defaults,
		items: payload.items.map((item) => item.sourceFingerprint)
	});
}

describe('frozen apply flow', () => {
	it('accepts a revisionless v1 payload only while the migrated selection revision is zero', async () => {
		const fixture = setup();
		fixture.items[0].item.identity.selectionRevision = 0;
		const preview = await fixture.planner({
			context: { source: 'single' },
			targets: [{ serverInstanceId: 'server-a', mediaItemId: 1 }],
			selectionMode: 'auto',
			method: 'server'
		});
		const legacy = asLegacyRevisionlessPlan(preview.payload);

		expect(() => assertApplyPlanPayload(legacy)).not.toThrow();
		await expect(
			assertApplyPlanFresh(legacy, {
				loadItemData: fixture.loadItemData,
				resolveDestinationSlots: fixture.resolveDestinationSlots
			})
		).resolves.toBeUndefined();

		fixture.items[0].item.identity.selectionRevision = 1;
		await expect(
			assertApplyPlanFresh(legacy, {
				loadItemData: fixture.loadItemData,
				resolveDestinationSlots: fixture.resolveDestinationSlots
			})
		).rejects.toMatchObject({ code: 'plan_stale' });
	});

	it('rejects a durable v1 Kometa mutation without a typed destination', async () => {
		const fixture = setup();
		const preview = await fixture.planner({
			context: { source: 'single' },
			targets: [{ serverInstanceId: 'server-a', mediaItemId: 1 }],
			selectionMode: 'auto',
			method: 'kometa'
		});
		const unsafeLegacy = structuredClone(preview.payload);
		for (const item of unsafeLegacy.items) {
			for (const snapshot of item.destinationSlots) {
				Reflect.deleteProperty(snapshot, 'kometaDestination');
				Reflect.deleteProperty(snapshot, 'kometaFileFingerprint');
			}
			for (const operation of item.operations) {
				Reflect.deleteProperty(operation, 'kometaDestination');
				Reflect.deleteProperty(operation, 'kometaFileFingerprint');
			}
		}

		expect(() => assertApplyPlanPayload(unsafeLegacy)).toThrowError(
			expect.objectContaining({ code: 'invalid_plan' })
		);
	});

	it('keeps a durable v1 untyped Kometa snapshot readable when it cannot mutate', async () => {
		const fixture = setup();
		const preview = await fixture.planner({
			context: { source: 'single' },
			targets: [{ serverInstanceId: 'server-a', mediaItemId: 1 }],
			selectionMode: 'auto',
			method: 'both'
		});
		const durableV1 = structuredClone(preview.payload);
		for (const item of durableV1.items) {
			item.operations = item.operations.filter((operation) => operation.destination === 'server');
			for (const snapshot of item.destinationSlots) {
				if (snapshot.destination !== 'kometa') continue;
				Reflect.deleteProperty(snapshot, 'kometaDestination');
				Reflect.deleteProperty(snapshot, 'kometaFileFingerprint');
				snapshot.targetId = '1';
				snapshot.capability = 'unsupported';
				snapshot.skipCode = 'unsupported_slot';
				item.skips.push({
					destination: 'kometa',
					slot: snapshot.slot,
					code: 'unsupported_slot',
					parameters: {}
				});
			}
			item.currentStateFingerprint = hashCanonicalJson({
				targetUpdatedAt: item.target.updatedAt,
				destinationSlots: item.destinationSlots.map((snapshot) => ({
					destination: snapshot.destination,
					slot: snapshot.slot,
					targetId: snapshot.targetId,
					capability: snapshot.capability,
					current: snapshot.current,
					skipCode: snapshot.skipCode
				}))
			});
		}
		durableV1.summary = {
			itemCount: durableV1.items.length,
			actionableItemCount: durableV1.items.filter((item) => item.operations.length > 0).length,
			operationCount: durableV1.items.flatMap((item) => item.operations).length,
			skipCount: durableV1.items.flatMap((item) => item.skips).length,
			destinations: {
				server: durableV1.items
					.flatMap((item) => item.operations)
					.filter((operation) => operation.destination === 'server').length,
				kometa: 0
			}
		};
		rehashApplyPlanSources(durableV1);

		expect(() => assertApplyPlanPayload(durableV1)).not.toThrow();
	});

	it('stales only when the exact typed Kometa file fingerprint changes', async () => {
		const fixture = setup();
		const preview = await fixture.planner({
			context: { source: 'single' },
			targets: [{ serverInstanceId: 'server-a', mediaItemId: 1 }],
			selectionMode: 'auto',
			method: 'kometa'
		});

		fixture.kometaFileFingerprints.show = 'show-file-v2';
		await expect(
			assertApplyPlanFresh(preview.payload, {
				loadItemData: fixture.loadItemData,
				resolveDestinationSlots: fixture.resolveDestinationSlots
			})
		).resolves.toBeUndefined();

		fixture.kometaFileFingerprints.movie = 'movie-file-v2';
		await expect(
			assertApplyPlanFresh(preview.payload, {
				loadItemData: fixture.loadItemData,
				resolveDestinationSlots: fixture.resolveDestinationSlots
			})
		).rejects.toMatchObject({ code: 'plan_stale' });
	});

	it('executes exactly the per-item/per-slot operations returned by preview', async () => {
		const fixture = setup();
		fixture.items[0].candidates[0].provider = 'tmdb';
		fixture.items[0].candidates[0].url = 'https://image.tmdb.org/t/p/w500/flow-poster.jpg';
		fixture.items[0].candidates[1].provider = 'tmdb';
		fixture.items[0].candidates[1].url = 'https://image.tmdb.org/t/p/w1280/flow-background.jpg';
		const preview = await fixture.planner({
			context: { source: 'bulk', resultSetFingerprint: 'result-set-a' },
			targets: [
				{ serverInstanceId: 'server-a', mediaItemId: 1 },
				{ serverInstanceId: 'server-a', mediaItemId: 2 }
			],
			selectionMode: 'auto',
			method: 'both'
		});
		const response = exactApplyPreviewResponse(preview);
		expect(response.planId).toBe('plan-1');
		expect(JSON.stringify(response)).not.toContain('server-secret');
		expect(response.summary).toMatchObject({
			itemCount: 2,
			operationCount: 8,
			destinations: { server: 4, kometa: 4 }
		});

		let queued: FrozenApplyJobPayload | null = null;
		await confirmApplyPlan(
			{ planId: response.planId!, digest: response.digest!, serverInstanceId: 'server-a' },
			{
				store: fixture.store,
				loadItemData: fixture.loadItemData,
				resolveDestinationSlots: fixture.resolveDestinationSlots,
				enqueue: async (payload) => {
					queued = payload;
					return 42;
				}
			}
		);
		expect(queued).not.toBeNull();

		const applyPosterUrl = vi.fn(async () => undefined);
		const applyBackgroundUrl = vi.fn(async () => undefined);
		const writeKometa = vi.fn<ApplyPlanExecutorDependencies['writeKometa']>(async () => undefined);
		const result = await executeFrozenApplyPlan(queued!.planId, queued!.digest, queued!.plan, {
			serverRegistry: {
				resolve: async () => ({
					serverInstanceId: 'server-a',
					fingerprint: 'server-fingerprint',
					server: {
						type: 'plex',
						identity: { instanceId: 'server-a', name: 'Server A', type: 'plex' },
						capabilities: {
							posterWrite: 'supported',
							backgroundWrite: 'supported',
							seasonWrite: 'supported',
							episodeWrite: 'supported',
							fieldLock: 'supported',
							currentImageRetrieval: 'supported',
							artworkDelete: 'unsupported',
							evidence: 'provider_contract',
							limitations: ['artwork_delete_unavailable']
						},
						testConnection: vi.fn(),
						listLibraries: vi.fn(),
						listItems: vi.fn(),
						listSeasons: vi.fn(),
						listEpisodes: vi.fn(),
						applyPosterUrl,
						applyPosterBytes: vi.fn(),
						applyBackgroundUrl,
						lockField: vi.fn()
					}
				})
			},
			writeKometa
		});

		const planned = response.items.flatMap((item) => item.operations);
		expect(
			planned
				.filter((operation) => operation.target.mediaItemId === 1)
				.map((operation) => operation.selection.url)
		).toEqual([
			'https://image.tmdb.org/t/p/original/flow-background.jpg',
			'https://image.tmdb.org/t/p/original/flow-poster.jpg',
			'https://image.tmdb.org/t/p/original/flow-background.jpg',
			'https://image.tmdb.org/t/p/original/flow-poster.jpg'
		]);
		const executed = result.items.flatMap((item) => item.operations);
		expect(executed.map((row) => row.operationId)).toEqual(planned.map((row) => row.id));
		expect(applyPosterUrl.mock.calls).toEqual(
			planned
				.filter(
					(operation) => operation.destination === 'server' && operation.slot.kind !== 'background'
				)
				.map((operation) => [operation.targetId, operation.selection.url])
		);
		expect(applyBackgroundUrl.mock.calls).toEqual(
			planned
				.filter(
					(operation) => operation.destination === 'server' && operation.slot.kind === 'background'
				)
				.map((operation) => [operation.targetId, operation.selection.url])
		);
		expect(writeKometa).toHaveBeenCalledTimes(1);
		expect(writeKometa.mock.calls[0]?.[0]).toHaveLength(2);
		expect(writeKometa.mock.calls[0]?.[1]).toHaveLength(4);
		expect(writeKometa.mock.calls[0]?.[0][0]).toMatchObject({
			destination: {
				mediaKind: 'movie',
				namespace: 'tmdb',
				filename: 'posterpilot-movies.yml'
			},
			posterUrl: 'https://image.tmdb.org/t/p/original/flow-poster.jpg',
			backgroundUrl: 'https://image.tmdb.org/t/p/original/flow-background.jpg'
		});
		expect(result.summary).toMatchObject({ operationCount: 8, succeeded: 8, failed: 0 });
	});

	it('keeps direct-server operations actionable when a show has no Kometa identifier', async () => {
		const fixture = setup();
		fixture.items[0].item.identity.type = 'show';
		fixture.items[0].item.identity.mediaType = 'tv';
		fixture.items[0].item.identity.tvdbId = null;
		fixture.items[0].item.identity.imdbId = null;
		for (const candidate of fixture.items[0].candidates) candidate.resolvedMediaType = 'tv';
		const preview = await fixture.planner({
			context: { source: 'single' },
			targets: [{ serverInstanceId: 'server-a', mediaItemId: 1 }],
			selectionMode: 'auto',
			method: 'both'
		});
		const applyPosterUrl = vi.fn(async () => undefined);
		const applyBackgroundUrl = vi.fn(async () => undefined);
		const writeKometa = vi.fn();

		expect(preview.payload.items[0].operations.map((operation) => operation.destination)).toEqual([
			'server',
			'server'
		]);
		expect(preview.payload.items[0].skips).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					destination: 'kometa',
					code: 'missing_kometa_identifier'
				})
			])
		);
		const durableV1Skip = structuredClone(preview.payload);
		for (const item of durableV1Skip.items) {
			for (const skip of item.skips) {
				if (skip.code === 'missing_kometa_identifier') skip.code = 'missing_tmdb_id';
			}
		}
		rehashApplyPlanSources(durableV1Skip);
		expect(() => assertApplyPlanPayload(durableV1Skip)).not.toThrow();

		const result = await executeFrozenApplyPlan(
			preview.plan!.id,
			preview.plan!.digest,
			preview.payload,
			{
				serverRegistry: {
					resolve: async () => ({
						serverInstanceId: 'server-a',
						fingerprint: 'server-fingerprint',
						server: {
							type: 'plex',
							applyPosterUrl,
							applyBackgroundUrl
						} as never
					})
				},
				writeKometa
			}
		);

		expect(writeKometa).not.toHaveBeenCalled();
		expect(result.summary).toMatchObject({ operationCount: 2, succeeded: 2, failed: 0 });
	});

	it('delegates coordinated server mutations without invoking the URL fallback', async () => {
		const fixture = setup();
		const preview = await fixture.planner({
			context: { source: 'single' },
			targets: [{ serverInstanceId: 'server-a', mediaItemId: 1 }],
			selectionMode: 'auto',
			method: 'server'
		});
		const applyPosterUrl = vi.fn(async () => undefined);
		const applyBackgroundUrl = vi.fn(async () => undefined);
		const prepareOperation = vi.fn(async () => undefined);
		const executeServerOperation = vi.fn(async () => undefined);

		const result = await executeFrozenApplyPlan(
			preview.plan!.id,
			preview.plan!.digest,
			preview.payload,
			{
				serverRegistry: {
					resolve: async () => ({
						serverInstanceId: 'server-a',
						fingerprint: 'server-fingerprint',
						server: {
							type: 'plex',
							applyPosterUrl,
							applyPosterBytes: vi.fn(),
							applyBackgroundUrl,
							applyBackgroundBytes: vi.fn()
						} as never
					})
				},
				writeKometa: vi.fn(),
				prepareOperation,
				executeServerOperation
			}
		);

		expect(prepareOperation).toHaveBeenCalledTimes(2);
		expect(executeServerOperation).toHaveBeenCalledTimes(2);
		expect(applyPosterUrl).not.toHaveBeenCalled();
		expect(applyBackgroundUrl).not.toHaveBeenCalled();
		expect(result.summary).toMatchObject({ operationCount: 2, succeeded: 2, failed: 0 });
	});

	it('does not mutate the server when cancelled during operation preparation', async () => {
		const fixture = setup();
		const preview = await fixture.planner({
			context: { source: 'single' },
			targets: [{ serverInstanceId: 'server-a', mediaItemId: 1 }],
			selectionMode: 'auto',
			method: 'server'
		});
		let cancelled = false;
		const applyPosterUrl = vi.fn(async () => undefined);
		const applyBackgroundUrl = vi.fn(async () => undefined);
		const prepareOperation = vi.fn(async () => {
			await Promise.resolve();
			cancelled = true;
		});
		const executeServerOperation = vi.fn(async () => undefined);

		const result = await executeFrozenApplyPlan(
			preview.plan!.id,
			preview.plan!.digest,
			preview.payload,
			{
				serverRegistry: {
					resolve: async () => ({
						serverInstanceId: 'server-a',
						fingerprint: 'server-fingerprint',
						server: {
							type: 'plex',
							applyPosterUrl,
							applyBackgroundUrl
						} as never
					})
				},
				writeKometa: vi.fn(),
				prepareOperation,
				executeServerOperation
			},
			{ isCancelled: () => cancelled }
		);

		expect(prepareOperation).toHaveBeenCalledTimes(1);
		expect(executeServerOperation).not.toHaveBeenCalled();
		expect(applyPosterUrl).not.toHaveBeenCalled();
		expect(applyBackgroundUrl).not.toHaveBeenCalled();
		expect(result.summary).toMatchObject({ operationCount: 2, succeeded: 0, failed: 2 });
		expect(result.items[0].operations).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ status: 'failed', error: 'cancelled' }),
				expect.objectContaining({ status: 'failed', error: 'cancelled' })
			])
		);
	});

	it.each([
		['between Kometa operation preparations', 1],
		['immediately before the Kometa write', 2]
	] as const)('does not write a Kometa batch when cancelled %s', async (_boundary, cancelAfter) => {
		const fixture = setup();
		const preview = await fixture.planner({
			context: { source: 'single' },
			targets: [{ serverInstanceId: 'server-a', mediaItemId: 1 }],
			selectionMode: 'auto',
			method: 'kometa'
		});
		let cancelled = false;
		const prepareOperation = vi.fn(async () => {
			await Promise.resolve();
			if (prepareOperation.mock.calls.length === cancelAfter) cancelled = true;
		});
		const writeKometa = vi.fn<ApplyPlanExecutorDependencies['writeKometa']>(async () => undefined);

		const result = await executeFrozenApplyPlan(
			preview.plan!.id,
			preview.plan!.digest,
			preview.payload,
			{
				serverRegistry: { resolve: vi.fn() },
				writeKometa,
				prepareOperation
			},
			{ isCancelled: () => cancelled }
		);

		expect(prepareOperation).toHaveBeenCalledTimes(cancelAfter);
		expect(writeKometa).not.toHaveBeenCalled();
		expect(result.summary).toMatchObject({ operationCount: 2, succeeded: 0, failed: 2 });
		expect(result.items[0].operations).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ status: 'failed', error: 'cancelled' }),
				expect.objectContaining({ status: 'failed', error: 'cancelled' })
			])
		);
	});

	it('isolates an atomic failure in one typed file from the other file batch', async () => {
		const fixture = setup();
		fixture.items[1].item.identity.type = 'show';
		fixture.items[1].item.identity.mediaType = 'tv';
		fixture.items[1].item.identity.tvdbId = '1';
		for (const candidate of fixture.items[1].candidates) {
			candidate.resolvedMediaType = 'tv';
		}
		const preview = await fixture.planner({
			context: { source: 'bulk', resultSetFingerprint: 'typed-files' },
			targets: [
				{ serverInstanceId: 'server-a', mediaItemId: 1 },
				{ serverInstanceId: 'server-a', mediaItemId: 2 }
			],
			selectionMode: 'auto',
			method: 'kometa'
		});
		const writeKometa = vi.fn<ApplyPlanExecutorDependencies['writeKometa']>(async (items) => {
			if (items[0]?.destination.filename === 'posterpilot-shows.yml') {
				throw new Error('show file unavailable');
			}
		});

		const result = await executeFrozenApplyPlan(
			preview.plan!.id,
			preview.plan!.digest,
			preview.payload,
			{
				serverRegistry: { resolve: vi.fn() },
				writeKometa
			}
		);

		expect(writeKometa).toHaveBeenCalledTimes(2);
		expect(writeKometa.mock.calls.map(([items]) => items[0]?.destination.filename)).toEqual([
			'posterpilot-movies.yml',
			'posterpilot-shows.yml'
		]);
		expect(preview.payload.items.map((item) => item.operations[0]?.targetId)).toEqual([
			'kometa:v2:movie:tmdb:1:posterpilot-movies.yml',
			'kometa:v2:show:tvdb:1:posterpilot-shows.yml'
		]);
		expect(result.items[0].operations.every((operation) => operation.status === 'success')).toBe(
			true
		);
		expect(result.items[1].operations.every((operation) => operation.status === 'failed')).toBe(
			true
		);
		expect(result.summary).toMatchObject({ succeeded: 2, failed: 2 });
	});

	it.each([
		['timeout', 'remote_artwork_timeout'],
		['size limit', 'remote_artwork_too_large'],
		['invalid MIME', 'remote_artwork_content_type_invalid'],
		['redirect policy', 'remote_artwork_redirect_limit'],
		['host policy', 'remote_artwork_target_not_allowed']
	] satisfies [string, RemoteArtworkDownloadErrorCode][])(
		'never mutates Plex when the %s preflight rejects',
		async (_label, code) => {
			const fixture = setup();
			for (const candidate of fixture.items[0].candidates) {
				candidate.url = `${candidate.url}?api_key=must-stay-redacted`;
			}
			const preview = await fixture.planner({
				context: { source: 'single' },
				targets: [{ serverInstanceId: 'server-a', mediaItemId: 1 }],
				selectionMode: 'auto',
				method: 'server'
			});
			const applyPosterUrl = vi.fn(async () => undefined);
			const applyBackgroundUrl = vi.fn(async () => undefined);
			const prepareOperation = vi.fn(async () => {
				throw new RemoteArtworkDownloadError(code);
			});

			const result = await executeFrozenApplyPlan(
				preview.plan!.id,
				preview.plan!.digest,
				preview.payload,
				{
					serverRegistry: {
						resolve: async () => ({
							serverInstanceId: 'server-a',
							fingerprint: 'server-fingerprint',
							server: {
								type: 'plex',
								identity: { instanceId: 'server-a', name: 'Server A', type: 'plex' },
								capabilities: {
									posterWrite: 'supported',
									backgroundWrite: 'supported',
									seasonWrite: 'supported',
									episodeWrite: 'supported',
									fieldLock: 'supported',
									currentImageRetrieval: 'supported',
									artworkDelete: 'unsupported',
									evidence: 'provider_contract',
									limitations: ['artwork_delete_unavailable']
								},
								testConnection: vi.fn(),
								listLibraries: vi.fn(),
								listItems: vi.fn(),
								listSeasons: vi.fn(),
								listEpisodes: vi.fn(),
								applyPosterUrl,
								applyPosterBytes: vi.fn(),
								applyBackgroundUrl,
								lockField: vi.fn()
							}
						})
					},
					writeKometa: vi.fn(),
					prepareOperation
				}
			);

			expect(prepareOperation).toHaveBeenCalledTimes(2);
			expect(applyPosterUrl).not.toHaveBeenCalled();
			expect(applyBackgroundUrl).not.toHaveBeenCalled();
			expect(result.summary).toMatchObject({ operationCount: 2, succeeded: 0, failed: 2 });
			for (const operation of result.items[0].operations) {
				expect(operation).toMatchObject({ status: 'failed', error: code });
				expect(operation.error).not.toContain('must-stay-redacted');
			}
		}
	);

	it('continues independent collection member writes after one operation fails', async () => {
		const fixture = setup();
		const preview = await fixture.planner({
			context: {
				source: 'collection',
				collectionId: 'collection-42',
				membershipFingerprint: 'members-v1'
			},
			targets: [
				{ serverInstanceId: 'server-a', mediaItemId: 1 },
				{ serverInstanceId: 'server-a', mediaItemId: 2 }
			],
			selectionMode: 'auto',
			method: 'server'
		});
		const applyPosterUrl = vi.fn(async (targetId: string) => {
			if (targetId.includes('-1-')) throw new Error('provider_write_failed');
		});
		const applyBackgroundUrl = vi.fn(async () => undefined);

		const result = await executeFrozenApplyPlan(
			preview.plan!.id,
			preview.plan!.digest,
			preview.payload,
			{
				serverRegistry: {
					resolve: async () => ({
						serverInstanceId: 'server-a',
						fingerprint: 'server-fingerprint',
						server: {
							type: 'plex',
							identity: { instanceId: 'server-a', name: 'Server A', type: 'plex' },
							capabilities: {
								posterWrite: 'supported',
								backgroundWrite: 'supported',
								seasonWrite: 'supported',
								episodeWrite: 'supported',
								fieldLock: 'supported',
								currentImageRetrieval: 'supported',
								artworkDelete: 'unsupported',
								evidence: 'provider_contract',
								limitations: ['artwork_delete_unavailable']
							},
							testConnection: vi.fn(),
							listLibraries: vi.fn(),
							listItems: vi.fn(),
							listSeasons: vi.fn(),
							listEpisodes: vi.fn(),
							applyPosterUrl,
							applyPosterBytes: vi.fn(),
							applyBackgroundUrl,
							lockField: vi.fn()
						}
					})
				},
				writeKometa: vi.fn()
			}
		);

		expect(result.summary).toMatchObject({ operationCount: 4, succeeded: 3, failed: 1 });
		expect(result.items.find((item) => item.mediaItemId === 1)?.operations).toEqual(
			expect.arrayContaining([expect.objectContaining({ status: 'failed' })])
		);
		expect(result.items.find((item) => item.mediaItemId === 2)?.operations).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ status: 'success' }),
				expect.objectContaining({ status: 'success' })
			])
		);
		expect(applyBackgroundUrl).toHaveBeenCalledTimes(2);
	});

	it('rejects a candidate change before consume and never enqueues', async () => {
		const fixture = setup();
		const preview = await fixture.planner({
			context: { source: 'single' },
			targets: [{ serverInstanceId: 'server-a', mediaItemId: 1 }],
			selectionMode: 'auto',
			method: 'server'
		});
		fixture.items[0].candidates[0].url = 'https://art.example/replaced.jpg';
		const enqueue = vi.fn(async () => 1);

		await expect(
			confirmApplyPlan(
				{
					planId: preview.plan!.id,
					digest: preview.plan!.digest,
					serverInstanceId: 'server-a'
				},
				{
					store: fixture.store,
					loadItemData: fixture.loadItemData,
					resolveDestinationSlots: fixture.resolveDestinationSlots,
					enqueue
				}
			)
		).rejects.toMatchObject({ code: 'plan_stale' });
		expect(enqueue).not.toHaveBeenCalled();
	});

	it('rejects a current destination change before any job is enqueued', async () => {
		const fixture = setup();
		const preview = await fixture.planner({
			context: { source: 'single' },
			targets: [{ serverInstanceId: 'server-a', mediaItemId: 1 }],
			selectionMode: 'auto',
			method: 'server'
		});
		fixture.items[0].item.currentSlots[0].fingerprint = 'externally-changed';
		const enqueue = vi.fn(async () => 1);

		await expect(
			confirmApplyPlan(
				{
					planId: preview.plan!.id,
					digest: preview.plan!.digest,
					serverInstanceId: 'server-a'
				},
				{
					store: fixture.store,
					loadItemData: fixture.loadItemData,
					resolveDestinationSlots: fixture.resolveDestinationSlots,
					enqueue
				}
			)
		).rejects.toMatchObject({ code: 'plan_stale' });
		expect(enqueue).not.toHaveBeenCalled();
	});

	it('rejects pending stored-slot changes even if a legacy timestamp was not advanced', async () => {
		const fixture = setup();
		const item = fixture.items[0];
		item.storedSelections = [
			{
				slot: item.candidates[0].slot,
				candidateId: item.candidates[0].candidateId,
				url: item.candidates[0].url,
				provider: item.candidates[0].provider,
				setId: item.candidates[0].setId,
				setAuthor: item.candidates[0].setAuthor
			}
		];
		const preview = await fixture.planner({
			context: { source: 'single' },
			targets: [{ serverInstanceId: 'server-a', mediaItemId: 1 }],
			selectionMode: 'stored',
			method: 'server'
		});
		item.storedSelections.push({
			slot: item.candidates[1].slot,
			candidateId: item.candidates[1].candidateId,
			url: item.candidates[1].url,
			provider: item.candidates[1].provider,
			setId: item.candidates[1].setId,
			setAuthor: item.candidates[1].setAuthor
		});

		await expect(
			confirmApplyPlan(
				{
					planId: preview.plan!.id,
					digest: preview.plan!.digest,
					serverInstanceId: 'server-a'
				},
				{
					store: fixture.store,
					loadItemData: fixture.loadItemData,
					resolveDestinationSlots: fixture.resolveDestinationSlots,
					enqueue: async () => 1
				}
			)
		).rejects.toMatchObject({ code: 'plan_stale' });
	});

	it('keeps a legacy TMDB stored selection fresh after freezing its canonical URL', async () => {
		const fixture = setup();
		const item = fixture.items[0];
		item.candidates[0].provider = 'tmdb';
		item.candidates[0].url = 'https://image.tmdb.org/t/p/w500/fresh-poster.jpg';
		item.storedSelections = [
			{
				slot: item.candidates[0].slot,
				candidateId: null,
				url: item.candidates[0].url,
				provider: null,
				setId: null,
				setAuthor: null
			}
		];
		const preview = await fixture.planner({
			context: { source: 'single' },
			targets: [{ serverInstanceId: 'server-a', mediaItemId: 1 }],
			selectionMode: 'stored',
			method: 'server'
		});
		expect(preview.payload.items[0].selections[0].url).toBe(
			'https://image.tmdb.org/t/p/original/fresh-poster.jpg'
		);
		item.candidates[0].url = 'https://image.tmdb.org/t/p/w780/fresh-poster.jpg';
		item.storedSelections[0].url = item.candidates[0].url;
		const enqueue = vi.fn(async () => 99);

		await expect(
			confirmApplyPlan(
				{
					planId: preview.plan!.id,
					digest: preview.plan!.digest,
					serverInstanceId: 'server-a'
				},
				{
					store: fixture.store,
					loadItemData: fixture.loadItemData,
					resolveDestinationSlots: fixture.resolveDestinationSlots,
					enqueue
				}
			)
		).resolves.toMatchObject({ jobId: 99 });
		expect(enqueue).toHaveBeenCalledWith(
			expect.objectContaining({
				plan: expect.objectContaining({
					items: [
						expect.objectContaining({
							selections: [
								expect.objectContaining({ url: preview.payload.items[0].selections[0].url })
							]
						})
					]
				})
			})
		);
	});

	it('enforces server scope and rejects replay after the single consume', async () => {
		const fixture = setup();
		const preview = await fixture.planner({
			context: { source: 'single' },
			targets: [{ serverInstanceId: 'server-a', mediaItemId: 1 }],
			selectionMode: 'auto',
			method: 'server'
		});
		const dependencies = {
			store: fixture.store,
			loadItemData: fixture.loadItemData,
			resolveDestinationSlots: fixture.resolveDestinationSlots,
			enqueue: async () => 1
		};
		await expect(
			confirmApplyPlan(
				{
					planId: preview.plan!.id,
					digest: preview.plan!.digest,
					serverInstanceId: 'server-b'
				},
				dependencies
			)
		).rejects.toMatchObject({ code: 'plan_scope_mismatch' });

		const request = {
			planId: preview.plan!.id,
			digest: preview.plan!.digest,
			serverInstanceId: 'server-a'
		};
		await confirmApplyPlan(request, dependencies);
		await expect(confirmApplyPlan(request, dependencies)).rejects.toMatchObject({
			code: 'plan_consumed'
		});
	});
});
