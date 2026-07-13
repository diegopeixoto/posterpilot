import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/db', async () => {
	const { createClient } = await import('@libsql/client');
	const { drizzle } = await import('drizzle-orm/libsql');
	const schema = await import('$lib/server/db/schema');
	const client = createClient({ url: ':memory:' });
	await client.execute(`
		CREATE TABLE operation_plans (
			id TEXT PRIMARY KEY NOT NULL,
			kind TEXT NOT NULL,
			server_instance_id TEXT,
			library_section_key TEXT,
			payload TEXT NOT NULL,
			digest TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			expires_at INTEGER NOT NULL,
			consumed_at INTEGER
		)
	`);
	return { db: drizzle(client, { schema }), migrateDb: async () => undefined };
});

import { db } from '$lib/server/db';
import { operationPlans } from '$lib/server/db/schema';
import { selectAutomaticArtwork } from '$lib/server/posters/automatic-selection';
import { DEFAULT_SCORE_WEIGHTS } from '$lib/server/posters/score';
import { createOperationPlanStore } from './operation-plan-store';
import {
	createApplyPlanner,
	type ApplyItemRef,
	type ApplyPlannerDependencies,
	type ApplyPlannerItemData,
	type PlannerCandidateSnapshot,
	type PlannerStoredSelection
} from './apply-planner';
import { applySlotKey, type ApplyPlanDestination, type ApplySlot } from './apply-plan';

const PLANNED_AT = new Date('2026-07-10T12:00:00.000Z');
let planId = 0;
const store = createOperationPlanStore(db, {
	clock: () => new Date(PLANNED_AT),
	generateId: () => `apply-plan-${++planId}`
});

function identity(
	serverInstanceId: string,
	mediaItemId: number,
	overrides: Partial<ApplyPlannerItemData['item']['identity']> = {}
): ApplyPlannerItemData['item']['identity'] {
	return {
		serverInstanceId,
		mediaItemId,
		librarySectionKey: 'movies',
		sourceId: `source-${serverInstanceId}-${mediaItemId}`,
		type: 'movie',
		tmdbId: `${mediaItemId}`,
		imdbId: `tt${mediaItemId}`,
		tvdbId: null,
		mediaType: 'movie',
		updatedAt: '2026-07-10T11:00:00.000Z',
		selectionUpdatedAt: '2026-07-10T11:05:00.000Z',
		...overrides
	};
}

function candidate(
	item: ApplyPlannerItemData['item']['identity'],
	candidateId: number,
	slot: ApplySlot,
	overrides: Partial<PlannerCandidateSnapshot> = {}
): PlannerCandidateSnapshot {
	return {
		candidateId,
		serverInstanceId: item.serverInstanceId,
		mediaItemId: item.mediaItemId,
		discoveryRunId: `run-${item.serverInstanceId}-${item.mediaItemId}`,
		provider: 'mediux',
		providerAssetId: `asset-${candidateId}`,
		setId: `set-${candidateId}`,
		setAuthor: 'curator',
		designFamily: 'violet-family',
		language: 'en',
		url: `https://images.example/${candidateId}.jpg`,
		slot,
		resolvedTmdbId: item.tmdbId,
		resolvedMediaType: item.mediaType,
		width: slot.kind === 'poster' ? 1000 : 1920,
		height: slot.kind === 'poster' ? 1500 : 1080,
		score: 2,
		active: true,
		stale: false,
		lastSeenAt: '2026-07-10T10:59:00.000Z',
		...overrides
	};
}

function itemData(
	serverInstanceId: string,
	mediaItemId: number,
	options: {
		identity?: Partial<ApplyPlannerItemData['item']['identity']>;
		candidates?: PlannerCandidateSnapshot[];
		storedSelections?: PlannerStoredSelection[];
		ignored?: boolean;
		sourceRemoved?: boolean;
	} = {}
): ApplyPlannerItemData {
	const itemIdentity = identity(serverInstanceId, mediaItemId, options.identity);
	const defaultCandidates = [
		candidate(itemIdentity, mediaItemId * 10 + 1, {
			kind: 'poster',
			season: null,
			episode: null
		}),
		candidate(itemIdentity, mediaItemId * 10 + 2, {
			kind: 'background',
			season: null,
			episode: null
		})
	];
	return {
		item: {
			identity: itemIdentity,
			ignored: options.ignored ?? false,
			sourceRemoved: options.sourceRemoved ?? false,
			discovery: {
				status: 'succeeded',
				runId: `run-${serverInstanceId}-${mediaItemId}`,
				completedAt: '2026-07-10T11:01:00.000Z'
			},
			currentSlots: [
				{
					slot: { kind: 'poster', season: null, episode: null },
					url: `https://server.example/${serverInstanceId}/${mediaItemId}/poster`,
					fingerprint: `current-poster-${serverInstanceId}-${mediaItemId}`,
					artworkVersion: 3,
					observedAt: '2026-07-10T10:00:00.000Z'
				},
				{
					slot: { kind: 'background', season: null, episode: null },
					url: null,
					fingerprint: null,
					artworkVersion: 3,
					observedAt: '2026-07-10T10:00:00.000Z'
				}
			]
		},
		candidates: options.candidates ?? defaultCandidates,
		storedSelections: options.storedSelections ?? []
	};
}

function automaticInputKind(slot: ApplySlot) {
	if (slot.kind === 'poster' && slot.season !== null) return 'season' as const;
	return slot.kind;
}

function createTestPlanner(items: ApplyPlannerItemData[]) {
	const byRef = new Map(
		items.map((data) => [
			`${data.item.identity.serverInstanceId}:${data.item.identity.mediaItemId}`,
			data
		])
	);
	const selectAutomatic = vi.fn(async (ref: ApplyItemRef, inputs) => {
		const data = byRef.get(`${ref.serverInstanceId}:${ref.mediaItemId}`);
		if (!data) throw new Error('missing item');
		return selectAutomaticArtwork(
			data.candidates.map((entry) => ({
				id: entry.candidateId,
				provider: entry.provider,
				setId: entry.setId,
				setAuthor: entry.setAuthor,
				url: entry.url,
				kind: automaticInputKind(entry.slot),
				season: entry.slot.season,
				episode: entry.slot.episode,
				width: entry.width,
				height: entry.height
			})),
			inputs
		);
	});
	const resolveDestinationSlots = vi.fn(
		async ({
			target,
			selections,
			destinations
		}: Parameters<ApplyPlannerDependencies['resolveDestinationSlots']>[0]) =>
			selections.flatMap((selection) =>
				destinations.map((destination: ApplyPlanDestination) => {
					const current = target.item.currentSlots.find(
						(state) => applySlotKey(state.slot) === applySlotKey(selection.slot)
					);
					return {
						destination,
						slot: selection.slot,
						targetId:
							destination === 'server'
								? `${target.item.identity.sourceId}:${applySlotKey(selection.slot)}`
								: `${target.item.identity.tmdbId}:${applySlotKey(selection.slot)}`,
						capability: 'supported' as const,
						current: {
							url: current?.url ?? null,
							fingerprint: current?.fingerprint ?? null,
							artworkVersion: current?.artworkVersion ?? null,
							observedAt: current?.observedAt ?? null,
							destinationFingerprint:
								destination === 'kometa'
									? `kometa-file-${target.item.identity.serverInstanceId}`
									: null
						},
						skipCode: null,
						parameters: {}
					};
				})
			)
	);
	const planner = createApplyPlanner({
		loadItemData: async (ref) => byRef.get(`${ref.serverInstanceId}:${ref.mediaItemId}`) ?? null,
		loadDefaults: async () => ({
			defaultMethod: 'plex',
			providerPriority: ['mediux', 'tmdb'],
			scoreWeights: DEFAULT_SCORE_WEIGHTS
		}),
		selectAutomatic,
		resolveDestinationSlots,
		persistPlan: (input) => store.create(input),
		clock: () => new Date(PLANNED_AT)
	});
	return { planner, selectAutomatic, resolveDestinationSlots };
}

beforeEach(async () => {
	await db.delete(operationPlans);
	planId = 0;
});

describe('unified apply planner', () => {
	it('persists a versioned single-item auto plan with exact slots and provenance', async () => {
		const data = itemData('server-a', 1);
		const { planner } = createTestPlanner([data]);
		const preview = await planner({
			context: { source: 'single' },
			targets: [{ serverInstanceId: 'server-a', mediaItemId: 1 }],
			selectionMode: 'auto',
			method: 'both'
		});

		expect(preview.plan).toMatchObject({
			id: 'apply-plan-1',
			kind: 'artwork_apply',
			serverInstanceId: 'server-a',
			librarySectionKey: 'movies'
		});
		expect(preview.payload).toMatchObject({
			version: 1,
			type: 'artwork_apply',
			plannedAt: PLANNED_AT.toISOString(),
			context: { source: 'single' },
			defaults: {
				configuredMethod: 'server',
				effectiveMethod: 'both',
				methodSource: 'explicit',
				selectionMode: 'auto'
			},
			summary: {
				itemCount: 1,
				actionableItemCount: 1,
				operationCount: 4,
				skipCount: 0,
				destinations: { server: 2, kometa: 2 }
			}
		});
		const item = preview.payload.items[0];
		expect(item.discovery).toMatchObject({
			runId: 'run-server-a-1',
			candidateIds: [11, 12],
			candidateCount: 2
		});
		expect(item.operations.map((operation) => operation.targetId)).toEqual([
			'1:background:root:root',
			'1:poster:root:root',
			'source-server-a-1:background:root:root',
			'source-server-a-1:poster:root:root'
		]);
		expect(item.operations[0].selection).toMatchObject({
			selectionSource: 'auto',
			provider: 'mediux',
			setAuthor: 'curator',
			discoveryRunId: 'run-server-a-1'
		});
		expect(item.operations.find((operation) => operation.slot.kind === 'poster')?.current).toEqual(
			expect.objectContaining({ fingerprint: 'current-poster-server-a-1' })
		);
		expect(item.sourceFingerprint).toMatch(/^[0-9a-f]{64}$/);
		expect(preview.payload.sourceFingerprint).toMatch(/^[0-9a-f]{64}$/);
		expect((await store.load(preview.plan!.id))?.payload).toEqual(preview.payload);
	});

	it('uses persisted root and child selections for review context without auto-selecting', async () => {
		const base = itemData('server-a', 2, {
			identity: { type: 'show', mediaType: 'tv' }
		});
		base.storedSelections = [
			{
				slot: { kind: 'poster', season: null, episode: null },
				candidateId: 21,
				url: 'https://images.example/21.jpg',
				provider: null,
				setId: 'set-21',
				setAuthor: null
			},
			{
				slot: { kind: 'title_card', season: 1, episode: 2 },
				candidateId: null,
				url: 'https://custom.example/s01e02.jpg',
				provider: 'custom',
				setId: null,
				setAuthor: null
			}
		];
		base.item.currentSlots.push({
			slot: { kind: 'title_card', season: 1, episode: 2 },
			url: 'https://server.example/old-s01e02.jpg',
			fingerprint: 'title-card-before',
			artworkVersion: 4,
			observedAt: '2026-07-10T10:30:00.000Z'
		});
		const { planner, selectAutomatic } = createTestPlanner([base]);
		const preview = await planner({
			context: {
				source: 'review',
				reviewViewId: 'ready',
				reviewContextFingerprint: 'review-fingerprint'
			},
			targets: [{ serverInstanceId: 'server-a', mediaItemId: 2 }],
			selectionMode: 'stored'
		});

		expect(selectAutomatic).not.toHaveBeenCalled();
		expect(preview.payload.context).toEqual({
			source: 'review',
			reviewViewId: 'ready',
			reviewContextFingerprint: 'review-fingerprint'
		});
		expect(preview.payload.defaults).toMatchObject({
			effectiveMethod: 'server',
			methodSource: 'configured_default',
			selectionMode: 'stored'
		});
		expect(preview.payload.items[0].operations.map((operation) => operation.slot)).toEqual([
			{ kind: 'poster', season: null, episode: null },
			{ kind: 'title_card', season: 1, episode: 2 }
		]);
		expect(preview.payload.items[0].operations[0].selection).toMatchObject({
			candidateId: 21,
			provider: 'mediux',
			selectionSource: 'stored'
		});
		expect(
			preview.payload.items[0].operations.find((operation) => operation.slot.kind === 'title_card')
		).toMatchObject({
			targetId: 'source-server-a-2:title_card:1:2',
			current: { fingerprint: 'title-card-before', artworkVersion: 4 },
			selection: { candidateId: null, provider: 'custom', selectionSource: 'stored' }
		});
		expect(preview.payload.items[0].skips).toContainEqual({
			destination: 'server',
			slot: { kind: 'background', season: null, episode: null },
			code: 'no_stored_selection',
			parameters: {}
		});
	});

	it('freezes bulk target ordering, result fingerprint, and ignored-item skips', async () => {
		const first = itemData('server-a', 3);
		const ignored = itemData('server-a', 4, { ignored: true });
		const { planner, selectAutomatic } = createTestPlanner([first, ignored]);
		const preview = await planner({
			context: { source: 'bulk', resultSetFingerprint: 'query-v1' },
			targets: [
				{ serverInstanceId: 'server-a', mediaItemId: 4 },
				{ serverInstanceId: 'server-a', mediaItemId: 3 }
			],
			selectionMode: 'auto',
			method: 'server'
		});

		expect(preview.payload.context).toEqual({
			source: 'bulk',
			resultSetFingerprint: 'query-v1'
		});
		expect(preview.payload.scope.targetItemIds).toEqual([3, 4]);
		expect(preview.payload.items[1].skips).toEqual([
			{ destination: null, slot: null, code: 'item_ignored', parameters: {} }
		]);
		expect(preview.payload.summary).toMatchObject({
			itemCount: 2,
			actionableItemCount: 1,
			operationCount: 2,
			skipCount: 1
		});
		expect(selectAutomatic).toHaveBeenCalledTimes(1);
	});

	it('preserves collection identity and membership fingerprint in one same-server plan', async () => {
		const first = itemData('server-a', 5);
		const second = itemData('server-a', 6);
		const { planner } = createTestPlanner([first, second]);
		const preview = await planner({
			context: {
				source: 'collection',
				collectionId: 'collection-42',
				membershipFingerprint: 'members-v3'
			},
			targets: [
				{ serverInstanceId: 'server-a', mediaItemId: 5 },
				{ serverInstanceId: 'server-a', mediaItemId: 6 }
			],
			selectionMode: 'auto',
			method: 'server'
		});

		expect(preview.payload.context).toEqual({
			source: 'collection',
			collectionId: 'collection-42',
			membershipFingerprint: 'members-v3'
		});
		expect(preview.plan).toMatchObject({ serverInstanceId: 'server-a' });
		expect(preview.payload.summary.operationCount).toBe(4);
	});

	it('rejects a collection request without a frozen membership fingerprint', async () => {
		const first = itemData('server-a', 5);
		const { planner } = createTestPlanner([first]);
		await expect(
			planner({
				context: { source: 'collection', collectionId: 'collection-42' },
				targets: [{ serverInstanceId: 'server-a', mediaItemId: 5 }],
				selectionMode: 'stored',
				method: 'server'
			})
		).rejects.toMatchObject({ code: 'invalid_request' });
	});

	it('uses source artwork for explicitly matched cross-server destinations', async () => {
		const source = itemData('source-server', 7, { identity: { tmdbId: '777' } });
		const destinationA = itemData('server-b', 8, { identity: { tmdbId: '777' } });
		const destinationB = itemData('server-c', 9, { identity: { tmdbId: '777' } });
		const { planner, selectAutomatic } = createTestPlanner([source, destinationA, destinationB]);
		const preview = await planner({
			context: {
				source: 'cross_server',
				sourceItem: { serverInstanceId: 'source-server', mediaItemId: 7 },
				match: { namespace: 'tmdb', value: '777' }
			},
			targets: [
				{ serverInstanceId: 'server-b', mediaItemId: 8 },
				{ serverInstanceId: 'server-c', mediaItemId: 9 }
			],
			selectionMode: 'auto',
			method: 'server'
		});

		expect(preview.payload.context).toMatchObject({
			source: 'cross_server',
			match: { namespace: 'tmdb', value: '777' },
			sourceItem: { serverInstanceId: 'source-server', mediaItemId: 7 }
		});
		expect(preview.payload.items.every((item) => item.selectionFrom.mediaItemId === 7)).toBe(true);
		expect(
			preview.payload.items
				.flatMap((item) => item.operations)
				.every((operation) => operation.selection.sourceItem.mediaItemId === 7)
		).toBe(true);
		expect(preview.plan).toMatchObject({ serverInstanceId: null, librarySectionKey: null });
		expect(selectAutomatic).toHaveBeenCalledTimes(1);
		expect(selectAutomatic).toHaveBeenNthCalledWith(
			1,
			{ serverInstanceId: 'source-server', mediaItemId: 7 },
			expect.any(Object)
		);
	});

	it('rejects a title-only cross-server match', async () => {
		const source = itemData('source-server', 10, { identity: { tmdbId: '1000' } });
		const wrong = itemData('server-b', 11, { identity: { tmdbId: 'different' } });
		const { planner } = createTestPlanner([source, wrong]);

		await expect(
			planner({
				context: {
					source: 'cross_server',
					sourceItem: { serverInstanceId: 'source-server', mediaItemId: 10 },
					match: { namespace: 'tmdb', value: '1000' }
				},
				targets: [{ serverInstanceId: 'server-b', mediaItemId: 11 }],
				selectionMode: 'auto',
				method: 'server'
			})
		).rejects.toMatchObject({ code: 'external_identity_mismatch' });
		expect(await db.select().from(operationPlans)).toEqual([]);
	});

	it('returns an unpersisted empty preview when no automatic candidate exists', async () => {
		const empty = itemData('server-a', 12, { candidates: [] });
		const { planner, resolveDestinationSlots } = createTestPlanner([empty]);
		const preview = await planner({
			context: { source: 'single' },
			targets: [{ serverInstanceId: 'server-a', mediaItemId: 12 }],
			selectionMode: 'auto',
			method: 'both'
		});

		expect(preview.plan).toBeNull();
		expect(preview.payload.summary).toEqual({
			itemCount: 1,
			actionableItemCount: 0,
			operationCount: 0,
			skipCount: 4,
			destinations: { server: 0, kometa: 0 }
		});
		expect(resolveDestinationSlots).not.toHaveBeenCalled();
		expect(await db.select().from(operationPlans)).toEqual([]);
	});

	it('binds the source fingerprint to the current destination artwork identity', async () => {
		const data = itemData('server-a', 16);
		const first = await createTestPlanner([data]).planner({
			context: { source: 'single' },
			targets: [{ serverInstanceId: 'server-a', mediaItemId: 16 }],
			selectionMode: 'auto',
			method: 'server'
		});
		data.item.currentSlots[0] = {
			...data.item.currentSlots[0],
			fingerprint: 'externally-changed-poster',
			artworkVersion: 4
		};
		const second = await createTestPlanner([data]).planner({
			context: { source: 'single' },
			targets: [{ serverInstanceId: 'server-a', mediaItemId: 16 }],
			selectionMode: 'auto',
			method: 'server'
		});

		expect(second.payload.items[0].currentStateFingerprint).not.toBe(
			first.payload.items[0].currentStateFingerprint
		);
		expect(second.payload.sourceFingerprint).not.toBe(first.payload.sourceFingerprint);
	});

	it('rejects mixed-server targets outside the explicit cross-server context', async () => {
		const { planner } = createTestPlanner([itemData('server-a', 13), itemData('server-b', 14)]);
		await expect(
			planner({
				context: { source: 'bulk', resultSetFingerprint: null },
				targets: [
					{ serverInstanceId: 'server-a', mediaItemId: 13 },
					{ serverInstanceId: 'server-b', mediaItemId: 14 }
				],
				selectionMode: 'auto'
			})
		).rejects.toMatchObject({ code: 'scope_mismatch' });
	});

	it('rejects an automatic winner that is not in the frozen active discovery snapshot', async () => {
		const data = itemData('server-a', 15);
		const byRef = new Map([['server-a:15', data]]);
		const planner = createApplyPlanner({
			loadItemData: async (ref) => byRef.get(`${ref.serverInstanceId}:${ref.mediaItemId}`) ?? null,
			loadDefaults: async () => ({
				defaultMethod: 'server',
				providerPriority: ['mediux'],
				scoreWeights: DEFAULT_SCORE_WEIGHTS
			}),
			selectAutomatic: async () => ({
				poster: {
					candidateId: 999,
					url: 'https://changed.example/999.jpg',
					provider: 'mediux',
					setId: 'changed',
					setAuthor: null,
					score: 10,
					width: 1000,
					height: 1500,
					slot: { kind: 'poster', season: null, episode: null }
				},
				background: null,
				children: []
			}),
			resolveDestinationSlots: async () => [],
			persistPlan: (input) => store.create(input),
			clock: () => new Date(PLANNED_AT)
		});

		await expect(
			planner({
				context: { source: 'single' },
				targets: [{ serverInstanceId: 'server-a', mediaItemId: 15 }],
				selectionMode: 'auto'
			})
		).rejects.toMatchObject({ code: 'automatic_selection_changed' });
	});
});
