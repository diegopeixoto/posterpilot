import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse } from 'yaml';
import { LEGACY_FILENAME, MOVIE_FILENAME, SHOW_FILENAME } from './destination';

const h = vi.hoisted(() => ({
	config: {} as Record<string, unknown>,
	managedSettings: {} as Record<string, string>,
	cachedLibraries: [] as { key: string; title: string; type: string }[],
	logEvent: vi.fn(),
	setKometaManagedLibraries: vi.fn(),
	setKometaDefaultCollections: vi.fn(),
	setKometaManagedSettings: vi.fn(),
	setKometaLastApplied: vi.fn()
}));

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

vi.mock('$lib/server/config', () => ({
	resolveConfig: async () => h.config,
	getCachedLibraries: async () => h.cachedLibraries,
	getKometaDefaultCollections: async () => ({}),
	getKometaLastApplied: async () => null,
	getKometaManagedLibraries: async () => [],
	getKometaManagedSettings: async () => h.managedSettings,
	setKometaDefaultCollections: h.setKometaDefaultCollections,
	setKometaLastApplied: h.setKometaLastApplied,
	setKometaManagedLibraries: h.setKometaManagedLibraries,
	setKometaManagedSettings: h.setKometaManagedSettings
}));

vi.mock('$lib/server/events', () => ({ logEvent: h.logEvent }));
vi.mock('./server-binding', () => ({
	resolveKometaServerBinding: async () => ({
		status: 'ready',
		binding: {
			id: 'server-a',
			name: 'Plex A',
			plexUrl: 'http://plex-a',
			plexToken: 'plex-secret'
		}
	}),
	kometaBindingErrorCode: (status: string) => `kometa_server_binding_${status}`
}));

import { db } from '$lib/server/db';
import { operationPlans } from '$lib/server/db/schema';
import {
	confirmRawConfig,
	confirmRestoreConfig,
	loadKometaState,
	previewSync,
	previewRawConfig,
	previewRestoreConfig,
	runSync
} from './sync';

let directory: string;
let configPath: string;

function selection(libraries: string[]) {
	return {
		libraries,
		defaults: {},
		overlays: {},
		operations: {},
		librarySettings: {},
		connections: {},
		settings: {},
		webhooks: {}
	};
}

beforeAll(() => {
	directory = mkdtempSync(join(tmpdir(), 'posterpilot-kometa-plan-'));
	configPath = join(directory, 'config.yml');
});

beforeEach(async () => {
	vi.clearAllMocks();
	await db.delete(operationPlans);
	h.config = {
		kometaConfigPath: configPath,
		kometaConfigMode: 'merge',
		kometaServerInstanceId: 'server-a',
		kometaAssetsDir: directory,
		tmdbKey: 'tmdb-secret'
	};
	h.managedSettings = {};
	h.cachedLibraries = [];
	writeFileSync(configPath, 'settings:\n  cache: true\n', 'utf8');
});

afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe('Kometa raw/restore exact confirmation', () => {
	it('freezes and writes one authoritative typed metadata file per movie/show library', async () => {
		h.cachedLibraries = [
			{ key: '1', title: 'Movies', type: 'movie' },
			{ key: '2', title: 'TV Shows', type: 'show' }
		];
		const preview = await previewSync(selection(['1', '2']));
		expect(preview.planId).toBeTruthy();
		expect(JSON.stringify(preview.changes)).toContain(MOVIE_FILENAME);
		expect(JSON.stringify(preview.changes)).toContain(SHOW_FILENAME);
		expect(JSON.stringify(preview.changes)).not.toContain(LEGACY_FILENAME);

		await runSync({ planId: preview.planId!, digest: preview.digest! });
		const written = parse(readFileSync(configPath, 'utf8')) as {
			libraries: Record<string, { metadata_files: { file: string }[] }>;
		};
		expect(written.libraries.Movies.metadata_files).toEqual([{ file: MOVIE_FILENAME }]);
		expect(written.libraries['TV Shows'].metadata_files).toEqual([{ file: SHOW_FILENAME }]);
		expect(h.setKometaLastApplied).toHaveBeenCalledWith(
			expect.objectContaining({
				libraries: expect.objectContaining({
					Movies: expect.objectContaining({ metadataFile: MOVIE_FILENAME }),
					'TV Shows': expect.objectContaining({ metadataFile: SHOW_FILENAME })
				})
			})
		);
	});

	it('requires the dedicated migration before structured sync rewires a legacy reference', async () => {
		h.cachedLibraries = [{ key: '1', title: 'Movies', type: 'movie' }];
		const legacyConfig = `libraries:
  Movies:
    metadata_files:
      - file: config/${LEGACY_FILENAME}
settings:
  cache: true
`;
		writeFileSync(configPath, legacyConfig, 'utf8');

		const preview = await previewSync(selection(['1']));

		expect(preview).toMatchObject({
			planId: null,
			digest: null,
			warnings: ['kometa_migration_required'],
			changes: []
		});
		expect(await db.select().from(operationPlans)).toHaveLength(0);
		expect(readFileSync(configPath, 'utf8')).toBe(legacyConfig);
	});

	it('fails closed without a plan when the existing layout cannot be classified', async () => {
		h.cachedLibraries = [{ key: '1', title: 'Movies', type: 'movie' }];
		const unknownConfig = `libraries:
  Movies:
    metadata_files:
      file: ${LEGACY_FILENAME}
settings:
  cache: true
`;
		writeFileSync(configPath, unknownConfig, 'utf8');

		const preview = await previewSync(selection(['1']));

		expect(preview).toMatchObject({
			planId: null,
			digest: null,
			warnings: ['kometa_migration_required'],
			changes: []
		});
		expect(await db.select().from(operationPlans)).toHaveLength(0);
		expect(readFileSync(configPath, 'utf8')).toBe(unknownConfig);
	});

	it('fails visibly and without a plan for a missing cached library', async () => {
		h.cachedLibraries = [];
		const before = readFileSync(configPath, 'utf8');
		const preview = await previewSync(selection(['1']));
		expect(preview).toMatchObject({
			planId: null,
			digest: null,
			warnings: ['kometa_library_missing'],
			changes: []
		});
		expect(await db.select().from(operationPlans)).toHaveLength(0);
		expect(readFileSync(configPath, 'utf8')).toBe(before);
	});

	it('skips an unsupported library without aborting supported config changes', async () => {
		h.cachedLibraries = [
			{ key: '1', title: 'Movies', type: 'movie' },
			{ key: '2', title: 'Music', type: 'artist' }
		];
		const preview = await previewSync(selection(['1', '2']));

		expect(preview.planId).toBeTruthy();
		expect(preview.warnings).toContain('kometa_library_type_unsupported');
		expect(JSON.stringify(preview.changes)).toContain('Movies');
		expect(JSON.stringify(preview.changes)).not.toContain('Music');

		await runSync({ planId: preview.planId!, digest: preview.digest! });
		expect(h.setKometaManagedLibraries).toHaveBeenCalledWith(['1']);
		const written = parse(readFileSync(configPath, 'utf8')) as {
			libraries: Record<string, unknown>;
		};
		expect(written.libraries).toHaveProperty('Movies');
		expect(written.libraries).not.toHaveProperty('Music');
	});

	it('freezes a structured selection, redacts secrets, and requires single-use confirmation', async () => {
		const selection = {
			libraries: [],
			defaults: {},
			overlays: {},
			operations: {},
			librarySettings: {},
			connections: {},
			settings: {},
			webhooks: {}
		};
		const preview = await previewSync(selection);
		expect(preview.planId).toBeTruthy();
		expect(JSON.stringify(preview)).not.toContain('plex-secret');
		expect(JSON.stringify(preview)).not.toContain('tmdb-secret');

		await expect(
			runSync({ planId: preview.planId!, digest: preview.digest! })
		).resolves.toMatchObject({ active: true, backup: true });
		const written = readFileSync(configPath, 'utf8');
		expect(written).toContain('plex-secret');
		expect(written).toContain('tmdb-secret');
		expect(h.setKometaManagedLibraries).toHaveBeenCalledWith([]);
		await expect(
			runSync({ planId: preview.planId!, digest: preview.digest! })
		).rejects.toMatchObject({ code: 'plan_consumed' });
	});

	it('returns only webhook set-state in SSR and preserves a masked value on sync', async () => {
		const webhook = 'https://discord.com/api/webhooks/123/secret-token';
		h.managedSettings = { webhook_error: webhook };
		writeFileSync(configPath, `webhooks:\n  error: ${webhook}\n`, 'utf8');

		const state = await loadKometaState();
		expect(JSON.stringify(state)).not.toContain(webhook);
		expect(state.managedSettings).not.toHaveProperty('webhook_error');
		expect(state.managedSettingSecretsSet).toContain('webhook_error');
		expect(state.globals.webhooksSet).toContain('error');

		const selection = {
			libraries: [],
			defaults: {},
			overlays: {},
			operations: {},
			librarySettings: {},
			connections: {},
			settings: {},
			webhooks: {}
		};
		const preview = await previewSync(selection);
		expect(JSON.stringify(preview)).not.toContain(webhook);
		await runSync({ planId: preview.planId!, digest: preview.digest! });
		expect(readFileSync(configPath, 'utf8')).toContain(webhook);
		expect(h.setKometaManagedSettings).toHaveBeenCalledWith({ webhook_error: webhook });
	});

	it('redacts a replacement webhook from structured preview and writes it only after confirm', async () => {
		const webhook = 'https://discord.com/api/webhooks/123/secret-token';
		const selection = {
			libraries: [],
			defaults: {},
			overlays: {},
			operations: {},
			librarySettings: {},
			connections: {},
			settings: { webhook_run_end: webhook },
			webhooks: {}
		};
		const preview = await previewSync(selection);
		expect(JSON.stringify(preview)).not.toContain(webhook);
		expect(preview.changes).toContainEqual(
			expect.objectContaining({ path: 'webhooks.run_end', after: '***' })
		);
		await runSync({ planId: preview.planId!, digest: preview.digest! });
		expect(readFileSync(configPath, 'utf8')).toContain(webhook);
	});

	it('restores a server-held webhook in own mode without sending it through SSR', async () => {
		const webhook = 'https://discord.com/api/webhooks/123/secret-token';
		h.config.kometaConfigMode = 'own';
		h.managedSettings = { webhook_run_start: webhook };
		const selection = {
			libraries: [],
			defaults: {},
			overlays: {},
			operations: {},
			librarySettings: {},
			connections: {},
			settings: {},
			webhooks: {}
		};

		const state = await loadKometaState();
		expect(JSON.stringify(state)).not.toContain(webhook);
		expect(state.managedSettingSecretsSet).toContain('webhook_run_start');
		const preview = await previewSync(selection);
		expect(JSON.stringify(preview)).not.toContain(webhook);
		await runSync({ planId: preview.planId!, digest: preview.digest! });
		expect(readFileSync(configPath, 'utf8')).toContain(webhook);
	});

	it('rejects source drift, then writes only a fresh frozen raw preview once', async () => {
		const stale = await previewRawConfig('settings:\n  cache: false\n');
		expect(stale.planId).toBeTruthy();
		writeFileSync(configPath, 'settings:\n  cache: external\n', 'utf8');

		await expect(
			confirmRawConfig({ planId: stale.planId!, digest: stale.digest! })
		).rejects.toMatchObject({ code: 'plan_stale' });
		expect(readFileSync(configPath, 'utf8')).toContain('external');

		const fresh = await previewRawConfig('settings:\n  cache: false\n');
		await expect(
			confirmRawConfig({ planId: fresh.planId!, digest: fresh.digest! })
		).resolves.toMatchObject({ ok: true, backup: true });
		expect(readFileSync(configPath, 'utf8')).toBe('settings:\n  cache: false\n');
		await expect(
			confirmRawConfig({ planId: fresh.planId!, digest: fresh.digest! })
		).rejects.toMatchObject({ code: 'plan_consumed' });
	});

	it('redacts raw secrets in the preview while writing the exact server-held content', async () => {
		const proposed = 'plex:\n  token: new-secret\n';
		const preview = await previewRawConfig(proposed);
		expect(JSON.stringify(preview)).not.toContain('new-secret');
		await confirmRawConfig({ planId: preview.planId!, digest: preview.digest! });
		expect(readFileSync(configPath, 'utf8')).toBe(proposed);
	});

	it('redacts webhook URLs from raw and restore previews', async () => {
		const webhook = 'https://discord.com/api/webhooks/123/secret-token';
		const proposed = `webhooks:\n  error: ${webhook}\n`;
		const rawPreview = await previewRawConfig(proposed);
		expect(JSON.stringify(rawPreview)).not.toContain(webhook);

		const name = 'config.yml.posterpilot-bak-webhook';
		writeFileSync(join(directory, name), proposed, 'utf8');
		const restorePreview = await previewRestoreConfig(name);
		expect(JSON.stringify(restorePreview)).not.toContain(webhook);
	});

	it('rejects a restore when the selected backup changes after preview', async () => {
		const name = 'config.yml.posterpilot-bak-fixture';
		const backupPath = join(directory, name);
		writeFileSync(backupPath, 'settings:\n  cache: restored\n', 'utf8');
		const preview = await previewRestoreConfig(name);
		expect(preview.planId).toBeTruthy();

		writeFileSync(backupPath, 'settings:\n  cache: replaced\n', 'utf8');
		await expect(
			confirmRestoreConfig({ planId: preview.planId!, digest: preview.digest! })
		).rejects.toMatchObject({ code: 'plan_stale' });
		expect(readFileSync(configPath, 'utf8')).toBe('settings:\n  cache: true\n');
	});
});
