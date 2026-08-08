import { describe, it, expect, beforeEach, vi } from 'vitest';

// config/index.ts is coupled to $env and the db. Mock both so we can exercise the
// new Kometa keys' resolution precedence and the internal KV accessor round-trips
// without a real database or environment. drizzle's `eq`/`inArray` are stubbed to
// carry the key so the fake db can filter.
const h = vi.hoisted(() => ({
	env: {} as Record<string, string>,
	store: new Map<string, string>()
}));

vi.mock('$env/dynamic/private', () => ({ env: h.env }));
vi.mock('drizzle-orm', () => ({
	eq: (_col: unknown, val: string) => ({ __key: val }),
	inArray: (_col: unknown, vals: string[]) => ({ __keys: vals }),
	// schema.ts uses `sql` only to describe partial indexes; this test never executes it.
	sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })
}));
vi.mock('$lib/server/db', () => {
	const database = {
		select: () => ({
			from: () => {
				const all = [...h.store.entries()].map(([key, value]) => ({ key, value }));
				return {
					where: (cond: { __key: string }) => ({
						limit: () => Promise.resolve(all.filter((r) => r.key === cond.__key))
					}),
					then: (resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) =>
						Promise.resolve(all).then(resolve, reject)
				};
			}
		}),
		insert: () => ({
			values: (v: { key: string; value: string }) => ({
				onConflictDoUpdate: () => {
					h.store.set(v.key, v.value);
					return Promise.resolve();
				}
			})
		}),
		delete: () => ({
			where: (cond: { __key: string }) => {
				h.store.delete(cond.__key);
				return Promise.resolve();
			}
		})
	};
	return {
		db: {
			...database,
			transaction: async <T>(operation: (tx: typeof database) => Promise<T>): Promise<T> =>
				operation(database)
		}
	};
});

import {
	resolveConfig,
	publicConfig,
	saveSettings,
	getKometaManagedLibraries,
	setKometaManagedLibraries,
	getKometaDefaultCollections,
	setKometaDefaultCollections,
	getKometaLastApplied,
	setKometaLastApplied,
	getCachedLibraries,
	setCachedLibraries,
	getIncludedSectionsForServer,
	setIncludedSectionsForServer
} from './index';
import type { KometaMigrationControlLease } from '$lib/server/kometa/migration-control-lock';

beforeEach(() => {
	for (const k of Object.keys(h.env)) delete h.env[k];
	h.store.clear();
});

describe('resolveConfig — Kometa keys', () => {
	it('defaults: config path empty (off), metadata prefix config, mode merge', async () => {
		const c = await resolveConfig();
		expect(c.kometaConfigPath).toBe('');
		expect(c.kometaMetadataPathPrefix).toBe('config');
		expect(c.kometaConfigMode).toBe('merge');
		expect(c.kometaServerInstanceId).toBe('legacy-default');
	});

	it('env wins over persisted for the config path', async () => {
		h.store.set('kometaConfigPath', '/db/config.yml');
		expect((await resolveConfig()).kometaConfigPath).toBe('/db/config.yml');
		h.env.KOMETA_CONFIG_PATH = '/env/config.yml';
		expect((await resolveConfig()).kometaConfigPath).toBe('/env/config.yml');
	});

	it('canonicalizes the UI-writable metadata prefix with environment precedence', async () => {
		await saveSettings({ kometaMetadataPathPrefix: './metadata/' });
		expect(h.store.get('kometaMetadataPathPrefix')).toBe('metadata');
		expect((await resolveConfig()).kometaMetadataPathPrefix).toBe('metadata');
		expect((await publicConfig()).kometaMetadataPathPrefix).toBe('metadata');

		h.env.KOMETA_METADATA_PATH_PREFIX = '.\\config\\nested\\';
		const exposed = await publicConfig();
		expect(exposed.kometaMetadataPathPrefix).toBe('config/nested');
		expect(exposed.envManaged.kometaMetadataPathPrefix).toBe(true);
	});

	it('persists an explicit empty prefix separately from the config default', async () => {
		await saveSettings({ kometaMetadataPathPrefix: '' });
		expect(h.store.get('kometaMetadataPathPrefix')).toBe('.');
		expect((await resolveConfig()).kometaMetadataPathPrefix).toBe('');
	});

	it('rejects an unsafe metadata prefix from persisted or environment configuration', async () => {
		h.store.set('kometaMetadataPathPrefix', '../escape');
		await expect(resolveConfig()).rejects.toMatchObject({ code: 'traversal' });
		h.store.clear();
		h.env.KOMETA_METADATA_PATH_PREFIX = 'C:\\config';
		await expect(resolveConfig()).rejects.toMatchObject({ code: 'absolute' });
	});

	it('parses mode, treating anything but "own" as merge', async () => {
		h.store.set('kometaConfigMode', 'own');
		expect((await resolveConfig()).kometaConfigMode).toBe('own');
		h.store.set('kometaConfigMode', 'nonsense');
		expect((await resolveConfig()).kometaConfigMode).toBe('merge');
	});

	it('resolves an explicit Kometa server binding with environment precedence', async () => {
		h.store.set('kometaServerInstanceId', 'plex-db');
		expect((await resolveConfig()).kometaServerInstanceId).toBe('plex-db');
		h.env.KOMETA_SERVER_INSTANCE_ID = 'plex-env';
		expect((await resolveConfig()).kometaServerInstanceId).toBe('plex-env');
	});
});

describe('resolveConfig — TMDB artwork language', () => {
	it('defaults to browsing every language when neither source sets it', async () => {
		expect((await resolveConfig()).tmdbArtworkLanguage).toBe('any');
	});

	it('env wins over persisted for the artwork language', async () => {
		h.store.set('tmdbArtworkLanguage', 'de');
		expect((await resolveConfig()).tmdbArtworkLanguage).toBe('de');
		h.env.TMDB_ARTWORK_LANGUAGE = 'ja';
		expect((await resolveConfig()).tmdbArtworkLanguage).toBe('ja');
	});

	it('falls back to "any" for an unparseable value instead of filtering on it', async () => {
		h.store.set('tmdbArtworkLanguage', 'english');
		expect((await resolveConfig()).tmdbArtworkLanguage).toBe('any');
		h.env.TMDB_ARTWORK_LANGUAGE = 'english';
		expect((await resolveConfig()).tmdbArtworkLanguage).toBe('any');
	});

	it('exposes the resolved value publicly and locks it while env-managed', async () => {
		const open = await publicConfig();
		expect(open.tmdbArtworkLanguage).toBe('any');
		expect(open.envManaged.tmdbArtworkLanguage).toBe(false);

		h.env.TMDB_ARTWORK_LANGUAGE = 'ui';
		const locked = await publicConfig();
		expect(locked.tmdbArtworkLanguage).toBe('ui');
		expect(locked.envManaged.tmdbArtworkLanguage).toBe(true);
	});

	it('narrows a UI-shaped locale to the ISO 639-1 code TMDB tags images with', async () => {
		await saveSettings({ tmdbArtworkLanguage: 'pt-BR' });
		// Stored verbatim; the base-code narrowing happens on resolution, so a later
		// parser change re-reads the user's choice rather than a lossy rewrite of it.
		expect(h.store.get('tmdbArtworkLanguage')).toBe('pt-BR');
		expect((await resolveConfig()).tmdbArtworkLanguage).toBe('pt');
		expect((await publicConfig()).tmdbArtworkLanguage).toBe('pt');
	});
});

describe('server-scoped library settings', () => {
	it('isolates cached libraries with a legacy-only fallback', async () => {
		h.store.set(
			'cachedLibraries',
			JSON.stringify([{ key: 'legacy', title: 'Legacy', type: 'movie' }])
		);
		expect(await getCachedLibraries('legacy-default')).toEqual([
			{ key: 'legacy', title: 'Legacy', type: 'movie' }
		]);
		expect(await getCachedLibraries('server-b')).toEqual([]);

		await setCachedLibraries([{ key: 'same', title: 'A', type: 'movie' }], 'server-a');
		await setCachedLibraries([{ key: 'same', title: 'B', type: 'show' }], 'server-b');
		expect((await getCachedLibraries('server-a'))[0].title).toBe('A');
		expect((await getCachedLibraries('server-b'))[0].title).toBe('B');
	});

	it('isolates included sections and lets the environment override every scope', async () => {
		await setIncludedSectionsForServer('server-a', ['movies', 'movies', ' shows ']);
		await setIncludedSectionsForServer('server-b', ['anime']);
		expect(await getIncludedSectionsForServer('server-a')).toEqual(['movies', 'shows']);
		expect(await getIncludedSectionsForServer('server-b')).toEqual(['anime']);

		h.env.INCLUDED_SECTIONS = 'global-one,global-two';
		expect(await getIncludedSectionsForServer('server-a')).toEqual(['global-one', 'global-two']);
		expect(await getIncludedSectionsForServer('server-b')).toEqual(['global-one', 'global-two']);
	});
});

describe('saveSettings — clearing the ThePosterDB password', () => {
	it('an explicit empty save deletes the stored secret and unsets the public flag', async () => {
		await saveSettings({ thePosterDbPassword: 'hunter2' });
		// Stored encrypted, and reported as set (never echoed back).
		expect(h.store.get('thePosterDbPassword')).toMatch(/^enc:v1:/);
		expect((await publicConfig()).thePosterDbPasswordSet).toBe(true);

		await saveSettings({ thePosterDbPassword: '' });
		expect(h.store.has('thePosterDbPassword')).toBe(false);
		expect((await resolveConfig()).thePosterDbPassword).toBeNull();
		expect((await publicConfig()).thePosterDbPasswordSet).toBe(false);
	});

	it('does not persist any setting when its migration-control lease was lost', async () => {
		await expect(
			saveSettings(
				{ kometaServerInstanceId: 'server-b', kometaAssetsDir: '/data/kometa-b' },
				'stale-control-lease' as KometaMigrationControlLease
			)
		).rejects.toMatchObject({ code: 'lost' });
		expect(h.store).toEqual(new Map());
	});
});

describe('Kometa selection KV accessors', () => {
	it('round-trips managed libraries (string[])', async () => {
		expect(await getKometaManagedLibraries()).toEqual([]);
		await setKometaManagedLibraries(['1', '2']);
		expect(await getKometaManagedLibraries()).toEqual(['1', '2']);
	});

	it('round-trips default collections (map)', async () => {
		await setKometaDefaultCollections({ '1': ['genre', 'studio'] });
		expect(await getKometaDefaultCollections()).toEqual({ '1': ['genre', 'studio'] });
	});

	it('round-trips the last-applied snapshot', async () => {
		const scope = {
			serverInstanceId: 'server-a',
			configPath: '/config/a/config.yml',
			outputDirectory: '/config/a',
			metadataPathPrefix: 'config'
		};
		expect(await getKometaLastApplied(scope)).toBeNull();
		const snap = {
			metadataPath: '/a/posterpilot.yml',
			libraries: { Movies: { metadata: true, defaults: ['studio'] } },
			managedSettingKeys: ['webhooks.error']
		};
		await setKometaLastApplied(snap, scope);
		expect(await getKometaLastApplied(scope)).toEqual(snap);
		expect(
			await getKometaLastApplied({
				...scope,
				serverInstanceId: 'server-b'
			})
		).toBeNull();
		expect(
			await getKometaLastApplied({
				...scope,
				configPath: '/config/b/config.yml',
				outputDirectory: '/config/b'
			})
		).toBeNull();
	});

	it('does not let an unscoped legacy snapshot authorize merge ownership', async () => {
		const legacy = {
			metadataPath: 'posterpilot.yml',
			libraries: { Movies: { metadata: true, defaults: ['studio'] } },
			managedSettingKeys: []
		};
		h.store.set('kometaLastApplied', JSON.stringify(legacy));
		expect(
			await getKometaLastApplied({
				serverInstanceId: 'legacy-default',
				configPath: '/config/config.yml',
				outputDirectory: '/config',
				metadataPathPrefix: 'config'
			})
		).toBeNull();
		expect(h.store.get('kometaLastApplied')).toBe(JSON.stringify(legacy));
	});
});
