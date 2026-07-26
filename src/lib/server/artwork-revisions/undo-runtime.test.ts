import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));

import type { AppConfig } from '$lib/server/config';
import { hashCanonicalJson } from '$lib/server/plans/canonical-json';
import { readKometaSlot } from '$lib/server/revisions/kometa-state';
import { buildUndoPlan, type UndoPlanPayloadV1 } from './undo-plan';
import type { ArtworkUndoPlannerDependencies, ArtworkUndoPreview } from './undo-planner';
import {
	createArtworkUndoRuntime,
	createBoundKometaUndoAccess,
	type ArtworkUndoRuntimeDependencies
} from './undo-runtime';

const currentFingerprint = 'a'.repeat(64);
const restoreFingerprint = 'b'.repeat(64);

function plan(mediaItemId = 7, serverInstanceId = 'server-a') {
	return buildUndoPlan({
		plannedAt: '2026-07-11T12:00:00.000Z',
		scope: { kind: 'item', serverInstanceId, mediaItemId },
		operations: [
			{
				revisionId: 'revision-1',
				revisionGroupId: 'apply-group-1',
				revisionCreatedAt: '2026-07-11T11:00:00.000Z',
				serverInstanceId,
				target: { kind: 'item', mediaItemId },
				destination: 'server',
				targetId: 'rating-key-7',
				slot: { kind: 'poster', season: null, episode: null },
				beforeSnapshotId: 'snapshot-1',
				current: {
					state: 'present',
					fingerprint: currentFingerprint,
					artworkVersion: 3
				},
				snapshot: {
					state: 'present',
					fingerprint: restoreFingerprint,
					restorable: true
				}
			}
		]
	});
}

function publicPreview(payload: UndoPlanPayloadV1, digest: string): ArtworkUndoPreview {
	return {
		planId: 'undo-plan-1',
		digest,
		scope: payload.scope,
		operations: payload.operations.map((operation) => ({
			id: operation.id,
			revisionId: operation.revisionId,
			revisionGroupId: operation.revisionGroupId,
			beforeSnapshotId: operation.beforeSnapshotId,
			serverInstanceId: operation.serverInstanceId,
			target: operation.target,
			destination: operation.destination,
			slot: operation.slot,
			current: {
				state: operation.current.state,
				artworkVersion: operation.current.artworkVersion
			},
			snapshot: {
				state: operation.snapshot.state,
				restorable: operation.snapshot.restorable
			}
		})),
		summary: payload.summary
	};
}

function runtimeHarness(options: { planItemId?: number; activeServer?: string | null } = {}) {
	const built = plan(options.planItemId ?? 7);
	const previewPlan = vi.fn().mockResolvedValue(publicPreview(built.payload, built.digest));
	const confirmPlan = vi.fn().mockResolvedValue({
		planId: 'undo-plan-1',
		digest: built.digest,
		payload: built.payload
	});
	const enqueue = vi.fn().mockResolvedValue(42);
	const validate = vi.fn().mockResolvedValue({ payload: built.payload });
	const getItem = vi.fn(async (id: number, serverInstanceId: string) =>
		id === 7 && serverInstanceId === 'server-a' ? { id: 7, serverInstanceId: 'server-a' } : null
	);
	const dependencies: ArtworkUndoRuntimeDependencies = {
		plannerDependencies: {} as ArtworkUndoPlannerDependencies,
		enqueue,
		planStore: { validate },
		getActiveServerInstanceId: vi.fn().mockResolvedValue(options.activeServer ?? 'server-a'),
		getItem,
		mutationsAllowed: vi.fn(),
		previewPlan,
		confirmPlan
	};
	return {
		runtime: createArtworkUndoRuntime(dependencies),
		built,
		previewPlan,
		confirmPlan,
		enqueue,
		validate,
		getItem
	};
}

describe('active-item artwork undo runtime', () => {
	it('previews without executing and binds item scope to the active server', async () => {
		const harness = runtimeHarness();
		const preview = await harness.runtime.preview({ mediaItemId: 7 });

		expect(preview.planId).toBe('undo-plan-1');
		expect(harness.previewPlan).toHaveBeenCalledWith({
			scope: { kind: 'item', serverInstanceId: 'server-a', mediaItemId: 7 }
		});
		expect(harness.enqueue).not.toHaveBeenCalled();
	});

	it('validates plan ownership before consuming and enqueues the exact confirmed payload', async () => {
		const harness = runtimeHarness();
		const job = await harness.runtime.confirm({
			mediaItemId: 7,
			planId: 'undo-plan-1',
			digest: harness.built.digest
		});

		expect(harness.validate).toHaveBeenCalledWith('undo-plan-1', {
			kind: 'artwork_undo',
			digest: harness.built.digest,
			serverInstanceId: 'server-a'
		});
		expect(harness.confirmPlan).toHaveBeenCalledWith({
			planId: 'undo-plan-1',
			digest: harness.built.digest,
			serverInstanceId: 'server-a'
		});
		expect(harness.enqueue).toHaveBeenCalledWith({
			kind: 'undo',
			planId: 'undo-plan-1',
			digest: harness.built.digest,
			plan: harness.built.payload
		});
		expect(job).toMatchObject({ jobId: 42, planId: 'undo-plan-1', digest: harness.built.digest });
	});

	it('rejects the wrong item or server before plan confirmation', async () => {
		const wrongItem = runtimeHarness({ planItemId: 8 });
		await expect(
			wrongItem.runtime.confirm({
				mediaItemId: 7,
				planId: 'undo-plan-1',
				digest: wrongItem.built.digest
			})
		).rejects.toMatchObject({ code: 'plan_scope_mismatch' });
		expect(wrongItem.confirmPlan).not.toHaveBeenCalled();

		const wrongServer = runtimeHarness({ activeServer: 'server-b' });
		await expect(wrongServer.runtime.preview({ mediaItemId: 7 })).rejects.toMatchObject({
			code: 'item_not_found'
		});
		expect(wrongServer.previewPlan).not.toHaveBeenCalled();
	});

	it('rejects a revision/group preview that does not contain the URL item', async () => {
		const harness = runtimeHarness({ planItemId: 8 });
		await expect(
			harness.runtime.preview({
				mediaItemId: 7,
				scope: { kind: 'revision', revisionId: 'revision-1' }
			})
		).rejects.toMatchObject({ code: 'undo_scope_not_found' });
		expect(harness.enqueue).not.toHaveBeenCalled();
	});

	it('does not swallow stale or replay failures from exact confirmation', async () => {
		const harness = runtimeHarness();
		for (const code of ['plan_stale', 'plan_consumed']) {
			harness.confirmPlan.mockRejectedValueOnce(
				Object.assign(new Error('private state'), { code })
			);
			await expect(
				harness.runtime.confirm({
					mediaItemId: 7,
					planId: 'undo-plan-1',
					digest: harness.built.digest
				})
			).rejects.toMatchObject({ code });
		}
		expect(harness.enqueue).not.toHaveBeenCalled();
	});
});

function config(serverInstanceId: string | null = 'server-a'): AppConfig {
	return {
		serverType: 'plex',
		plexUrl: null,
		plexToken: null,
		plexClientId: null,
		jellyfinUrl: null,
		jellyfinApiKey: null,
		embyUrl: null,
		embyApiKey: null,
		tmdbKey: null,
		kometaAssetsDir: '/kometa',
		kometaConfigPath: '/kometa/config.yml',
		kometaConfigMode: 'merge',
		kometaServerInstanceId: serverInstanceId,
		mediuxDelayMs: 0,
		mediuxConcurrency: 1,
		httpCacheTtlDays: 1,
		defaultApplyMethod: 'plex',
		includedSections: [],
		providerMediux: true,
		providerTmdb: true,
		providerFanart: false,
		providerThePosterDb: false,
		fanartKey: null,
		thePosterDbUsername: null,
		thePosterDbPassword: null,
		language: null,
		logDir: '/logs',
		eventRetention: 100,
		applyConcurrency: 1,
		suggestPreselect: false,
		incrementalSync: true,
		thumbCacheTtlDays: 1,
		thumbCacheMaxMb: 10,
		funEnabled: false,
		libraryDefaultSort: 'title'
	};
}

describe('bound Kometa undo runtime', () => {
	it('restores one exact slot under CAS while preserving its sibling', async () => {
		let raw = `# managed\nmetadata:\n  "10":\n    url_poster: https://current/poster.jpg\n    url_background: https://keep/background.jpg # keep\n`;
		const write = vi.fn((_path: string, next: string) => {
			raw = next;
		});
		const lockCalls = vi.fn();
		async function withLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
			lockCalls(path);
			return operation();
		}
		const access = createBoundKometaUndoAccess({
			loadConfig: async () => config(),
			resolveBinding: async () => ({
				status: 'ready',
				binding: {
					id: 'server-a',
					name: 'Living Room',
					plexUrl: 'http://plex',
					plexToken: 'never-returned'
				}
			}),
			read: () => raw,
			write,
			withLock,
			clock: () => new Date('2026-07-11T12:00:00.000Z')
		});
		const slot = { kind: 'poster', season: null, episode: null } as const;
		const current = { state: 'present', url: 'https://current/poster.jpg' } as const;

		await access.mutateKometa({
			serverInstanceId: 'server-a',
			tmdbId: '10',
			slot,
			restore: { state: 'present', url: 'https://prior/poster.jpg' },
			expectedCurrent: {
				state: 'present',
				fingerprint: hashCanonicalJson(current)
			}
		});

		expect(lockCalls).toHaveBeenCalledWith('/kometa/posterpilot.yml');
		expect(write).toHaveBeenCalledWith(
			'/kometa/posterpilot.yml',
			expect.any(String),
			'2026-07-11T12:00:00.000Z'
		);
		expect(readKometaSlot(raw, '10', slot)).toEqual({
			state: 'present',
			url: 'https://prior/poster.jpg'
		});
		expect(readKometaSlot(raw, '10', { kind: 'background', season: null, episode: null })).toEqual({
			state: 'present',
			url: 'https://keep/background.jpg'
		});
		expect(raw).toContain('# keep');
	});

	it('rejects an atomic stale comparison without writing', async () => {
		const raw = `metadata:\n  "10":\n    url_poster: https://changed/poster.jpg\n`;
		const write = vi.fn();
		const access = createBoundKometaUndoAccess({
			loadConfig: async () => config(),
			resolveBinding: async () => ({
				status: 'ready',
				binding: {
					id: 'server-a',
					name: 'Living Room',
					plexUrl: 'http://plex',
					plexToken: 'secret'
				}
			}),
			read: () => raw,
			write,
			withLock: async (_path, operation) => operation()
		});

		await expect(
			access.mutateKometa({
				serverInstanceId: 'server-a',
				tmdbId: '10',
				slot: { kind: 'poster', season: null, episode: null },
				restore: { state: 'absent', url: null },
				expectedCurrent: {
					state: 'present',
					fingerprint: hashCanonicalJson({
						state: 'present',
						url: 'https://previewed/poster.jpg'
					})
				}
			})
		).rejects.toMatchObject({ code: 'plan_stale' });
		expect(write).not.toHaveBeenCalled();
	});

	it('fails closed when Kometa belongs to another named Plex server', async () => {
		const read = vi.fn();
		const access = createBoundKometaUndoAccess({
			loadConfig: async () => config('server-b'),
			resolveBinding: vi.fn(),
			read,
			write: vi.fn(),
			withLock: async (_path, operation) => operation()
		});

		await expect(access.readKometa('server-a')).rejects.toMatchObject({
			code: 'kometa_server_binding_mismatch'
		});
		expect(read).not.toHaveBeenCalled();
	});
});
