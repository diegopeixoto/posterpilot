import { describe, expect, it, vi } from 'vitest';
import type { MediaServer } from '$lib/server/media-server';

vi.mock('$lib/server/db', () => ({ db: {} }));

import { canonicalJsonDigest } from './canonical-json';
import {
	confirmCrossServerApplyPlan,
	hasExactCrossServerIdentity,
	previewCrossServerApplyPlan,
	resolveCrossServerApplyMatches,
	type CrossServerCandidateLookup,
	type CrossServerMatchRepository
} from './cross-server-apply';
import { executeFrozenApplyPlan } from './apply-executor';
import type { ApplyItemIdentity, ApplyPlanPayloadV1 } from './apply-plan';
import {
	createApplyPlanner,
	type ApplyItemRef,
	type ApplyPlannerDependencies,
	type ApplyPlannerItemData
} from './apply-planner';
import {
	OperationPlanError,
	type CreateOperationPlanInput,
	type OperationPlan,
	type OperationPlanExpectations
} from './operation-plan-store';

const NOW = new Date('2026-07-11T18:00:00.000Z');

function identity(
	serverInstanceId: string,
	mediaItemId: number,
	overrides: Partial<ApplyItemIdentity> = {}
): ApplyItemIdentity {
	return {
		serverInstanceId,
		mediaItemId,
		librarySectionKey: 'movies',
		sourceId: `source-${serverInstanceId}-${mediaItemId}`,
		type: 'movie',
		tmdbId: '777',
		imdbId: 'tt0000777',
		tvdbId: null,
		mediaType: 'movie',
		updatedAt: NOW.toISOString(),
		selectionUpdatedAt: NOW.toISOString(),
		...overrides
	};
}

function repository(input: {
	source: ApplyItemIdentity;
	lookups: Record<string, CrossServerCandidateLookup>;
}): CrossServerMatchRepository {
	return {
		loadItem: vi.fn(async (ref) =>
			ref.serverInstanceId === input.source.serverInstanceId &&
			ref.mediaItemId === input.source.mediaItemId
				? input.source
				: null
		),
		findExactCandidates: vi.fn(
			async ({ serverInstanceId }) =>
				input.lookups[serverInstanceId] ?? { serverState: 'missing', items: [] }
		)
	};
}

describe('explicit cross-server matching', () => {
	it('resolves exact matches and freezes independent no-match, ambiguity, and disabled skips', async () => {
		const source = identity('source-server', 1);
		const repo = repository({
			source,
			lookups: {
				'server-b': { serverState: 'enabled', items: [identity('server-b', 2)] },
				'server-c': { serverState: 'enabled', items: [] },
				'server-d': {
					serverState: 'enabled',
					items: [identity('server-d', 4), identity('server-d', 3)]
				},
				'server-e': { serverState: 'disabled', items: [] }
			}
		});

		const resolved = await resolveCrossServerApplyMatches(
			{
				sourceItem: { serverInstanceId: 'source-server', mediaItemId: 1 },
				destinationServerInstanceIds: ['server-e', 'server-d', 'server-b', 'server-c'],
				match: { namespace: 'tmdb', value: '777' }
			},
			repo
		);

		expect(resolved.destinationServerInstanceIds).toEqual([
			'server-b',
			'server-c',
			'server-d',
			'server-e'
		]);
		expect(resolved.resolutions).toEqual([
			{ serverInstanceId: 'server-b', status: 'matched', candidateItemIds: [2] },
			{ serverInstanceId: 'server-c', status: 'not_found', candidateItemIds: [] },
			{ serverInstanceId: 'server-d', status: 'ambiguous', candidateItemIds: [3, 4] },
			{ serverInstanceId: 'server-e', status: 'server_disabled', candidateItemIds: [] }
		]);
		expect(resolved.targets).toEqual([{ serverInstanceId: 'server-b', mediaItemId: 2 }]);
	});

	it('never treats a shared provider source id or title-like value as an external match', () => {
		const source = identity('source-server', 1, { sourceId: 'Same Title' });
		const titleOnly = identity('server-b', 2, {
			sourceId: 'Same Title',
			tmdbId: '999',
			imdbId: 'tt0000999'
		});

		expect(
			hasExactCrossServerIdentity(source, titleOnly, { namespace: 'tmdb', value: '777' })
		).toBe(false);
		expect(
			hasExactCrossServerIdentity(source, titleOnly, {
				namespace: 'imdb',
				value: 'tt0000777'
			})
		).toBe(false);
	});

	it('rejects implicit, duplicate, and source-as-destination server scopes', async () => {
		const source = identity('source-server', 1);
		const repo = repository({ source, lookups: {} });
		await expect(
			resolveCrossServerApplyMatches(
				{
					sourceItem: { serverInstanceId: 'source-server', mediaItemId: 1 },
					destinationServerInstanceIds: [],
					match: { namespace: 'tmdb', value: '777' }
				},
				repo
			)
		).rejects.toMatchObject({ code: 'invalid_request' });
		await expect(
			resolveCrossServerApplyMatches(
				{
					sourceItem: { serverInstanceId: 'source-server', mediaItemId: 1 },
					destinationServerInstanceIds: ['server-b', 'server-b'],
					match: { namespace: 'tmdb', value: '777' }
				},
				repo
			)
		).rejects.toMatchObject({ code: 'invalid_request' });
		await expect(
			resolveCrossServerApplyMatches(
				{
					sourceItem: { serverInstanceId: 'source-server', mediaItemId: 1 },
					destinationServerInstanceIds: ['source-server'],
					match: { namespace: 'tmdb', value: '777' }
				},
				repo
			)
		).rejects.toMatchObject({ code: 'invalid_request' });
	});

	it('requires TMDB media type so equal numeric ids cannot cross movie/TV namespaces', async () => {
		const source = identity('source-server', 1, { mediaType: null });
		const repo = repository({ source, lookups: {} });
		await expect(
			resolveCrossServerApplyMatches(
				{
					sourceItem: { serverInstanceId: 'source-server', mediaItemId: 1 },
					destinationServerInstanceIds: ['server-b'],
					match: { namespace: 'tmdb', value: '777' }
				},
				repo
			)
		).rejects.toMatchObject({ code: 'external_identity_mismatch' });
	});
});

class MemoryPlanStore {
	plan: OperationPlan<ApplyPlanPayloadV1> | null = null;

	async create(
		input: CreateOperationPlanInput<ApplyPlanPayloadV1>
	): Promise<OperationPlan<ApplyPlanPayloadV1>> {
		const digest = canonicalJsonDigest(input.payload).digest;
		this.plan = {
			id: 'cross-plan-1',
			kind: input.kind,
			serverInstanceId: input.serverInstanceId ?? null,
			librarySectionKey: input.librarySectionKey ?? null,
			payload: structuredClone(input.payload),
			digest,
			createdAt: NOW,
			expiresAt: new Date(NOW.getTime() + 60_000),
			consumedAt: null
		};
		return this.plan;
	}

	async validate<T>(
		id: string,
		expected: OperationPlanExpectations = {}
	): Promise<OperationPlan<T>> {
		if (!this.plan || this.plan.id !== id) throw new OperationPlanError('plan_not_found', id);
		if (this.plan.consumedAt) throw new OperationPlanError('plan_consumed', id);
		if (expected.kind !== undefined && expected.kind !== this.plan.kind) {
			throw new OperationPlanError('plan_kind_mismatch', id);
		}
		if (expected.digest !== undefined && expected.digest !== this.plan.digest) {
			throw new OperationPlanError('plan_digest_mismatch', id);
		}
		if (
			Object.hasOwn(expected, 'serverInstanceId') &&
			expected.serverInstanceId !== this.plan.serverInstanceId
		) {
			throw new OperationPlanError('plan_scope_mismatch', id);
		}
		return this.plan as OperationPlan<T>;
	}

	async consume<T>(
		id: string,
		expected: OperationPlanExpectations = {}
	): Promise<OperationPlan<T>> {
		const plan = await this.validate<T>(id, expected);
		this.plan = { ...this.plan!, consumedAt: NOW };
		return { ...plan, consumedAt: NOW };
	}
}

function itemData(item: ApplyItemIdentity, source = false): ApplyPlannerItemData {
	return {
		item: {
			identity: item,
			ignored: false,
			sourceRemoved: false,
			discovery: { status: 'succeeded', runId: 'run-1', completedAt: NOW.toISOString() },
			currentSlots: [
				{
					slot: { kind: 'poster', season: null, episode: null },
					url: `https://server.invalid/${item.serverInstanceId}/poster`,
					fingerprint: `current-${item.serverInstanceId}`,
					artworkVersion: 1,
					observedAt: NOW.toISOString()
				}
			]
		},
		candidates: [],
		storedSelections: source
			? [
					{
						slot: { kind: 'poster', season: null, episode: null },
						candidateId: null,
						url: 'https://images.invalid/frozen-source.jpg',
						provider: 'custom',
						setId: null,
						setAuthor: null
					}
				]
			: []
	};
}

function crossFixture(destinationIds = ['server-b', 'server-c']) {
	const source = identity('source-server', 1);
	const destinations = destinationIds.map((serverId, index) => identity(serverId, index + 2));
	const data = new Map<string, ApplyPlannerItemData>([
		['source-server:1', itemData(source, true)],
		...destinations.map(
			(item) => [`${item.serverInstanceId}:${item.mediaItemId}`, itemData(item)] as const
		)
	]);
	const lookups: Record<string, CrossServerCandidateLookup> = Object.fromEntries(
		destinations.map((item) => [item.serverInstanceId, { serverState: 'enabled', items: [item] }])
	);
	const matchRepository = repository({ source, lookups });
	const store = new MemoryPlanStore();
	const loadItemData = vi.fn(
		async (ref: ApplyItemRef) => data.get(`${ref.serverInstanceId}:${ref.mediaItemId}`) ?? null
	);
	const resolveDestinationSlotsImplementation: ApplyPlannerDependencies['resolveDestinationSlots'] =
		async ({ target, selections, destinations: requested }) =>
			requested.flatMap((destination) =>
				selections.map((selection) => ({
					destination,
					slot: selection.slot,
					targetId:
						destination === 'server'
							? target.item.identity.sourceId
							: `kometa:${target.item.identity.tmdbId}`,
					capability: 'supported' as const,
					current: {
						url: target.item.currentSlots[0]?.url ?? null,
						fingerprint: target.item.currentSlots[0]?.fingerprint ?? null,
						artworkVersion: target.item.currentSlots[0]?.artworkVersion ?? null,
						observedAt: target.item.currentSlots[0]?.observedAt ?? null,
						destinationFingerprint: `destination-${target.item.identity.serverInstanceId}`
					},
					skipCode: null,
					parameters: {}
				}))
			);
	const resolveDestinationSlots = vi.fn(resolveDestinationSlotsImplementation);
	const planner = createApplyPlanner({
		loadItemData,
		loadDefaults: async () => ({
			defaultMethod: 'server',
			providerPriority: ['mediux'],
			scoreWeights: { providerWeights: {}, resolutionWeight: 1, aspectWeight: 1 }
		}),
		selectAutomatic: vi.fn(),
		resolveDestinationSlots,
		persistPlan: (input) => store.create(input),
		clock: () => NOW
	});
	return {
		source,
		destinations,
		data,
		lookups,
		matchRepository,
		store,
		loadItemData,
		resolveDestinationSlots,
		planner
	};
}

async function previewFixture(fixture: ReturnType<typeof crossFixture>) {
	return previewCrossServerApplyPlan(
		{
			sourceItem: { serverInstanceId: 'source-server', mediaItemId: 1 },
			destinationServerInstanceIds: fixture.destinations.map((item) => item.serverInstanceId),
			match: { namespace: 'tmdb', value: '777' },
			selectionMode: 'stored',
			method: 'server'
		},
		{ matchRepository: fixture.matchRepository, planApply: fixture.planner }
	);
}

describe('cross-server preview, confirmation, and execution', () => {
	it('returns a non-confirmable exact skip preview when no destination has one unique match', async () => {
		const fixture = crossFixture(['server-b']);
		fixture.lookups['server-b'] = { serverState: 'enabled', items: [] };

		const preview = await previewFixture(fixture);

		expect(preview.plan).toBeNull();
		expect(preview.payload.items).toEqual([]);
		expect(preview.payload.context).toMatchObject({
			destinationServerInstanceIds: ['server-b'],
			resolutions: [{ serverInstanceId: 'server-b', status: 'not_found', candidateItemIds: [] }]
		});
		expect(preview.payload.summary).toMatchObject({ operationCount: 0, actionableItemCount: 0 });
	});

	it('binds explicit match decisions into a single-use exact plan and rejects replay', async () => {
		const fixture = crossFixture(['server-b']);
		const preview = await previewFixture(fixture);
		expect(preview.plan).toMatchObject({ serverInstanceId: null });
		expect(preview.payload.context).toMatchObject({
			source: 'cross_server',
			destinationServerInstanceIds: ['server-b'],
			resolutions: [{ serverInstanceId: 'server-b', status: 'matched', candidateItemIds: [2] }]
		});
		const enqueue = vi.fn(async () => 41);
		const request = {
			planId: preview.plan!.id,
			digest: preview.plan!.digest,
			sourceItem: { serverInstanceId: 'source-server', mediaItemId: 1 },
			destinationServerInstanceIds: ['server-b'],
			match: { namespace: 'tmdb' as const, value: '777' }
		};
		const dependencies = {
			matchRepository: fixture.matchRepository,
			store: fixture.store,
			loadItemData: fixture.loadItemData,
			resolveDestinationSlots: fixture.resolveDestinationSlots,
			enqueue
		};

		await expect(confirmCrossServerApplyPlan(request, dependencies)).resolves.toEqual({
			jobId: 41,
			planId: 'cross-plan-1',
			digest: preview.plan!.digest
		});
		await expect(confirmCrossServerApplyPlan(request, dependencies)).rejects.toMatchObject({
			code: 'plan_consumed'
		});
		expect(enqueue).toHaveBeenCalledTimes(1);
	});

	it('rejects stale confirmation when an exact match disappears or ambiguity changes', async () => {
		const fixture = crossFixture(['server-b']);
		const preview = await previewFixture(fixture);
		fixture.lookups['server-b'] = { serverState: 'enabled', items: [] };
		const enqueue = vi.fn(async () => 42);

		await expect(
			confirmCrossServerApplyPlan(
				{
					planId: preview.plan!.id,
					digest: preview.plan!.digest,
					sourceItem: { serverInstanceId: 'source-server', mediaItemId: 1 },
					destinationServerInstanceIds: ['server-b'],
					match: { namespace: 'tmdb', value: '777' }
				},
				{
					matchRepository: fixture.matchRepository,
					store: fixture.store,
					loadItemData: fixture.loadItemData,
					resolveDestinationSlots: fixture.resolveDestinationSlots,
					enqueue
				}
			)
		).rejects.toMatchObject({ code: 'plan_stale' });
		expect(enqueue).not.toHaveBeenCalled();
		expect(fixture.store.plan?.consumedAt).toBeNull();
	});

	it('continues another named server after one destination fails and returns isolated results', async () => {
		const fixture = crossFixture();
		const preview = await previewFixture(fixture);
		const applied = vi.fn();
		const server = {
			type: 'plex',
			identity: { instanceId: 'server-b', name: 'B', type: 'plex' },
			capabilities: {},
			applyPosterUrl: applied
		} as unknown as MediaServer;

		const result = await executeFrozenApplyPlan(
			preview.plan!.id,
			preview.plan!.digest,
			preview.payload,
			{
				serverRegistry: {
					resolve: vi.fn(async (serverInstanceId: string) => {
						if (serverInstanceId === 'server-c') throw new Error('server unavailable');
						return { serverInstanceId, server, fingerprint: 'binding-b' };
					})
				},
				writeKometa: vi.fn()
			}
		);

		expect(result.summary).toMatchObject({ succeeded: 1, failed: 1 });
		expect(result.crossServer).toMatchObject({
			sourceItem: { serverInstanceId: 'source-server', mediaItemId: 1 },
			resolutions: [
				{ serverInstanceId: 'server-b', status: 'matched', candidateItemIds: [2] },
				{ serverInstanceId: 'server-c', status: 'matched', candidateItemIds: [3] }
			]
		});
		expect(result.items).toEqual([
			expect.objectContaining({
				serverInstanceId: 'server-b',
				mediaItemId: 2,
				operations: [expect.objectContaining({ status: 'success' })]
			}),
			expect.objectContaining({
				serverInstanceId: 'server-c',
				mediaItemId: 3,
				operations: [expect.objectContaining({ status: 'failed' })]
			})
		]);
		expect(applied).toHaveBeenCalledTimes(1);
		const safeResult = JSON.stringify(result);
		expect(safeResult).not.toContain('frozen-source.jpg');
	});

	it('retains non-actionable destination decisions in the terminal result summary', async () => {
		const fixture = crossFixture();
		fixture.lookups['server-c'] = { serverState: 'enabled', items: [] };
		const preview = await previewFixture(fixture);
		const server = {
			type: 'plex',
			identity: { instanceId: 'server-b', name: 'B', type: 'plex' },
			capabilities: {},
			applyPosterUrl: vi.fn()
		} as unknown as MediaServer;

		const result = await executeFrozenApplyPlan(
			preview.plan!.id,
			preview.plan!.digest,
			preview.payload,
			{
				serverRegistry: {
					resolve: vi.fn(async () => ({
						serverInstanceId: 'server-b',
						server,
						fingerprint: 'binding-b'
					}))
				},
				writeKometa: vi.fn()
			}
		);

		expect(result.summary).toMatchObject({ succeeded: 1, failed: 0, skipped: 2 });
		expect(result.crossServer?.resolutions).toEqual([
			{ serverInstanceId: 'server-b', status: 'matched', candidateItemIds: [2] },
			{ serverInstanceId: 'server-c', status: 'not_found', candidateItemIds: [] }
		]);
		expect(result.items).toHaveLength(1);
		expect(result.items[0].skips).toHaveLength(1);
	});
});
