import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ServerArtwork } from '$lib/server/media-server';
import { canonicalJsonDigest } from '$lib/server/plans/canonical-json';
import type { OperationPlan } from '$lib/server/plans/operation-plan-store';
import type { NativeCollectionArtworkCandidate } from './native-artwork-candidates';
import type { NativeCollectionArtworkContext } from './native-artwork-context';
import {
	createNativeCollectionArtworkService,
	NativeCollectionArtworkServiceError,
	type NativeArtworkPlanStore
} from './native-artwork-service';

const NOW = new Date('2026-07-11T12:00:00.000Z');

function sha(value: string | Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}

function bytes(value: string): ArrayBuffer {
	return new TextEncoder().encode(value).buffer;
}

function artwork(kind: 'poster' | 'background', value: string): ServerArtwork {
	return {
		kind,
		url: `https://media.safe/${kind}`,
		identity: `${kind}:${value}`,
		data: bytes(value),
		contentType: 'image/jpeg'
	};
}

function candidate(kind: 'poster' | 'background', path: string): NativeCollectionArtworkCandidate {
	const url = `https://image.tmdb.org/t/p/original/${path}.jpg`;
	return {
		id: sha(`${kind}:${path}`),
		tmdbCollectionId: '900',
		provider: 'tmdb',
		providerAssetId: `/${path}.jpg`,
		kind,
		language: 'en',
		width: kind === 'poster' ? 2000 : 3840,
		height: kind === 'poster' ? 3000 : 2160,
		score: 1.2,
		url,
		previewUrl: `https://image.tmdb.org/t/p/w500/${path}.jpg`,
		fingerprint: sha(url)
	};
}

function inMemoryPlans(): NativeArtworkPlanStore & { consumed: string[] } {
	const plans = new Map<string, OperationPlan<unknown>>();
	const consumed: string[] = [];
	return {
		consumed,
		async create<T>(input: {
			kind: string;
			payload: T;
			serverInstanceId?: string | null;
			ttlMs?: number;
		}) {
			const digest = canonicalJsonDigest(input.payload).digest;
			const plan: OperationPlan<T> = {
				id: `plan-${plans.size + 1}`,
				kind: input.kind,
				serverInstanceId: input.serverInstanceId ?? null,
				librarySectionKey: null,
				payload: input.payload,
				digest,
				createdAt: NOW,
				expiresAt: new Date(NOW.getTime() + (input.ttlMs ?? 900_000)),
				consumedAt: null
			};
			plans.set(plan.id, plan as OperationPlan<unknown>);
			return plan;
		},
		async validate<T>(id: string, expectations: Record<string, unknown> = {}) {
			const plan = plans.get(id);
			if (!plan) throw Object.assign(new Error('plan_not_found'), { code: 'plan_not_found' });
			if (plan.consumedAt)
				throw Object.assign(new Error('plan_consumed'), { code: 'plan_consumed' });
			if (expectations.kind && plan.kind !== expectations.kind) throw new Error('kind');
			if (expectations.digest && plan.digest !== expectations.digest) throw new Error('digest');
			if (
				Object.hasOwn(expectations, 'serverInstanceId') &&
				plan.serverInstanceId !== expectations.serverInstanceId
			) {
				throw new Error('scope');
			}
			if (
				Object.hasOwn(expectations, 'payload') &&
				canonicalJsonDigest(expectations.payload).digest !== plan.digest
			) {
				throw new Error('payload');
			}
			return plan as OperationPlan<T>;
		},
		async consume<T>(id: string, expectations: Record<string, unknown> = {}) {
			const plan = await this.validate<T>(id, expectations);
			plan.consumedAt = NOW;
			consumed.push(id);
			return plan;
		}
	};
}

function harness(
	options: {
		backgroundFails?: boolean;
		collectionArtwork?: 'supported' | 'unsupported' | 'unknown';
		wrongBinding?: boolean;
	} = {}
) {
	const poster = candidate('poster', 'poster-a');
	const background = candidate('background', 'background-a');
	const candidates = [poster, background];
	const context: NativeCollectionArtworkContext = {
		id: 'collection-a',
		serverInstanceId: 'server-a',
		name: 'Saga',
		source: 'native',
		sourceId: 'native-77',
		nativeProvider: 'plex',
		currentPosterUrl: null,
		currentBackgroundUrl: null,
		capabilities: { posterWrite: 'supported', backgroundWrite: 'supported' },
		linkedTmdbCollectionId: '900',
		localMemberCount: 2,
		artworkVersions: { poster: 0, background: 0 },
		entityFingerprint: sha('entity-v1')
	};
	const current: Record<'poster' | 'background', ServerArtwork | null> = {
		poster: artwork('poster', 'old-poster'),
		background: artwork('background', 'old-background')
	};
	const writes: Array<{ kind: 'poster' | 'background'; value: string }> = [];
	const revisions: Array<Record<string, unknown>> = [];
	const plans = inMemoryPlans();
	let snapshotId = 0;
	const server = {
		type: 'plex' as const,
		identity: {
			instanceId: options.wrongBinding ? 'server-b' : 'server-a',
			name: 'Primary',
			type: 'plex' as const
		},
		capabilities: {
			posterWrite: 'supported' as const,
			backgroundWrite: 'supported' as const,
			seasonWrite: 'supported' as const,
			episodeWrite: 'supported' as const,
			fieldLock: 'supported' as const,
			currentImageRetrieval: 'supported' as const,
			artworkDelete: 'supported' as const,
			collectionArtwork: options.collectionArtwork ?? ('supported' as const),
			evidence: 'provider_contract' as const,
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
		readCollectionArtwork: vi.fn(async (_id: string, kind: 'poster' | 'background') =>
			current[kind] ? { ...current[kind]!, data: current[kind]!.data.slice(0) } : null
		),
		applyCollectionPosterBytes: vi.fn(async (_id: string, data: ArrayBuffer) => {
			writes.push({ kind: 'poster', value: new TextDecoder().decode(data) });
			current.poster = artwork('poster', new TextDecoder().decode(data));
		}),
		applyCollectionBackgroundBytes: vi.fn(async (_id: string, data: ArrayBuffer) => {
			if (options.backgroundFails) throw new Error('secret=https://unsafe.invalid');
			writes.push({ kind: 'background', value: new TextDecoder().decode(data) });
			current.background = artwork('background', new TextDecoder().decode(data));
		})
	};
	const service = createNativeCollectionArtworkService({
		database: {} as never,
		serverRegistry: {
			resolve: vi.fn(async () => ({
				serverInstanceId: 'server-a',
				server,
				fingerprint: sha('server-v1')
			}))
		},
		planStore: plans,
		snapshots: {
			findOriginal: vi.fn(async () => null),
			captureServer: vi.fn(async (input) => ({
				id: `snapshot-${++snapshotId}`,
				serverInstanceId: input.serverInstanceId,
				mediaItemId: null,
				mediaCollectionId: context.id,
				destination: 'server' as const,
				kind: input.slot.kind,
				season: null,
				episode: null,
				state:
					input.artwork === undefined
						? ('unavailable' as const)
						: input.artwork === null
							? ('absent' as const)
							: ('present' as const),
				sha256: input.artwork ? sha(new Uint8Array(input.artwork.data)) : null,
				storagePath: null,
				contentType: input.artwork?.contentType ?? null,
				sizeBytes: input.artwork?.data.byteLength ?? null,
				value: null,
				metadata: null,
				isOriginal: input.isOriginal ?? false,
				retainedUntil: null,
				createdAt: NOW
			}))
		},
		ledger: {
			createGroup: vi.fn(async () => ({ id: 'group-1' }) as never),
			recordOutcome: vi.fn(async (input) => {
				revisions.push(input as Record<string, unknown>);
				if (input.outcome === 'success' && input.slotState) {
					context.artworkVersions[input.kind as 'poster' | 'background'] += 1;
				}
				return {
					revision: { id: `revision-${revisions.length}` },
					currentSlotState: input.slotState
						? { artworkVersion: context.artworkVersions[input.kind as 'poster' | 'background'] }
						: null
				} as never;
			}),
			finalizeGroup: vi.fn(async () => ({ id: 'group-1' }) as never),
			listTimeline: vi.fn()
		},
		loadContext: vi.fn(async (_database, serverId, collectionId) => {
			if (serverId !== 'server-a' || collectionId !== 'collection-a') {
				throw Object.assign(new Error('collection_not_found'), { code: 'collection_not_found' });
			}
			return { ...context, artworkVersions: { ...context.artworkVersions } };
		}),
		loadCandidates: vi.fn(async () => candidates.map((entry) => ({ ...entry }))),
		loadCandidateBytes: vi.fn(async (entry) => {
			const data = bytes(`new-${entry.kind}`);
			return { bytes: data, contentType: 'image/jpeg', sha256: sha(new Uint8Array(data)) };
		}),
		updateProjection: vi.fn(async () => undefined),
		clock: () => NOW
	});
	return { service, context, current, writes, revisions, plans, poster, background };
}

describe('native collection artwork service', () => {
	it('keeps exact collection/server scope and never exposes native or candidate URLs', async () => {
		const { service } = harness();
		const workspace = await service.getWorkspace('server-a', 'collection-a');
		expect(workspace.entity).toEqual({ available: true, reason: null });
		expect(workspace.slots.map((entry) => entry.kind)).toEqual(['poster', 'background']);
		expect(JSON.stringify(workspace)).not.toContain('https://');
		await expect(service.getWorkspace('server-a', 'collection-b')).rejects.toMatchObject({
			code: 'collection_not_found'
		});
	});

	it('does not write before confirmation and rejects a stale current snapshot', async () => {
		const { service, poster, current, writes, plans } = harness();
		const preview = await service.preview({
			serverInstanceId: 'server-a',
			mediaCollectionId: 'collection-a',
			selections: { poster: poster.id }
		});
		expect(writes).toEqual([]);
		current.poster = artwork('poster', 'changed-elsewhere');
		await expect(
			service.confirm({
				serverInstanceId: 'server-a',
				mediaCollectionId: 'collection-a',
				planId: preview.planId!,
				digest: preview.digest!
			})
		).rejects.toBeInstanceOf(NativeCollectionArtworkServiceError);
		expect(writes).toEqual([]);
		expect(plans.consumed).toEqual([]);
	});

	it('continues independent slots after a partial failure and records collection revisions', async () => {
		const { service, poster, background, writes, revisions, plans } = harness({
			backgroundFails: true
		});
		const preview = await service.preview({
			serverInstanceId: 'server-a',
			mediaCollectionId: 'collection-a',
			selections: { poster: poster.id, background: background.id }
		});
		const result = await service.confirm({
			serverInstanceId: 'server-a',
			mediaCollectionId: 'collection-a',
			planId: preview.planId!,
			digest: preview.digest!
		});
		expect(result.status).toBe('partial');
		expect(result.summary).toEqual({ total: 2, succeeded: 1, failed: 1 });
		expect(writes).toEqual([{ kind: 'poster', value: 'new-poster' }]);
		expect(revisions).toHaveLength(2);
		expect(revisions.every((entry) => entry.mediaCollectionId === 'collection-a')).toBe(true);
		expect(revisions.every((entry) => entry.mediaItemId === undefined)).toBe(true);
		expect(JSON.stringify(revisions)).not.toContain('unsafe.invalid');
		expect(plans.consumed).toEqual([preview.planId]);
	});

	it('disables only native slots when collection artwork is unsupported', async () => {
		const { service, poster, writes } = harness({ collectionArtwork: 'unsupported' });
		const workspace = await service.getWorkspace('server-a', 'collection-a');
		expect(workspace.slots.every((entry) => entry.capability === 'unsupported')).toBe(true);
		const preview = await service.preview({
			serverInstanceId: 'server-a',
			mediaCollectionId: 'collection-a',
			selections: { poster: poster.id }
		});
		expect(preview.planId).toBeNull();
		expect(preview.skips).toEqual([
			{ kind: 'poster', candidateId: poster.id, code: 'collection_slot_unsupported' }
		]);
		expect(writes).toEqual([]);
	});

	it('rejects a provider binding from another server before preview', async () => {
		const { service, poster, writes } = harness({ wrongBinding: true });
		await expect(
			service.preview({
				serverInstanceId: 'server-a',
				mediaCollectionId: 'collection-a',
				selections: { poster: poster.id }
			})
		).rejects.toMatchObject({ code: 'native_collection_scope_mismatch' });
		expect(writes).toEqual([]);
	});
});
