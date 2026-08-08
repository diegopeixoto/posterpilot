import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

vi.mock('$env/dynamic/private', () => ({ env: {} }));

import type { AppConfig } from '$lib/server/config';
import * as schema from '$lib/server/db/schema';
import {
	freezeConfigPath,
	readConfigAtBinding,
	recoverConfigQuarantineAtBinding,
	withConfigLocks,
	writeConfigAtomicAtBinding
} from '$lib/server/kometa/config-io';
import {
	LEGACY_FILENAME,
	MOVIE_FILENAME,
	SHOW_FILENAME,
	legacyKometaDestinationKey,
	resolveKometaDestination,
	type KometaLegacyDestinationV1
} from '$lib/server/kometa/destination';
import {
	createKometaMigrationControlLock,
	type KometaMigrationControlLease
} from '$lib/server/kometa/migration-control-lock';
import type { KometaMigrationCollisionState } from '$lib/server/kometa/migration-state';
import { hashCanonicalJson } from '$lib/server/plans/canonical-json';
import {
	kometaSlotFingerprint,
	readKometaSlot,
	restoreKometaSlot
} from '$lib/server/revisions/kometa-state';
import { buildUndoPlan, type UndoPlanPayloadV1 } from './undo-plan';
import type { ArtworkUndoPlannerDependencies, ArtworkUndoPreview } from './undo-planner';
import {
	createArtworkUndoRuntime,
	createBoundKometaUndoAccess,
	type ArtworkUndoRuntimeDependencies,
	type BoundKometaUndoAccessDependencies
} from './undo-runtime';

const currentFingerprint = 'a'.repeat(64);
const restoreFingerprint = 'b'.repeat(64);
const CONTROL_LEASE = 'test-control-lease' as KometaMigrationControlLease;
const ROOT_POSTER = { kind: 'poster', season: null, episode: null } as const;
const MOVIE_DESTINATION = (() => {
	const result = resolveKometaDestination({ type: 'movie', tmdbId: '10' });
	if (!result.ok) throw new Error('test destination must resolve');
	return result.destination;
})();
const SHOW_DESTINATION = (() => {
	const result = resolveKometaDestination({ type: 'show', tvdbId: '10' });
	if (!result.ok) throw new Error('test destination must resolve');
	return result.destination;
})();
const LEGACY_DESTINATION = {
	version: 1,
	filename: LEGACY_FILENAME,
	namespace: 'tmdb',
	mappingId: '10',
	key: legacyKometaDestinationKey('10')
} satisfies KometaLegacyDestinationV1;

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
		kometaMetadataPathPrefix: 'config',
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
		libraryDefaultSort: 'title',
		tmdbArtworkLanguage: 'any'
	};
}

function configAt(directory: string): AppConfig {
	return {
		...config(),
		kometaAssetsDir: directory,
		kometaConfigPath: join(directory, 'config.yml')
	};
}

function migrationCollisionState(
	status: KometaMigrationCollisionState['status'],
	directory = '/kometa'
): KometaMigrationCollisionState {
	const completed = status === 'completed';
	return {
		migrationId: 'migration-undo-guard',
		status,
		serverInstanceId: 'server-a',
		outputDirectory: directory,
		metadataPathPrefix: 'config',
		configPath: join(directory, 'config.yml'),
		references: {
			movie: 'config/posterpilot-movies.yml',
			show: 'config/posterpilot-shows.yml'
		},
		activationEvidence: completed ? 'verified_config' : null,
		completedAt: completed ? '2026-08-07T12:00:00.000Z' : null
	};
}

async function readyBinding(): Promise<
	Awaited<ReturnType<BoundKometaUndoAccessDependencies['resolveBinding']>>
> {
	return {
		status: 'ready',
		binding: {
			id: 'server-a',
			name: 'Living Room',
			plexUrl: 'http://plex',
			plexToken: 'secret'
		}
	};
}

function boundAccessDependencies(input: {
	loadConfig(): Promise<AppConfig>;
	resolveBinding: BoundKometaUndoAccessDependencies['resolveBinding'];
	read(path: string): string | null;
	write(path: string, text: string, stamp: string): unknown;
	withLocks?(paths: readonly string[], operation: () => Promise<unknown>): Promise<unknown>;
	loadMigrationState?: BoundKometaUndoAccessDependencies['loadMigrationState'];
	assertNoPendingConfigMutationWhileOwned?: BoundKometaUndoAccessDependencies['assertNoPendingConfigMutationWhileOwned'];
	assertControlOwned?: () => Promise<KometaMigrationControlLease>;
	clock?: () => Date;
}): BoundKometaUndoAccessDependencies {
	return {
		loadConfig: input.loadConfig,
		resolveBinding: input.resolveBinding,
		loadMigrationState: input.loadMigrationState ?? (async () => null),
		assertNoPendingConfigMutationWhileOwned:
			input.assertNoPendingConfigMutationWhileOwned ??
			(async (assertControlLockOwned) => assertControlLockOwned()),
		freezePath: (path) => ({
			version: 1,
			canonicalPath: path,
			anchorPath: dirname(path),
			anchorDevice: '1',
			anchorInode: '1'
		}),
		readAtBinding: (binding) => input.read(binding.canonicalPath),
		recoverAtBinding: vi.fn(),
		writeAtBinding: (binding, text, stamp) => input.write(binding.canonicalPath, text, stamp),
		withLocks: async <T>(paths: readonly string[], operation: () => Promise<T>) =>
			input.withLocks ? (input.withLocks(paths, operation) as Promise<T>) : operation(),
		withControlLock: async <T>(
			operation: (assertOwned: () => Promise<KometaMigrationControlLease>) => Promise<T>
		) => operation(input.assertControlOwned ?? (async () => CONTROL_LEASE)),
		clock: input.clock
	};
}

function physicalAccessDependencies(
	directory: string,
	overrides: Partial<
		Pick<
			BoundKometaUndoAccessDependencies,
			| 'loadMigrationState'
			| 'assertNoPendingConfigMutationWhileOwned'
			| 'writeAtBinding'
			| 'withLocks'
			| 'withControlLock'
		>
	> = {}
): BoundKometaUndoAccessDependencies {
	return {
		loadConfig: async () => configAt(directory),
		resolveBinding: readyBinding,
		loadMigrationState: async () => null,
		assertNoPendingConfigMutationWhileOwned: async (assertControlLockOwned) =>
			assertControlLockOwned(),
		freezePath: freezeConfigPath,
		readAtBinding: readConfigAtBinding,
		recoverAtBinding: recoverConfigQuarantineAtBinding,
		writeAtBinding: writeConfigAtomicAtBinding,
		withLocks: withConfigLocks,
		withControlLock: async (operation) => operation(async () => CONTROL_LEASE),
		...overrides
	};
}

describe('bound Kometa undo runtime', () => {
	it.each([
		{ label: 'pending config checkpoint', pendingFails: true, migrationStatus: null },
		{ label: 'corrupt config checkpoint', pendingFails: true, migrationStatus: null },
		{ label: 'invalid migration guard', pendingFails: false, migrationStatus: 'prepared' as const }
	])(
		'fails the plan-wide preflight closed for a $label',
		async ({ pendingFails, migrationStatus }) => {
			const write = vi.fn();
			const access = createBoundKometaUndoAccess(
				boundAccessDependencies({
					loadConfig: async () => config(),
					resolveBinding: readyBinding,
					loadMigrationState: async () =>
						migrationStatus ? migrationCollisionState(migrationStatus) : null,
					assertNoPendingConfigMutationWhileOwned: async (assertControlLockOwned) => {
						await assertControlLockOwned();
						if (pendingFails) throw new Error('checkpoint unavailable');
					},
					read: () => 'metadata: {}\n',
					write
				})
			);

			await expect(
				access.preflightKometa([{ serverInstanceId: 'server-a', destination: MOVIE_DESTINATION }])
			).rejects.toMatchObject({ code: 'plan_stale' });
			expect(write).not.toHaveBeenCalled();
		}
	);

	it('allows a healthy plan-wide preflight without reading or writing the target YAML', async () => {
		const read = vi.fn(() => 'metadata: {}\n');
		const write = vi.fn();
		const access = createBoundKometaUndoAccess(
			boundAccessDependencies({
				loadConfig: async () => config(),
				resolveBinding: readyBinding,
				read,
				write
			})
		);

		await expect(
			access.preflightKometa([
				{ serverInstanceId: 'server-a', destination: MOVIE_DESTINATION },
				{ serverInstanceId: 'server-a', destination: MOVIE_DESTINATION }
			])
		).resolves.toBeUndefined();
		expect(read).not.toHaveBeenCalled();
		expect(write).not.toHaveBeenCalled();
	});

	it('restores one exact slot under CAS while preserving its sibling', async () => {
		let raw = `# managed\nmetadata:\n  "10":\n    url_poster: https://current/poster.jpg\n    url_background: https://keep/background.jpg # keep\n`;
		const write = vi.fn((_path: string, next: string) => {
			raw = next;
		});
		const lockCalls = vi.fn();
		async function withLocks<T>(paths: readonly string[], operation: () => Promise<T>): Promise<T> {
			lockCalls([...paths].sort());
			return operation();
		}
		const access = createBoundKometaUndoAccess(
			boundAccessDependencies({
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
				withLocks,
				clock: () => new Date('2026-07-11T12:00:00.000Z')
			})
		);
		const slot = { kind: 'poster', season: null, episode: null } as const;
		const current = { state: 'present', url: 'https://current/poster.jpg' } as const;

		await access.mutateKometa({
			serverInstanceId: 'server-a',
			destination: MOVIE_DESTINATION,
			slot,
			restore: { state: 'present', url: 'https://prior/poster.jpg' },
			expectedCurrent: {
				state: 'present',
				fingerprint: hashCanonicalJson(current)
			}
		});

		expect(lockCalls).toHaveBeenCalledWith([
			'/kometa/config.yml',
			'/kometa/posterpilot-movies.yml',
			'/kometa/posterpilot.yml'
		]);
		expect(write).toHaveBeenCalledWith(
			'/kometa/posterpilot-movies.yml',
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

	it('isolates equal numeric movie and show mappings in their recorded typed files', async () => {
		const moviePath = `/kometa/${MOVIE_FILENAME}`;
		const showPath = `/kometa/${SHOW_FILENAME}`;
		const legacyPath = `/kometa/${LEGACY_FILENAME}`;
		const movieCurrent = { state: 'present', url: 'https://movie/current.jpg' } as const;
		const showCurrent = { state: 'present', url: 'https://show/keep.jpg' } as const;
		const showRaw = 'metadata:\n  10:\n    url_poster: https://show/keep.jpg\n';
		const legacyRaw = 'metadata:\n  10:\n    url_poster: https://legacy/keep.jpg\n';
		const files = new Map<string, string>([
			[moviePath, 'metadata:\n  10:\n    url_poster: https://movie/current.jpg\n'],
			[showPath, showRaw],
			[legacyPath, legacyRaw]
		]);
		const write = vi.fn((path: string, next: string) => files.set(path, next));
		const lockCalls = vi.fn();
		async function withLocks<T>(paths: readonly string[], operation: () => Promise<T>): Promise<T> {
			lockCalls([...paths].sort());
			return operation();
		}
		const access = createBoundKometaUndoAccess(
			boundAccessDependencies({
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
				read: (path) => files.get(path) ?? null,
				write,
				withLocks
			})
		);

		await access.mutateKometa({
			serverInstanceId: 'server-a',
			destination: MOVIE_DESTINATION,
			slot: { kind: 'poster', season: null, episode: null },
			restore: { state: 'present', url: 'https://movie/prior.jpg' },
			expectedCurrent: {
				state: 'present',
				fingerprint: kometaSlotFingerprint(movieCurrent)
			}
		});
		const movieAfter = files.get(moviePath)!;
		await access.mutateKometa({
			serverInstanceId: 'server-a',
			destination: SHOW_DESTINATION,
			slot: { kind: 'poster', season: null, episode: null },
			restore: { state: 'present', url: 'https://show/prior.jpg' },
			expectedCurrent: {
				state: 'present',
				fingerprint: kometaSlotFingerprint(showCurrent)
			}
		});

		expect(MOVIE_DESTINATION.mappingId).toBe(SHOW_DESTINATION.mappingId);
		expect(MOVIE_DESTINATION.key).not.toBe(SHOW_DESTINATION.key);
		expect(lockCalls.mock.calls.map(([paths]) => paths)).toEqual([
			['/kometa/config.yml', moviePath, legacyPath],
			['/kometa/config.yml', showPath, legacyPath]
		]);
		expect(write).toHaveBeenCalledWith(moviePath, expect.any(String), expect.any(String));
		expect(write).toHaveBeenCalledWith(showPath, expect.any(String), expect.any(String));
		expect(
			readKometaSlot(files.get(moviePath)!, '10', {
				kind: 'poster',
				season: null,
				episode: null
			})
		).toEqual({ state: 'present', url: 'https://movie/prior.jpg' });
		expect(files.get(moviePath)).toBe(movieAfter);
		expect(
			readKometaSlot(files.get(showPath)!, '10', {
				kind: 'poster',
				season: null,
				episode: null
			})
		).toEqual({ state: 'present', url: 'https://show/prior.jpg' });
		expect(files.get(legacyPath)).toBe(legacyRaw);
	});

	it('targets only posterpilot.yml for an explicitly recorded legacy V1 destination', async () => {
		const moviePath = `/kometa/${MOVIE_FILENAME}`;
		const showPath = `/kometa/${SHOW_FILENAME}`;
		const legacyPath = `/kometa/${LEGACY_FILENAME}`;
		const movieRaw = 'metadata:\n  10:\n    url_poster: https://movie/keep.jpg\n';
		const showRaw = 'metadata:\n  10:\n    url_poster: https://show/keep.jpg\n';
		const legacyCurrent = { state: 'present', url: 'https://legacy/current.jpg' } as const;
		const files = new Map<string, string>([
			[moviePath, movieRaw],
			[showPath, showRaw],
			[legacyPath, 'metadata:\n  10:\n    url_poster: https://legacy/current.jpg\n']
		]);
		const write = vi.fn((path: string, next: string) => files.set(path, next));
		const lockCalls = vi.fn();
		async function withLocks<T>(paths: readonly string[], operation: () => Promise<T>): Promise<T> {
			lockCalls([...paths].sort());
			return operation();
		}
		const access = createBoundKometaUndoAccess(
			boundAccessDependencies({
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
				read: (path) => files.get(path) ?? null,
				write,
				withLocks
			})
		);

		await access.mutateKometa({
			serverInstanceId: 'server-a',
			destination: LEGACY_DESTINATION,
			slot: { kind: 'poster', season: null, episode: null },
			restore: { state: 'present', url: 'https://legacy/prior.jpg' },
			expectedCurrent: {
				state: 'present',
				fingerprint: kometaSlotFingerprint(legacyCurrent)
			}
		});

		expect(lockCalls).toHaveBeenCalledTimes(1);
		expect(lockCalls).toHaveBeenCalledWith(['/kometa/config.yml', legacyPath]);
		expect(write).toHaveBeenCalledWith(legacyPath, expect.any(String), expect.any(String));
		expect(
			readKometaSlot(files.get(legacyPath)!, '10', {
				kind: 'poster',
				season: null,
				episode: null
			})
		).toEqual({ state: 'present', url: 'https://legacy/prior.jpg' });
		expect(files.get(moviePath)).toBe(movieRaw);
		expect(files.get(showPath)).toBe(showRaw);
	});

	it('rejects an atomic stale comparison without writing', async () => {
		const raw = `metadata:\n  "10":\n    url_poster: https://changed/poster.jpg\n`;
		const write = vi.fn();
		const access = createBoundKometaUndoAccess(
			boundAccessDependencies({
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
				withLocks: async (_paths, operation) => operation()
			})
		);

		await expect(
			access.mutateKometa({
				serverInstanceId: 'server-a',
				destination: MOVIE_DESTINATION,
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

	it('rejects a migration journal installed after preview while holding physical locks first', async () => {
		const raw = 'metadata:\n  10:\n    url_poster: https://current/poster.jpg\n';
		const write = vi.fn();
		const events: string[] = [];
		let migrationState: KometaMigrationCollisionState | null = null;
		const access = createBoundKometaUndoAccess(
			boundAccessDependencies({
				loadConfig: async () => config(),
				resolveBinding: readyBinding,
				loadMigrationState: async () => migrationState,
				read: () => raw,
				write,
				withLocks: async (_paths, operation) => {
					events.push('paths:enter');
					try {
						return await operation();
					} finally {
						events.push('paths:exit');
					}
				},
				assertControlOwned: async () => {
					events.push('control');
					return CONTROL_LEASE;
				}
			})
		);
		const previewed = await access.readKometa('server-a', MOVIE_DESTINATION);
		expect(previewed).toBe(raw);
		migrationState = migrationCollisionState('prepared');

		await expect(
			access.mutateKometa({
				serverInstanceId: 'server-a',
				destination: MOVIE_DESTINATION,
				slot: { kind: 'poster', season: null, episode: null },
				restore: { state: 'present', url: 'https://prior/poster.jpg' },
				expectedCurrent: {
					state: 'present',
					fingerprint: kometaSlotFingerprint({
						state: 'present',
						url: 'https://current/poster.jpg'
					})
				}
			})
		).rejects.toMatchObject({ code: 'plan_stale' });
		expect(write).not.toHaveBeenCalled();
		expect(events).toEqual([
			'paths:enter',
			'paths:exit',
			'paths:enter',
			'control',
			'control',
			'paths:exit'
		]);
	});

	it.each([
		{ status: 'prepared' as const, label: 'typed V2', destination: MOVIE_DESTINATION },
		{ status: 'completed' as const, label: 'typed V2', destination: MOVIE_DESTINATION },
		{ status: 'prepared' as const, label: 'legacy V1', destination: LEGACY_DESTINATION },
		{ status: 'completed' as const, label: 'legacy V1', destination: LEGACY_DESTINATION }
	])(
		'blocks $label write and outcome while a $status config checkpoint exists',
		async ({ status, destination }) => {
			const raw = 'metadata:\n  10:\n    url_poster: https://current/poster.jpg\n';
			const write = vi.fn();
			const recordOutcome = vi.fn();
			const access = createBoundKometaUndoAccess(
				boundAccessDependencies({
					loadConfig: async () => config(),
					resolveBinding: readyBinding,
					assertNoPendingConfigMutationWhileOwned: async () => {
						throw new Error(`${status} checkpoint`);
					},
					read: () => raw,
					write
				})
			);

			await expect(
				access.withKometaCommit('server-a', destination, async (assertOwned) => {
					await access.mutateKometa(
						{
							serverInstanceId: 'server-a',
							destination,
							slot: ROOT_POSTER,
							restore: { state: 'present', url: 'https://prior/poster.jpg' },
							expectedCurrent: {
								state: 'present',
								fingerprint: kometaSlotFingerprint({
									state: 'present',
									url: 'https://current/poster.jpg'
								})
							}
						},
						assertOwned
					);
					await assertOwned();
					recordOutcome();
				})
			).rejects.toMatchObject({ code: 'plan_stale' });
			expect(write).not.toHaveBeenCalled();
			expect(recordOutcome).not.toHaveBeenCalled();
		}
	);

	it('fails closed on a corrupt config checkpoint read before write or outcome', async () => {
		const write = vi.fn();
		const recordOutcome = vi.fn();
		const access = createBoundKometaUndoAccess(
			boundAccessDependencies({
				loadConfig: async () => config(),
				resolveBinding: readyBinding,
				assertNoPendingConfigMutationWhileOwned: async () => {
					throw new Error('corrupt checkpoint');
				},
				read: () => 'metadata:\n  10:\n    url_poster: https://current/poster.jpg\n',
				write
			})
		);

		await expect(
			access.withKometaCommit('server-a', MOVIE_DESTINATION, async () => {
				recordOutcome();
			})
		).rejects.toMatchObject({ code: 'plan_stale' });
		expect(write).not.toHaveBeenCalled();
		expect(recordOutcome).not.toHaveBeenCalled();
	});

	it('never lets a caller-supplied assertion replace the active control lease', async () => {
		const raw = 'metadata:\n  10:\n    url_poster: https://current/poster.jpg\n';
		const write = vi.fn();
		let leaseLost = false;
		const access = createBoundKometaUndoAccess(
			boundAccessDependencies({
				loadConfig: async () => config(),
				resolveBinding: readyBinding,
				assertControlOwned: async () => {
					if (leaseLost) throw new Error('lease lost');
					return CONTROL_LEASE;
				},
				read: () => raw,
				write
			})
		);

		await expect(
			access.withKometaCommit('server-a', MOVIE_DESTINATION, async () => {
				leaseLost = true;
				await access.mutateKometa(
					{
						serverInstanceId: 'server-a',
						destination: MOVIE_DESTINATION,
						slot: ROOT_POSTER,
						restore: { state: 'present', url: 'https://prior/poster.jpg' },
						expectedCurrent: {
							state: 'present',
							fingerprint: kometaSlotFingerprint({
								state: 'present',
								url: 'https://current/poster.jpg'
							})
						}
					},
					async () => undefined
				);
			})
		).rejects.toThrow('lease lost');
		expect(write).not.toHaveBeenCalled();
	});

	it.each([
		{ label: 'typed V2', destination: MOVIE_DESTINATION },
		{ label: 'legacy V1', destination: LEGACY_DESTINATION }
	])(
		'allows $label write and outcome when no config checkpoint exists',
		async ({ destination }) => {
			let raw = 'metadata:\n  10:\n    url_poster: https://current/poster.jpg\n';
			const write = vi.fn((_path: string, next: string) => {
				raw = next;
			});
			const recordOutcome = vi.fn();
			const access = createBoundKometaUndoAccess(
				boundAccessDependencies({
					loadConfig: async () => config(),
					resolveBinding: readyBinding,
					assertNoPendingConfigMutationWhileOwned: async (assertControlLockOwned) =>
						assertControlLockOwned(),
					read: () => raw,
					write
				})
			);

			await access.withKometaCommit('server-a', destination, async (assertOwned) => {
				await access.mutateKometa(
					{
						serverInstanceId: 'server-a',
						destination,
						slot: ROOT_POSTER,
						restore: { state: 'present', url: 'https://prior/poster.jpg' },
						expectedCurrent: {
							state: 'present',
							fingerprint: kometaSlotFingerprint({
								state: 'present',
								url: 'https://current/poster.jpg'
							})
						}
					},
					assertOwned
				);
				await assertOwned();
				recordOutcome();
			});

			expect(write).toHaveBeenCalledTimes(1);
			expect(recordOutcome).toHaveBeenCalledTimes(1);
		}
	);

	it('blocks a typed V2 undo while config still activates the legacy layout', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'posterpilot-kometa-undo-legacy-guard-'));
		try {
			const configRaw = `libraries:\n  Movies:\n    metadata_files:\n      - file: ${LEGACY_FILENAME}\n`;
			const legacyRaw = 'metadata:\n  10:\n    url_poster: https://legacy/poster.jpg\n';
			const typedRaw = 'metadata:\n  10:\n    url_poster: https://typed/current.jpg\n';
			writeFileSync(join(directory, 'config.yml'), configRaw, 'utf8');
			writeFileSync(join(directory, LEGACY_FILENAME), legacyRaw, 'utf8');
			writeFileSync(join(directory, MOVIE_FILENAME), typedRaw, 'utf8');
			const access = createBoundKometaUndoAccess(physicalAccessDependencies(directory));

			await expect(
				access.mutateKometa({
					serverInstanceId: 'server-a',
					destination: MOVIE_DESTINATION,
					slot: ROOT_POSTER,
					restore: { state: 'present', url: 'https://typed/prior.jpg' },
					expectedCurrent: {
						state: 'present',
						fingerprint: kometaSlotFingerprint({
							state: 'present',
							url: 'https://typed/current.jpg'
						})
					}
				})
			).rejects.toMatchObject({ code: 'plan_stale' });
			expect(readFileSync(join(directory, MOVIE_FILENAME), 'utf8')).toBe(typedRaw);
			expect(readFileSync(join(directory, LEGACY_FILENAME), 'utf8')).toBe(legacyRaw);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it('allows an exact legacy V1 undo while the legacy layout is active and no journal is incomplete', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'posterpilot-kometa-undo-legacy-v1-'));
		try {
			writeFileSync(
				join(directory, 'config.yml'),
				`libraries:\n  Movies:\n    metadata_files:\n      - file: ${LEGACY_FILENAME}\n`,
				'utf8'
			);
			const legacyPath = join(directory, LEGACY_FILENAME);
			writeFileSync(
				legacyPath,
				'metadata:\n  10:\n    url_poster: https://legacy/current.jpg\n',
				'utf8'
			);
			const access = createBoundKometaUndoAccess(physicalAccessDependencies(directory));

			await access.mutateKometa({
				serverInstanceId: 'server-a',
				destination: LEGACY_DESTINATION,
				slot: ROOT_POSTER,
				restore: { state: 'present', url: 'https://legacy/prior.jpg' },
				expectedCurrent: {
					state: 'present',
					fingerprint: kometaSlotFingerprint({
						state: 'present',
						url: 'https://legacy/current.jpg'
					})
				}
			});

			expect(readKometaSlot(readFileSync(legacyPath, 'utf8'), '10', ROOT_POSTER)).toEqual({
				state: 'present',
				url: 'https://legacy/prior.jpg'
			});
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it('blocks typed undo when a completed migration baseline has a corrupt active config', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'posterpilot-kometa-undo-corrupt-guard-'));
		try {
			const typedRaw = 'metadata:\n  10:\n    url_poster: https://typed/current.jpg\n';
			writeFileSync(join(directory, 'config.yml'), 'libraries: []\n', 'utf8');
			writeFileSync(
				join(directory, LEGACY_FILENAME),
				'metadata:\n  10:\n    url_poster: https://legacy/preserved.jpg\n',
				'utf8'
			);
			writeFileSync(join(directory, MOVIE_FILENAME), typedRaw, 'utf8');
			const access = createBoundKometaUndoAccess(
				physicalAccessDependencies(directory, {
					loadMigrationState: async () => migrationCollisionState('completed', directory)
				})
			);

			await expect(
				access.mutateKometa({
					serverInstanceId: 'server-a',
					destination: MOVIE_DESTINATION,
					slot: ROOT_POSTER,
					restore: { state: 'present', url: 'https://typed/prior.jpg' },
					expectedCurrent: {
						state: 'present',
						fingerprint: kometaSlotFingerprint({
							state: 'present',
							url: 'https://typed/current.jpg'
						})
					}
				})
			).rejects.toMatchObject({ code: 'plan_stale' });
			expect(readFileSync(join(directory, MOVIE_FILENAME), 'utf8')).toBe(typedRaw);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it.each([
		{ label: 'different bytes', matchesProposed: false },
		{ label: 'bytes equal to the proposed undo', matchesProposed: true }
	])('preserves an external editor winner with $label', async ({ matchesProposed }) => {
		const directory = mkdtempSync(join(tmpdir(), 'posterpilot-kometa-undo-cas-'));
		try {
			const targetPath = join(directory, MOVIE_FILENAME);
			const source =
				'metadata:\n  10:\n    url_poster: https://current/poster.jpg\n    url_background: https://keep/background.jpg\n';
			const restore = { state: 'present', url: 'https://prior/poster.jpg' } as const;
			const proposed = restoreKometaSlot(source, '10', ROOT_POSTER, restore);
			const external = matchesProposed
				? proposed
				: 'metadata:\n  10:\n    url_poster: https://external/poster.jpg\n';
			writeFileSync(targetPath, source, 'utf8');
			const access = createBoundKometaUndoAccess(
				physicalAccessDependencies(directory, {
					writeAtBinding: (binding, text, stamp, opts) =>
						writeConfigAtomicAtBinding(binding, text, stamp, {
							...opts,
							testHooks: {
								beforeFinalRevalidation: () => writeFileSync(targetPath, external, 'utf8')
							}
						})
				})
			);

			await expect(
				access.mutateKometa({
					serverInstanceId: 'server-a',
					destination: MOVIE_DESTINATION,
					slot: ROOT_POSTER,
					restore,
					expectedCurrent: {
						state: 'present',
						fingerprint: kometaSlotFingerprint({
							state: 'present',
							url: 'https://current/poster.jpg'
						})
					}
				})
			).rejects.toMatchObject({ code: 'undo_kometa_write_failed' });
			expect(readFileSync(targetPath, 'utf8')).toBe(external);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it('fails before bound publication when the durable lease is lost', async () => {
		const raw = 'metadata:\n  10:\n    url_poster: https://current/poster.jpg\n';
		const write = vi.fn();
		let leaseLost = false;
		const access = createBoundKometaUndoAccess(
			boundAccessDependencies({
				loadConfig: async () => config(),
				resolveBinding: readyBinding,
				read: () => {
					leaseLost = true;
					return raw;
				},
				write,
				assertControlOwned: async () => {
					if (leaseLost) throw new Error('lease lost');
					return CONTROL_LEASE;
				}
			})
		);

		await expect(
			access.mutateKometa({
				serverInstanceId: 'server-a',
				destination: MOVIE_DESTINATION,
				slot: ROOT_POSTER,
				restore: { state: 'present', url: 'https://prior/poster.jpg' },
				expectedCurrent: {
					state: 'present',
					fingerprint: kometaSlotFingerprint({
						state: 'present',
						url: 'https://current/poster.jpg'
					})
				}
			})
		).rejects.toMatchObject({ code: 'undo_kometa_write_failed' });
		expect(write).not.toHaveBeenCalled();
	});

	it('serializes independent process-local queues through the durable lease', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'posterpilot-kometa-undo-processes-'));
		const clientA = createClient({ url: `file:${join(directory, 'shared.db')}` });
		const clientB = createClient({ url: `file:${join(directory, 'shared.db')}` });
		try {
			await clientA.execute(
				'CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)'
			);
			writeFileSync(
				join(directory, MOVIE_FILENAME),
				'metadata:\n  10:\n    url_poster: https://current/poster.jpg\n',
				'utf8'
			);
			const databaseA = drizzle(clientA, { schema });
			const databaseB = drizzle(clientB, { schema });
			const lockA = createKometaMigrationControlLock(databaseA, {
				leaseMs: 2_000,
				pollIntervalMs: 5,
				owner: () => 'undo-process-a'
			});
			const lockB = createKometaMigrationControlLock(databaseB, {
				leaseMs: 2_000,
				pollIntervalMs: 5,
				owner: () => 'undo-process-b'
			});
			const noProcessSharedLocks = async <T>(
				_paths: readonly string[],
				operation: () => Promise<T>
			): Promise<T> => operation();
			const accessA = createBoundKometaUndoAccess(
				physicalAccessDependencies(directory, {
					withLocks: noProcessSharedLocks,
					withControlLock: lockA
				})
			);
			const accessB = createBoundKometaUndoAccess(
				physicalAccessDependencies(directory, {
					withLocks: noProcessSharedLocks,
					withControlLock: lockB
				})
			);
			const order: string[] = [];
			let enterFirst!: () => void;
			let releaseFirst!: () => void;
			const firstEntered = new Promise<void>((resolve) => {
				enterFirst = resolve;
			});
			const firstRelease = new Promise<void>((resolve) => {
				releaseFirst = resolve;
			});

			const first = accessA.withKometaCommit('server-a', MOVIE_DESTINATION, async () => {
				order.push('a:enter');
				enterFirst();
				await firstRelease;
				order.push('a:exit');
			});
			await firstEntered;
			const second = accessB.withKometaCommit('server-a', MOVIE_DESTINATION, async () => {
				order.push('b:enter');
			});
			await new Promise((resolve) => setTimeout(resolve, 30));
			expect(order).toEqual(['a:enter']);
			releaseFirst();
			await Promise.all([first, second]);
			expect(order).toEqual(['a:enter', 'a:exit', 'b:enter']);
		} finally {
			clientA.close();
			clientB.close();
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it('fails closed when Kometa belongs to another named Plex server', async () => {
		const read = vi.fn();
		const access = createBoundKometaUndoAccess(
			boundAccessDependencies({
				loadConfig: async () => config('server-b'),
				resolveBinding: vi.fn(),
				read,
				write: vi.fn(),
				withLocks: async (_paths, operation) => operation()
			})
		);

		await expect(access.readKometa('server-a', MOVIE_DESTINATION)).rejects.toMatchObject({
			code: 'kometa_server_binding_mismatch'
		});
		expect(read).not.toHaveBeenCalled();
	});
});
