import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/config', () => ({ resolveConfig: vi.fn() }));

import { createApplyDestinationResolver } from './apply-destinations';
import type { ResolveApplyDestinationsInput } from './apply-planner';
import type { AppConfig } from '$lib/server/config';
import type { ApplyServerRegistry } from './apply-server-registry';
import {
	buildApplyPlanPayload,
	type ApplyItemIdentity,
	type ApplyPlanDestination
} from './apply-plan';
import { LEGACY_FILENAME, MOVIE_FILENAME, SHOW_FILENAME } from '$lib/server/kometa/destination';

function input(
	serverInstanceId = 'server-a',
	overrides: Partial<ApplyItemIdentity> = {},
	destinations: ApplyPlanDestination[] = ['kometa']
): ResolveApplyDestinationsInput {
	const identity: ApplyItemIdentity = {
		serverInstanceId,
		mediaItemId: 1,
		librarySectionKey: 'movies',
		sourceId: 'movie-1',
		type: 'movie' as const,
		tmdbId: '101',
		imdbId: null,
		tvdbId: null,
		mediaType: 'movie' as const,
		updatedAt: null,
		selectionUpdatedAt: null,
		selectionRevision: 0,
		...overrides
	};
	const target = {
		item: {
			identity,
			ignored: false,
			sourceRemoved: false,
			discovery: { status: 'succeeded', runId: 'run-1', completedAt: null },
			currentSlots: []
		},
		candidates: [],
		storedSelections: []
	};
	return {
		context: { source: 'single' },
		target,
		selectionFrom: target,
		selections: [
			{
				selectionSource: 'stored',
				sourceItem: { serverInstanceId, mediaItemId: 1 },
				slot: { kind: 'poster', season: null, episode: null },
				candidateId: null,
				url: 'https://art.example/poster.jpg',
				provider: 'custom',
				providerAssetId: null,
				setId: null,
				setAuthor: null,
				designFamily: null,
				language: null,
				discoveryRunId: null,
				resolvedTmdbId: '101',
				resolvedMediaType: 'movie',
				stale: false,
				score: null,
				width: null,
				height: null,
				fingerprint: 'selection-fingerprint'
			}
		],
		destinations
	};
}

function registry(type: 'plex' | 'jellyfin' = 'plex'): ApplyServerRegistry {
	return {
		resolve: vi.fn(async (serverInstanceId: string) => ({
			serverInstanceId,
			fingerprint: `fingerprint-${serverInstanceId}`,
			server: { type } as never
		}))
	};
}

function config(serverInstanceId: string, overrides: Partial<AppConfig> = {}): AppConfig {
	return {
		kometaServerInstanceId: serverInstanceId,
		kometaConfigPath: '',
		kometaAssetsDir: join(tmpdir(), 'posterpilot-apply-destinations-no-legacy'),
		kometaConfigMode: 'merge',
		...overrides
	} as AppConfig;
}

const temporaryDirectories: string[] = [];
const KOMETA_FILE_FINGERPRINT = 'a'.repeat(64);

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe('Kometa apply destination binding', () => {
	it('resolves Kometa only for the exact named Plex instance', async () => {
		const readKometaState = vi.fn(async () => ({
			kometaFileFingerprint: KOMETA_FILE_FINGERPRINT,
			current: {
				url: null,
				fingerprint: null,
				artworkVersion: null,
				observedAt: null,
				destinationFingerprint: 'kometa-state'
			}
		}));
		const resolve = createApplyDestinationResolver({
			serverRegistry: registry('plex'),
			loadConfig: async () => config('server-a'),
			readKometaState
		});

		await expect(resolve(input('server-a'))).resolves.toMatchObject([
			{
				destination: 'kometa',
				targetId: `kometa:v2:movie:tmdb:101:${MOVIE_FILENAME}`,
				kometaDestination: {
					mediaKind: 'movie',
					namespace: 'tmdb',
					mappingId: '101',
					filename: MOVIE_FILENAME
				},
				capability: 'supported'
			}
		]);
		expect(readKometaState).toHaveBeenCalledOnce();
	});

	it('keeps equal movie TMDB and show TVDB numbers isolated by typed file identity', async () => {
		const readKometaState = vi.fn(async () => ({
			kometaFileFingerprint: KOMETA_FILE_FINGERPRINT,
			current: {
				url: null,
				fingerprint: null,
				artworkVersion: null,
				observedAt: null,
				destinationFingerprint: 'state'
			}
		}));
		const resolve = createApplyDestinationResolver({
			serverRegistry: registry(),
			loadConfig: async () => config('server-a'),
			readKometaState
		});

		const [movie] = await resolve(input('server-a'));
		const [show] = await resolve(
			input('server-a', {
				type: 'show',
				mediaType: 'movie',
				tmdbId: '101',
				tvdbId: '101'
			})
		);

		expect(movie.kometaDestination).toMatchObject({
			mediaKind: 'movie',
			namespace: 'tmdb',
			filename: MOVIE_FILENAME,
			mappingId: '101'
		});
		expect(show.kometaDestination).toMatchObject({
			mediaKind: 'show',
			namespace: 'tvdb',
			filename: SHOW_FILENAME,
			mappingId: '101'
		});
		expect(show.targetId).not.toBe(movie.targetId);
	});

	it('reuses one immutable Kometa file snapshot within a request-scoped resolver', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'posterpilot-kometa-request-cache-'));
		temporaryDirectories.push(directory);
		const configPath = join(directory, 'config.yml');
		writeFileSync(configPath, 'settings:\n  cache: true\n');
		writeFileSync(
			join(directory, MOVIE_FILENAME),
			'metadata:\n  101:\n    url_poster: first.jpg\n  202:\n    url_poster: second.jpg\n'
		);
		const loadConfig = vi.fn(async () => config('server-a', { kometaConfigPath: configPath }));
		const resolve = createApplyDestinationResolver({
			serverRegistry: registry(),
			loadConfig,
			cacheKometaReads: true
		});

		const [first] = await resolve(input('server-a', { tmdbId: '101' }));
		writeFileSync(
			join(directory, MOVIE_FILENAME),
			'metadata:\n  101:\n    url_poster: changed.jpg\n  202:\n    url_poster: changed-too.jpg\n'
		);
		const [second] = await resolve(
			input('server-a', { mediaItemId: 2, sourceId: 'movie-2', tmdbId: '202' })
		);

		expect(loadConfig).toHaveBeenCalledOnce();
		expect(first.current.url).toBe('first.jpg');
		expect(second.current.url).toBe('second.jpg');
		expect(second.kometaFileFingerprint).toBe(first.kometaFileFingerprint);
	});

	it('uses authoritative type despite provider type disagreement and falls back to IMDb', async () => {
		const readKometaState = vi.fn(async () => ({
			kometaFileFingerprint: KOMETA_FILE_FINGERPRINT,
			current: {
				url: null,
				fingerprint: null,
				artworkVersion: null,
				observedAt: null,
				destinationFingerprint: 'state'
			}
		}));
		const resolve = createApplyDestinationResolver({
			serverRegistry: registry(),
			loadConfig: async () => config('server-a'),
			readKometaState
		});

		const [show] = await resolve(
			input('server-a', {
				type: 'show',
				mediaType: 'movie',
				tmdbId: '999',
				tvdbId: null,
				imdbId: 'tt1234567'
			})
		);

		expect(show.kometaDestination).toMatchObject({
			mediaKind: 'show',
			namespace: 'imdb',
			mappingId: 'tt1234567',
			filename: SHOW_FILENAME
		});
	});

	it('skips only Kometa when no supported identifier exists and keeps server apply available', async () => {
		const resolve = createApplyDestinationResolver({
			serverRegistry: registry(),
			loadConfig: async () => config('server-a'),
			readKometaState: vi.fn()
		});

		const snapshots = await resolve(
			input('server-a', { tmdbId: null, tvdbId: null, imdbId: null }, ['server', 'kometa'])
		);

		expect(snapshots).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ destination: 'server', targetId: 'movie-1' }),
				expect.objectContaining({
					destination: 'kometa',
					targetId: null,
					skipCode: 'missing_kometa_identifier'
				})
			])
		);
	});

	it('blocks only Kometa while an active library still references the legacy file', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'posterpilot-kometa-collision-'));
		temporaryDirectories.push(directory);
		const configPath = join(directory, 'config.yml');
		const legacyPath = join(directory, LEGACY_FILENAME);
		const configRaw = `libraries:\n  Movies:\n    metadata_files:\n      - file: ${LEGACY_FILENAME}\n`;
		const legacyRaw = 'metadata:\n  101:\n    url_poster: legacy\n';
		writeFileSync(configPath, configRaw);
		writeFileSync(legacyPath, legacyRaw);
		const resolve = createApplyDestinationResolver({
			serverRegistry: registry(),
			loadConfig: async () => config('server-a', { kometaConfigPath: configPath })
		});

		const snapshots = await resolve(input('server-a', {}, ['server', 'kometa']));

		expect(snapshots).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ destination: 'server', targetId: 'movie-1', skipCode: null }),
				expect.objectContaining({
					destination: 'kometa',
					targetId: `kometa:v2:movie:tmdb:101:${MOVIE_FILENAME}`,
					skipCode: 'kometa_migration_required',
					parameters: {
						reason: 'active_legacy_reference',
						legacyFile: LEGACY_FILENAME
					}
				})
			])
		);
		expect(readFileSync(configPath, 'utf8')).toBe(configRaw);
		expect(readFileSync(legacyPath, 'utf8')).toBe(legacyRaw);

		const planningInput = input('server-a', {}, ['server', 'kometa']);
		const payload = buildApplyPlanPayload({
			plannedAt: '2026-08-07T12:00:00.000Z',
			context: { source: 'single' },
			defaults: {
				configuredMethod: 'both',
				effectiveMethod: 'both',
				methodSource: 'explicit',
				selectionMode: 'stored',
				scoring: {
					providerPriority: [],
					weights: { providerWeights: {}, resolutionWeight: 0, aspectWeight: 0 }
				}
			},
			items: [
				{
					target: planningInput.target.item.identity,
					selectionFrom: planningInput.selectionFrom.item.identity,
					discovery: {
						status: 'succeeded',
						runId: 'run-1',
						completedAt: null,
						resolvedTmdbId: '101',
						resolvedMediaType: 'movie',
						candidateIds: [],
						candidateCount: 0,
						fingerprint: 'discovery-state'
					},
					selections: planningInput.selections,
					destinationSlots: snapshots,
					itemSkip: null
				}
			]
		});
		expect(payload.items[0].operations.map((operation) => operation.destination)).toEqual([
			'server'
		]);
		expect(payload.items[0].skips).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					destination: 'kometa',
					code: 'kometa_migration_required'
				})
			])
		);
	});

	it('fails closed for an unmanaged or unknown config when the legacy file exists', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'posterpilot-kometa-unknown-'));
		temporaryDirectories.push(directory);
		writeFileSync(join(directory, LEGACY_FILENAME), 'metadata: {}\n');
		const unmanaged = createApplyDestinationResolver({
			serverRegistry: registry(),
			loadConfig: async () =>
				config('server-a', { kometaConfigPath: '', kometaAssetsDir: directory })
		});

		const [unmanagedSnapshot] = await unmanaged(input('server-a'));
		expect(unmanagedSnapshot).toMatchObject({
			destination: 'kometa',
			skipCode: 'kometa_migration_required',
			parameters: { reason: 'unknown_config_with_legacy_file' }
		});

		const configPath = join(directory, 'config.yml');
		writeFileSync(configPath, 'libraries: [not, a, mapping\n');
		const unknown = createApplyDestinationResolver({
			serverRegistry: registry(),
			loadConfig: async () => config('server-a', { kometaConfigPath: configPath })
		});
		const [unknownSnapshot] = await unknown(input('server-a'));
		expect(unknownSnapshot).toMatchObject({
			skipCode: 'kometa_migration_required',
			parameters: { reason: 'unknown_config_with_legacy_file' }
		});
	});

	it('allows split exports after rewiring and fingerprints config plus the preserved legacy file', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'posterpilot-kometa-migrated-'));
		temporaryDirectories.push(directory);
		const configPath = join(directory, 'config.yml');
		const legacyPath = join(directory, LEGACY_FILENAME);
		writeFileSync(
			configPath,
			`libraries:\n  Movies:\n    metadata_files:\n      - file: ${MOVIE_FILENAME}\n`
		);
		writeFileSync(legacyPath, 'metadata:\n  101:\n    url_poster: preserved\n');
		writeFileSync(join(directory, MOVIE_FILENAME), 'metadata:\n  101:\n    url_poster: split\n');
		const resolve = createApplyDestinationResolver({
			serverRegistry: registry(),
			loadConfig: async () => config('server-a', { kometaConfigPath: configPath })
		});

		const [initial] = await resolve(input('server-a'));
		expect(initial.skipCode).toBeNull();

		writeFileSync(legacyPath, 'metadata:\n  101:\n    url_poster: externally-changed\n');
		const [legacyChanged] = await resolve(input('server-a'));
		expect(legacyChanged.skipCode).toBeNull();
		expect(legacyChanged.kometaFileFingerprint).toBe(initial.kometaFileFingerprint);
		expect(legacyChanged.current.destinationFingerprint).not.toBe(
			initial.current.destinationFingerprint
		);

		writeFileSync(
			configPath,
			`libraries:\n  Movies:\n    metadata_files:\n      - file: ${MOVIE_FILENAME}\nsettings:\n  cache: true\n`
		);
		const [configChanged] = await resolve(input('server-a'));
		expect(configChanged.skipCode).toBeNull();
		expect(configChanged.kometaFileFingerprint).toBe(legacyChanged.kometaFileFingerprint);
		expect(configChanged.current.destinationFingerprint).not.toBe(
			legacyChanged.current.destinationFingerprint
		);
	});

	it('fingerprints the exact typed file and ignores changes to the non-target split file', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'posterpilot-kometa-destination-'));
		temporaryDirectories.push(directory);
		writeFileSync(join(directory, MOVIE_FILENAME), 'metadata:\n  101:\n    url_poster: old\n');
		writeFileSync(join(directory, SHOW_FILENAME), 'metadata:\n  101:\n    url_poster: show\n');
		const resolve = createApplyDestinationResolver({
			serverRegistry: registry(),
			loadConfig: async () =>
				config('server-a', { kometaConfigPath: join(directory, 'config.yml') })
		});

		const [initial] = await resolve(input('server-a'));
		writeFileSync(join(directory, SHOW_FILENAME), 'metadata:\n  101:\n    url_poster: changed\n');
		const [unrelatedChanged] = await resolve(input('server-a'));
		expect(unrelatedChanged.kometaFileFingerprint).toBe(initial.kometaFileFingerprint);
		expect(unrelatedChanged.current.destinationFingerprint).toBe(
			initial.current.destinationFingerprint
		);

		writeFileSync(join(directory, MOVIE_FILENAME), 'metadata:\n  101:\n    url_poster: changed\n');
		const [targetChanged] = await resolve(input('server-a'));
		expect(targetChanged.kometaFileFingerprint).not.toBe(initial.kometaFileFingerprint);
		expect(targetChanged.current.destinationFingerprint).not.toBe(
			initial.current.destinationFingerprint
		);
	});

	it('rejects a different server scope before reading or writing Kometa state', async () => {
		const readKometaState = vi.fn();
		const resolve = createApplyDestinationResolver({
			serverRegistry: registry('plex'),
			loadConfig: async () => config('server-b'),
			readKometaState
		});

		await expect(resolve(input('server-a'))).rejects.toMatchObject({ code: 'scope_mismatch' });
		expect(readKometaState).not.toHaveBeenCalled();
	});

	it('rejects a non-Plex instance even when its id matches the configured binding', async () => {
		const resolve = createApplyDestinationResolver({
			serverRegistry: registry('jellyfin'),
			loadConfig: async () => config('server-a'),
			readKometaState: vi.fn()
		});

		await expect(resolve(input('server-a'))).rejects.toMatchObject({ code: 'scope_mismatch' });
	});
});
