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
	type FrozenApplyJobPayload,
	type FrozenArtworkSelection
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
				return {
					destination,
					slot: selection.slot,
					targetId: `${destination}-${target.item.identity.mediaItemId}-${applySlotKey(selection.slot)}`,
					capability: 'supported' as const,
					current: {
						url: current?.url ?? null,
						fingerprint: current?.fingerprint ?? null,
						artworkVersion: current?.artworkVersion ?? null,
						observedAt: current?.observedAt ?? null,
						destinationFingerprint: `${destination}-state-${target.item.identity.mediaItemId}`
					},
					skipCode: null,
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
	return { items, planner, store, loadItemData, resolveDestinationSlots };
}

type LegacyV1Selection = Omit<FrozenArtworkSelection, 'fingerprint'>;

/**
 * Serialize the literal v1 shape emitted before migration 0010. This intentionally
 * does not call the current planner and never creates then deletes revision fields.
 */
function legacyV1PayloadFixture(input: {
	data: ApplyPlannerItemData;
	selection: LegacyV1Selection;
	selectionMode: 'auto' | 'stored';
}): ApplyPlanPayloadV1 {
	const { selectionRevision: _selectionRevision, ...legacyIdentity } = structuredClone(
		input.data.item.identity
	);
	const candidates = [...input.data.candidates]
		.sort((a, b) => a.candidateId - b.candidateId)
		.map((candidate) => ({
			candidateId: candidate.candidateId,
			serverInstanceId: candidate.serverInstanceId,
			mediaItemId: candidate.mediaItemId,
			discoveryRunId: candidate.discoveryRunId,
			provider: candidate.provider,
			providerAssetId: candidate.providerAssetId,
			setId: candidate.setId,
			setAuthor: candidate.setAuthor,
			designFamily: candidate.designFamily,
			language: candidate.language,
			url: candidate.url,
			slot: candidate.slot,
			resolvedTmdbId: candidate.resolvedTmdbId,
			resolvedMediaType: candidate.resolvedMediaType,
			width: candidate.width,
			height: candidate.height,
			score: candidate.score,
			active: candidate.active,
			stale: candidate.stale,
			lastSeenAt: candidate.lastSeenAt
		}));
	const active = candidates.filter((candidate) => candidate.active);
	const discovery = {
		status: input.data.item.discovery.status,
		runId: input.data.item.discovery.runId,
		completedAt: input.data.item.discovery.completedAt,
		resolvedTmdbId: input.data.item.identity.tmdbId,
		resolvedMediaType: input.data.item.identity.mediaType,
		candidateIds: active.map((candidate) => candidate.candidateId),
		candidateCount: active.length,
		fingerprint: hashCanonicalJson({
			status: input.data.item.discovery.status,
			runId: input.data.item.discovery.runId,
			completedAt: input.data.item.discovery.completedAt,
			resolvedTmdbId: input.data.item.identity.tmdbId,
			resolvedMediaType: input.data.item.identity.mediaType,
			candidates
		})
	};
	const selection = {
		...structuredClone(input.selection),
		fingerprint: hashCanonicalJson(input.selection)
	};
	const currentSlot = input.data.item.currentSlots.find(
		(row) => applySlotKey(row.slot) === applySlotKey(selection.slot)
	);
	const current = {
		url: currentSlot?.url ?? null,
		fingerprint: currentSlot?.fingerprint ?? null,
		artworkVersion: currentSlot?.artworkVersion ?? null,
		observedAt: currentSlot?.observedAt ?? null,
		destinationFingerprint: `server-state-${legacyIdentity.mediaItemId}`
	};
	const targetId = `server-${legacyIdentity.mediaItemId}-${applySlotKey(selection.slot)}`;
	const destinationSlot = {
		destination: 'server' as const,
		slot: selection.slot,
		targetId,
		capability: 'supported' as const,
		current,
		skipCode: null,
		parameters: {}
	};
	const operationId = hashCanonicalJson({
		destination: 'server',
		serverInstanceId: legacyIdentity.serverInstanceId,
		mediaItemId: legacyIdentity.mediaItemId,
		targetId,
		slot: selection.slot,
		selectionFingerprint: selection.fingerprint
	});
	const operation = {
		id: operationId,
		destination: 'server' as const,
		target: legacyIdentity,
		targetId,
		slot: selection.slot,
		current,
		selection,
		expectedOverwrite: current.url !== null || current.fingerprint !== null
	};
	const missingSlot =
		selection.slot.kind === 'poster'
			? { kind: 'background' as const, season: null, episode: null }
			: { kind: 'poster' as const, season: null, episode: null };
	const skips = [
		{
			destination: 'server' as const,
			slot: missingSlot,
			code:
				input.selectionMode === 'auto'
					? ('no_candidate' as const)
					: ('no_stored_selection' as const),
			parameters: {}
		}
	];
	const selectionFingerprint = hashCanonicalJson({
		selectionUpdatedAt: legacyIdentity.selectionUpdatedAt,
		discoveryFingerprint: discovery.fingerprint,
		selections: [selection]
	});
	const currentStateFingerprint = hashCanonicalJson({
		targetUpdatedAt: legacyIdentity.updatedAt,
		destinationSlots: [
			{
				destination: destinationSlot.destination,
				slot: destinationSlot.slot,
				targetId: destinationSlot.targetId,
				capability: destinationSlot.capability,
				current: destinationSlot.current,
				skipCode: destinationSlot.skipCode
			}
		]
	});
	const sourceFingerprint = hashCanonicalJson({
		target: legacyIdentity,
		selectionFrom: legacyIdentity,
		selectionFingerprint,
		currentStateFingerprint,
		operations: [operationId],
		skips
	});
	const item = {
		target: legacyIdentity,
		selectionFrom: legacyIdentity,
		discovery,
		selections: [selection],
		destinationSlots: [destinationSlot],
		operations: [operation],
		skips,
		selectionFingerprint,
		currentStateFingerprint,
		sourceFingerprint
	};
	const context = { source: 'single' as const };
	const defaults = {
		configuredMethod: 'both' as const,
		effectiveMethod: 'server' as const,
		methodSource: 'explicit' as const,
		selectionMode: input.selectionMode,
		scoring: {
			providerPriority: ['mediux'],
			weights: DEFAULT_SCORE_WEIGHTS
		}
	};
	const payload = {
		version: 1 as const,
		type: 'artwork_apply' as const,
		plannedAt: NOW.toISOString(),
		context,
		defaults,
		scope: {
			serverInstanceIds: [legacyIdentity.serverInstanceId],
			librarySectionKeys: [legacyIdentity.librarySectionKey],
			targetItemIds: [legacyIdentity.mediaItemId]
		},
		items: [item],
		sourceFingerprint: hashCanonicalJson({
			context,
			defaults,
			items: [sourceFingerprint]
		}),
		summary: {
			itemCount: 1,
			actionableItemCount: 1,
			operationCount: 1,
			skipCount: 1,
			destinations: { server: 1, kometa: 0 }
		}
	};
	return payload as unknown as ApplyPlanPayloadV1;
}

function legacyV1CandidateSelectionFixture(
	data: ApplyPlannerItemData,
	candidate: PlannerCandidateSnapshot,
	selectionSource: 'auto' | 'stored'
): LegacyV1Selection {
	return {
		selectionSource,
		sourceItem: {
			serverInstanceId: data.item.identity.serverInstanceId,
			mediaItemId: data.item.identity.mediaItemId
		},
		slot: candidate.slot,
		candidateId: candidate.candidateId,
		url: candidate.url,
		provider: candidate.provider,
		providerAssetId: candidate.providerAssetId,
		setId: candidate.setId,
		setAuthor: candidate.setAuthor,
		designFamily: candidate.designFamily,
		language: candidate.language,
		discoveryRunId: candidate.discoveryRunId,
		resolvedTmdbId: candidate.resolvedTmdbId,
		resolvedMediaType: candidate.resolvedMediaType,
		stale: candidate.stale,
		score: candidate.score,
		width: candidate.width,
		height: candidate.height
	};
}

function legacyV1ProviderlessStoredSelectionFixture(
	data: ApplyPlannerItemData,
	url: string
): LegacyV1Selection {
	return {
		selectionSource: 'stored',
		sourceItem: {
			serverInstanceId: data.item.identity.serverInstanceId,
			mediaItemId: data.item.identity.mediaItemId
		},
		slot: { kind: 'poster', season: null, episode: null },
		candidateId: null,
		url,
		provider: null,
		providerAssetId: null,
		setId: null,
		setAuthor: null,
		designFamily: null,
		language: null,
		discoveryRunId: null,
		resolvedTmdbId: data.item.identity.tmdbId,
		resolvedMediaType: data.item.identity.mediaType,
		stale: false,
		score: null,
		width: null,
		height: null
	};
}

describe('frozen apply flow', () => {
	it('keeps a genuine revisionless v1 TMDB preview plan fresh after canonicalization', async () => {
		const fixture = setup();
		const data = fixture.items[0];
		data.item.identity.selectionRevision = 0;
		data.candidates = [data.candidates[0]];
		data.candidates[0].provider = 'tmdb';
		data.candidates[0].url = 'https://image.tmdb.org/t/p/w500/legacy-v1.jpg';
		const legacy = legacyV1PayloadFixture({
			data,
			selection: legacyV1CandidateSelectionFixture(data, data.candidates[0], 'auto'),
			selectionMode: 'auto'
		});

		expect(legacy.items[0].selections[0]).toMatchObject({
			url: 'https://image.tmdb.org/t/p/w500/legacy-v1.jpg',
			provider: 'tmdb'
		});
		expect(Object.hasOwn(legacy.items[0].selectionFrom, 'selectionRevision')).toBe(false);
		expect(() => assertApplyPlanPayload(legacy)).not.toThrow();
		await expect(
			assertApplyPlanFresh(legacy, {
				loadItemData: fixture.loadItemData,
				resolveDestinationSlots: fixture.resolveDestinationSlots
			})
		).resolves.toBeUndefined();

		data.candidates[0].url = 'https://image.tmdb.org/t/p/w500/changed.jpg';
		await expect(
			assertApplyPlanFresh(legacy, {
				loadItemData: fixture.loadItemData,
				resolveDestinationSlots: fixture.resolveDestinationSlots
			})
		).rejects.toMatchObject({ code: 'plan_stale' });
	});

	it('keeps a genuine revisionless v1 providerless custom plan fresh after backfill', async () => {
		const fixture = setup();
		const data = fixture.items[0];
		const customUrl = 'https://custom.example/legacy-v1.jpg';
		data.item.identity.selectionRevision = 0;
		data.candidates = [];
		data.storedSelections = [
			{
				slot: { kind: 'poster', season: null, episode: null },
				candidateId: null,
				url: customUrl,
				provider: 'custom',
				setId: null,
				setAuthor: null
			}
		];
		const legacy = legacyV1PayloadFixture({
			data,
			selection: legacyV1ProviderlessStoredSelectionFixture(data, customUrl),
			selectionMode: 'stored'
		});

		expect(legacy.items[0].selections[0]).toMatchObject({ provider: null, url: customUrl });
		expect(Object.hasOwn(legacy.items[0].selectionFrom, 'selectionRevision')).toBe(false);
		expect(() => assertApplyPlanPayload(legacy)).not.toThrow();
		await expect(
			assertApplyPlanFresh(legacy, {
				loadItemData: fixture.loadItemData,
				resolveDestinationSlots: fixture.resolveDestinationSlots
			})
		).resolves.toBeUndefined();

		data.storedSelections[0].url = 'https://custom.example/changed.jpg';
		await expect(
			assertApplyPlanFresh(legacy, {
				loadItemData: fixture.loadItemData,
				resolveDestinationSlots: fixture.resolveDestinationSlots
			})
		).rejects.toMatchObject({ code: 'plan_stale' });
	});

	it('rejects a genuine revisionless v1 payload after the migrated revision advances', async () => {
		const fixture = setup();
		const data = fixture.items[0];
		data.item.identity.selectionRevision = 0;
		data.candidates = [data.candidates[0]];
		const legacy = legacyV1PayloadFixture({
			data,
			selection: legacyV1CandidateSelectionFixture(data, data.candidates[0], 'auto'),
			selectionMode: 'auto'
		});
		data.item.identity.selectionRevision = 1;

		await expect(
			assertApplyPlanFresh(legacy, {
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
		expect(writeKometa).toHaveBeenCalledTimes(2);
		expect(writeKometa.mock.calls[0]?.[0][0]).toMatchObject({
			posterUrl: 'https://image.tmdb.org/t/p/original/flow-poster.jpg',
			backgroundUrl: 'https://image.tmdb.org/t/p/original/flow-background.jpg'
		});
		expect(result.summary).toMatchObject({ operationCount: 8, succeeded: 8, failed: 0 });
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
