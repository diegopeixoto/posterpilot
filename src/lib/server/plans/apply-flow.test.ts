import { describe, expect, it, vi } from 'vitest';

// The flow uses a purpose-built lifecycle store; keep this pure test `$env`-free.
vi.mock('$lib/server/db', () => ({ db: {} }));
import { DEFAULT_SCORE_WEIGHTS } from '$lib/server/posters/score';
import { selectAutomaticArtwork } from '$lib/server/posters/automatic-selection';
import { canonicalJsonDigest } from './canonical-json';
import { confirmApplyPlan, exactApplyPreviewResponse } from './apply-api';
import { executeFrozenApplyPlan } from './apply-executor';
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
		selectionUpdatedAt: '2026-07-10T11:01:00.000Z'
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

describe('frozen apply flow', () => {
	it('executes exactly the per-item/per-slot operations returned by preview', async () => {
		const fixture = setup();
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
		const writeKometa = vi.fn(async () => undefined);
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
		expect(result.summary).toMatchObject({ operationCount: 8, succeeded: 8, failed: 0 });
	});

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
