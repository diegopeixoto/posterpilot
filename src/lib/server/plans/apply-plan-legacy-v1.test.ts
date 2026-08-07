import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/db', () => ({ db: {} }));

import type { MediaServer } from '$lib/server/media-server';
import { confirmApplyPlan, type ConfirmApplyPlanDependencies } from './apply-api';
import { executeFrozenApplyPlan } from './apply-executor';
import {
	APPLY_PLAN_KIND,
	applySlotKey,
	type ApplyItemIdentity,
	type ApplyPlanPayloadV1,
	type FrozenApplyJobPayload
} from './apply-plan';
import {
	ApplyPlanValidationError,
	assertApplyPlanFresh,
	assertApplyPlanPayload,
	type ApplyPlanFreshnessResolverDependencies
} from './apply-plan-validation';
import type { ApplyPlannerItemData } from './apply-planner';
import { canonicalJsonDigest, hashCanonicalJson } from './canonical-json';
import capturedCustomFixture from './fixtures/pre-0010-providerless-custom-plan.json';
import capturedTmdbFixture from './fixtures/pre-0010-providerless-tmdb-plan.json';
import type { OperationPlan, OperationPlanExpectations } from './operation-plan-store';

const CAPTURED_TMDB_DIGEST = '0856fff26007eeaa67eaa7d882b2d9005bda7f7809649a022069e3d1b7c4d40f';
const CAPTURED_CUSTOM_DIGEST = '680ecbe4b5cdbab424b82c9796b978757ef553a0e74e7e4d4b1dc57b2f495ff6';

function capturedTmdbPlan(): ApplyPlanPayloadV1 {
	return structuredClone(capturedTmdbFixture) as unknown as ApplyPlanPayloadV1;
}

function capturedCustomPlan(): ApplyPlanPayloadV1 {
	return structuredClone(capturedCustomFixture) as unknown as ApplyPlanPayloadV1;
}

function currentIdentity(payload: ApplyPlanPayloadV1): ApplyItemIdentity {
	return {
		...structuredClone(payload.items[0].selectionFrom),
		selectionRevision: 0
	};
}

function migratedTmdbData(): ApplyPlannerItemData {
	const identity = currentIdentity(capturedTmdbPlan());
	return {
		item: {
			identity,
			ignored: false,
			sourceRemoved: false,
			discovery: {
				status: 'succeeded',
				runId: 'run-pre0010',
				completedAt: '2026-07-10T10:59:00.000Z'
			},
			currentSlots: [
				{
					slot: { kind: 'poster', season: null, episode: null },
					url: 'https://server.example/current-root.jpg',
					fingerprint: 'current-root',
					artworkVersion: 4,
					observedAt: '2026-07-10T10:00:00.000Z'
				},
				{
					slot: { kind: 'title_card', season: 1, episode: 2 },
					url: 'https://server.example/current-child.jpg',
					fingerprint: 'current-child',
					artworkVersion: 2,
					observedAt: '2026-07-10T10:00:00.000Z'
				}
			]
		},
		candidates: [
			{
				candidateId: 701,
				serverInstanceId: 'server-a',
				mediaItemId: 77,
				discoveryRunId: 'run-pre0010',
				provider: 'tmdb',
				providerAssetId: '/legacy-root.jpg',
				setId: 'tmdb-root',
				setAuthor: null,
				designFamily: null,
				language: null,
				url: 'https://image.tmdb.org/t/p/w500/legacy-root.jpg',
				slot: { kind: 'poster', season: null, episode: null },
				resolvedTmdbId: '77',
				resolvedMediaType: 'tv',
				width: 1000,
				height: 1500,
				score: 1,
				active: true,
				stale: false,
				lastSeenAt: '2026-07-10T10:58:00.000Z'
			},
			{
				candidateId: 702,
				serverInstanceId: 'server-a',
				mediaItemId: 77,
				discoveryRunId: 'run-pre0010',
				provider: 'tmdb',
				providerAssetId: '/legacy-child.jpg',
				setId: 'tmdb-child',
				setAuthor: null,
				designFamily: null,
				language: null,
				url: 'https://image.tmdb.org/t/p/w500/legacy-child.jpg',
				slot: { kind: 'title_card', season: 1, episode: 2 },
				resolvedTmdbId: '77',
				resolvedMediaType: 'tv',
				width: 1280,
				height: 720,
				score: 1,
				active: true,
				stale: false,
				lastSeenAt: '2026-07-10T10:58:00.000Z'
			}
		],
		storedSelections: [
			{
				slot: { kind: 'poster', season: null, episode: null },
				candidateId: 701,
				url: 'https://image.tmdb.org/t/p/original/legacy-root.jpg',
				provider: 'tmdb',
				setId: 'tmdb-root',
				setAuthor: null,
				persisted: { candidateId: null, provider: 'tmdb', setId: null }
			},
			{
				slot: { kind: 'title_card', season: 1, episode: 2 },
				candidateId: 702,
				url: 'https://image.tmdb.org/t/p/original/legacy-child.jpg',
				provider: 'tmdb',
				setId: 'tmdb-child',
				setAuthor: null,
				persisted: { candidateId: null, provider: 'tmdb', setId: null }
			}
		]
	};
}

function migratedCustomData(): ApplyPlannerItemData {
	const identity = currentIdentity(capturedCustomPlan());
	return {
		item: {
			identity,
			ignored: false,
			sourceRemoved: false,
			discovery: {
				status: 'succeeded',
				runId: 'run-pre0010-custom',
				completedAt: '2026-07-10T10:59:30.000Z'
			},
			currentSlots: [
				{
					slot: { kind: 'poster', season: null, episode: null },
					url: 'https://server.example/current-root.jpg',
					fingerprint: 'current-root',
					artworkVersion: 4,
					observedAt: '2026-07-10T10:00:00.000Z'
				}
			]
		},
		candidates: [],
		storedSelections: [
			{
				slot: { kind: 'poster', season: null, episode: null },
				candidateId: null,
				url: 'https://custom.example/pre0010.jpg',
				provider: 'custom',
				setId: null,
				setAuthor: null,
				persisted: { candidateId: null, provider: 'custom', setId: null }
			}
		]
	};
}

const resolveDestinationSlots: ApplyPlanFreshnessResolverDependencies['resolveDestinationSlots'] =
	async ({ target, selections, destinations }) =>
		selections.flatMap((selection) =>
			destinations.map((destination) => {
				const current = target.item.currentSlots.find(
					(row) => applySlotKey(row.slot) === applySlotKey(selection.slot)
				);
				return {
					destination,
					slot: selection.slot,
					targetId: `${target.item.identity.sourceId}:${applySlotKey(selection.slot)}`,
					capability: 'supported' as const,
					current: {
						url: current?.url ?? null,
						fingerprint: current?.fingerprint ?? null,
						artworkVersion: current?.artworkVersion ?? null,
						observedAt: current?.observedAt ?? null,
						destinationFingerprint: null
					},
					skipCode: null,
					parameters: {}
				};
			})
		);

function freshnessDependencies(data: ApplyPlannerItemData): ApplyPlanFreshnessResolverDependencies {
	return {
		loadItemData: async (ref) =>
			ref.serverInstanceId === data.item.identity.serverInstanceId &&
			ref.mediaItemId === data.item.identity.mediaItemId
				? data
				: null,
		resolveDestinationSlots
	};
}

function lifecycleStore(payload: ApplyPlanPayloadV1, digest: string) {
	let consumed = false;
	const plan: OperationPlan<ApplyPlanPayloadV1> = {
		id: 'captured-pre0010-plan',
		kind: APPLY_PLAN_KIND,
		serverInstanceId: 'server-a',
		librarySectionKey: 'shows',
		payload,
		digest,
		createdAt: new Date('2026-07-10T12:00:00.000Z'),
		expiresAt: new Date('2026-07-10T12:15:00.000Z'),
		consumedAt: null
	};
	const checked = (id: string, expected: OperationPlanExpectations = {}) => {
		if (
			id !== plan.id ||
			expected.kind !== plan.kind ||
			expected.digest !== plan.digest ||
			expected.serverInstanceId !== plan.serverInstanceId ||
			consumed
		) {
			throw new Error('Unexpected captured plan lifecycle request');
		}
		return plan;
	};
	return {
		async validate<T>(id: string, expected?: OperationPlanExpectations): Promise<OperationPlan<T>> {
			return checked(id, expected) as unknown as OperationPlan<T>;
		},
		async consume<T>(id: string, expected?: OperationPlanExpectations): Promise<OperationPlan<T>> {
			const current = checked(id, expected);
			consumed = true;
			return { ...current, consumedAt: new Date() } as unknown as OperationPlan<T>;
		}
	};
}

function rehashOperationSelection(payload: ApplyPlanPayloadV1, operationIndex: number): void {
	const operation = payload.items[0].operations[operationIndex];
	const { fingerprint: _fingerprint, ...selectionIdentity } = operation.selection;
	operation.selection.fingerprint = hashCanonicalJson(selectionIdentity);
	operation.id = hashCanonicalJson({
		destination: operation.destination,
		serverInstanceId: operation.target.serverInstanceId,
		mediaItemId: operation.target.mediaItemId,
		targetId: operation.targetId,
		slot: operation.slot,
		selectionFingerprint: operation.selection.fingerprint
	});
}

describe('captured pre-0010 apply plan compatibility', () => {
	it('accepts the exact root and child TMDB payload emitted by a375115', async () => {
		const payload = capturedTmdbPlan();
		expect(canonicalJsonDigest(payload).digest).toBe(CAPTURED_TMDB_DIGEST);
		expect(() => assertApplyPlanPayload(payload)).not.toThrow();
		await expect(
			assertApplyPlanFresh(payload, freshnessDependencies(migratedTmdbData()))
		).resolves.toBeUndefined();
	});

	it('accepts the exact providerless custom payload emitted by a375115', async () => {
		const payload = capturedCustomPlan();
		expect(canonicalJsonDigest(payload).digest).toBe(CAPTURED_CUSTOM_DIGEST);
		expect(() => assertApplyPlanPayload(payload)).not.toThrow();
		await expect(
			assertApplyPlanFresh(payload, freshnessDependencies(migratedCustomData()))
		).resolves.toBeUndefined();
	});

	it('confirms, enqueues, and executes both captured TMDB operations unchanged', async () => {
		const payload = capturedTmdbPlan();
		let queued: FrozenApplyJobPayload | null = null;
		const dependencies: ConfirmApplyPlanDependencies = {
			...freshnessDependencies(migratedTmdbData()),
			store: lifecycleStore(payload, CAPTURED_TMDB_DIGEST),
			enqueue: async (job) => {
				queued = job;
				return 6901;
			}
		};
		await expect(
			confirmApplyPlan(
				{
					planId: 'captured-pre0010-plan',
					digest: CAPTURED_TMDB_DIGEST,
					serverInstanceId: 'server-a',
					targetItemId: 77
				},
				dependencies
			)
		).resolves.toEqual({
			jobId: 6901,
			planId: 'captured-pre0010-plan',
			digest: CAPTURED_TMDB_DIGEST
		});

		expect(queued).not.toBeNull();
		const job = queued as unknown as FrozenApplyJobPayload;
		const executed: Array<{ targetId: string; url: string }> = [];
		const result = await executeFrozenApplyPlan(job.planId, job.digest, job.plan, {
			serverRegistry: {
				resolve: async () => ({
					serverInstanceId: 'server-a',
					server: {} as MediaServer,
					fingerprint: 'captured-server'
				})
			},
			writeKometa: async () => undefined,
			executeServerOperation: async (operation) => {
				executed.push({ targetId: operation.targetId, url: operation.selection.url });
			}
		});

		expect(result.summary).toMatchObject({ succeeded: 2, failed: 0 });
		expect(executed).toEqual([
			{
				targetId: 'show-77:poster:root:root',
				url: 'https://image.tmdb.org/t/p/original/legacy-root.jpg'
			},
			{
				targetId: 'show-77:title_card:1:2',
				url: 'https://image.tmdb.org/t/p/original/legacy-child.jpg'
			}
		]);
	});

	it('preserves revision-zero and timestamp CAS for captured v1 plans', async () => {
		const advancedRevision = migratedTmdbData();
		advancedRevision.item.identity.selectionRevision = 1;
		await expect(
			assertApplyPlanFresh(capturedTmdbPlan(), freshnessDependencies(advancedRevision))
		).rejects.toMatchObject({ code: 'plan_stale' });

		const restaged = migratedTmdbData();
		restaged.item.identity.selectionUpdatedAt = '2026-07-10T11:06:00.000Z';
		await expect(
			assertApplyPlanFresh(capturedTmdbPlan(), freshnessDependencies(restaged))
		).rejects.toMatchObject({ code: 'plan_stale' });
	});

	it('rejects TMDB compatibility when raw root or child provenance is not the migrated shape', async () => {
		const changedRoot = migratedTmdbData();
		changedRoot.storedSelections[0].persisted!.candidateId = 701;
		await expect(
			assertApplyPlanFresh(capturedTmdbPlan(), freshnessDependencies(changedRoot))
		).rejects.toMatchObject({ code: 'plan_stale' });

		const changedChild = migratedTmdbData();
		changedChild.storedSelections[1].persisted!.provider = 'custom';
		await expect(
			assertApplyPlanFresh(capturedTmdbPlan(), freshnessDependencies(changedChild))
		).rejects.toMatchObject({ code: 'plan_stale' });

		const changedCandidate = migratedTmdbData();
		changedCandidate.candidates[1].url = 'https://image.tmdb.org/t/p/w500/different-child.jpg';
		await expect(
			assertApplyPlanFresh(capturedTmdbPlan(), freshnessDependencies(changedCandidate))
		).rejects.toMatchObject({ code: 'plan_stale' });
	});

	it('rejects custom compatibility when provider provenance or URL changed', async () => {
		const changedProvider = migratedCustomData();
		changedProvider.storedSelections[0].persisted!.provider = 'tmdb';
		await expect(
			assertApplyPlanFresh(capturedCustomPlan(), freshnessDependencies(changedProvider))
		).rejects.toMatchObject({ code: 'plan_stale' });

		const changedUrl = migratedCustomData();
		changedUrl.storedSelections[0].url = 'https://custom.example/replaced.jpg';
		await expect(
			assertApplyPlanFresh(capturedCustomPlan(), freshnessDependencies(changedUrl))
		).rejects.toMatchObject({ code: 'plan_stale' });
	});
});

describe('frozen selection structural integrity', () => {
	it('rejects a selection whose provider no longer matches its own fingerprint', () => {
		const payload = capturedTmdbPlan();
		payload.items[0].selections[0].provider = 'mediux';
		expect(() => assertApplyPlanPayload(payload)).toThrowError(ApplyPlanValidationError);
	});

	it('rejects an operation URL even when its nested selection and operation ids are rehashed', () => {
		const payload = capturedTmdbPlan();
		payload.items[0].operations[0].selection.url =
			'https://image.tmdb.org/t/p/original/other-root.jpg';
		rehashOperationSelection(payload, 0);
		expect(() => assertApplyPlanPayload(payload)).toThrowError(ApplyPlanValidationError);
	});

	it('rejects an operation provider even when its nested selection and operation ids are rehashed', () => {
		const payload = capturedTmdbPlan();
		payload.items[0].operations[0].selection.provider = 'mediux';
		rehashOperationSelection(payload, 0);
		expect(() => assertApplyPlanPayload(payload)).toThrowError(ApplyPlanValidationError);
	});

	it('rejects a cross-item operation selection even when its nested ids are rehashed', () => {
		const payload = capturedTmdbPlan();
		payload.items[0].operations[1].selection.sourceItem.mediaItemId = 78;
		rehashOperationSelection(payload, 1);
		expect(() => assertApplyPlanPayload(payload)).toThrowError(ApplyPlanValidationError);
	});
});
