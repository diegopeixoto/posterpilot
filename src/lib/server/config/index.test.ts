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
	inArray: (_col: unknown, vals: string[]) => ({ __keys: vals })
}));
vi.mock('$lib/server/db', () => ({
	db: {
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
	}
}));

import {
	resolveConfig,
	getKometaManagedLibraries,
	setKometaManagedLibraries,
	getKometaDefaultCollections,
	setKometaDefaultCollections,
	getKometaLastApplied,
	setKometaLastApplied
} from './index';

beforeEach(() => {
	for (const k of Object.keys(h.env)) delete h.env[k];
	h.store.clear();
});

describe('resolveConfig — Kometa keys', () => {
	it('defaults: config path empty (off), metadata path falls back to assets dir, mode merge', async () => {
		const c = await resolveConfig();
		expect(c.kometaConfigPath).toBe('');
		expect(c.kometaMetadataPath).toBe(c.kometaAssetsDir);
		expect(c.kometaConfigMode).toBe('merge');
	});

	it('env wins over persisted for the config path', async () => {
		h.store.set('kometaConfigPath', '/db/config.yml');
		expect((await resolveConfig()).kometaConfigPath).toBe('/db/config.yml');
		h.env.KOMETA_CONFIG_PATH = '/env/config.yml';
		expect((await resolveConfig()).kometaConfigPath).toBe('/env/config.yml');
	});

	it('parses mode, treating anything but "own" as merge', async () => {
		h.store.set('kometaConfigMode', 'own');
		expect((await resolveConfig()).kometaConfigMode).toBe('own');
		h.store.set('kometaConfigMode', 'nonsense');
		expect((await resolveConfig()).kometaConfigMode).toBe('merge');
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
		expect(await getKometaLastApplied()).toBeNull();
		const snap = {
			metadataPath: '/a/posterpilot.yml',
			libraries: { Movies: { metadata: true, defaults: ['studio'] } },
			managedSettingKeys: ['webhooks.error']
		};
		await setKometaLastApplied(snap);
		expect(await getKometaLastApplied()).toEqual(snap);
	});
});
