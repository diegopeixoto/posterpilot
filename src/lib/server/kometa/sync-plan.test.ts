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
	setKometaLastApplied: vi.fn(),
	commitKometaConfigMutationState: vi.fn(),
	configCheckpoint: null as Record<string, unknown> | null,
	proofSequence: 0,
	migrationState: null as Record<string, unknown> | null,
	loadCurrentMigrationState: vi.fn(),
	migrationJournal: null as null | {
		migrationId: string;
		status: string;
		activationEvidence: null;
		completedAt: null;
		payload: {
			serverInstanceId: string;
			outputDirectory: string;
			metadataPathPrefix: string;
			config: { path: string | null; mode: string };
			references: { movie: string; show: string };
		};
	}
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
	await client.execute(
		`CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)`
	);
	return { db: drizzle(client, { schema }), migrateDb: async () => undefined };
});

vi.mock('$lib/server/config', () => ({
	resolveConfig: async () => h.config,
	getCachedLibraries: async () => h.cachedLibraries,
	getKometaDefaultCollections: async () => ({}),
	getKometaLastApplied: async () => null,
	getKometaManagedLibraries: async () => [],
	getKometaManagedSettings: async () => h.managedSettings,
	commitKometaConfigMutationState: async (state: {
		managedSettings: Record<string, string>;
		structured?: {
			managedLibraries: string[];
			defaultCollections: Record<string, string[]>;
			lastApplied: unknown;
			scope: unknown;
		};
	}) => {
		h.commitKometaConfigMutationState(state);
		if (state.structured) {
			await h.setKometaManagedLibraries(state.structured.managedLibraries);
			await h.setKometaDefaultCollections(state.structured.defaultCollections);
			await h.setKometaLastApplied(state.structured.lastApplied, state.structured.scope);
		}
		await h.setKometaManagedSettings(state.managedSettings);
	},
	setKometaDefaultCollections: h.setKometaDefaultCollections,
	setKometaLastApplied: h.setKometaLastApplied,
	setKometaManagedLibraries: h.setKometaManagedLibraries,
	setKometaManagedSettings: h.setKometaManagedSettings
}));

vi.mock('$lib/server/events', () => ({ logEvent: h.logEvent }));
vi.mock('./config-mutation-checkpoint', () => ({
	loadKometaConfigMutationCheckpoint: async () => h.configCheckpoint,
	createKometaConfigMutationCheckpoint: (input: Record<string, unknown>) => ({
		type: 'kometa_config_mutation_checkpoint',
		version: 1,
		status: 'prepared',
		checkpointId: `checkpoint-${++h.proofSequence}`,
		proofToken: `proof-${String(h.proofSequence).padStart(8, '0')}`,
		...input
	}),
	prepareKometaConfigMutationCheckpoint: async (checkpoint: Record<string, unknown>) => {
		h.configCheckpoint = checkpoint;
		return checkpoint;
	},
	discardKometaConfigMutationCheckpoint: async (checkpoint: Record<string, unknown>) => {
		if (h.configCheckpoint === checkpoint) h.configCheckpoint = null;
	}
}));
vi.mock('./config-mutation-recovery', () => ({
	publicKometaConfigMutationRecoveryState: async () => null,
	assertNoPendingKometaConfigMutationWhileOwned: async (
		assertControlLockOwned: () => Promise<unknown>
	) => {
		if (h.configCheckpoint) throw new Error('kometa_config_recovery_required');
		return assertControlLockOwned();
	},
	completePreparedKometaConfigMutation: async (
		checkpoint: {
			stateCommit: {
				managedSettings: Record<string, string>;
				structured?: {
					managedLibraries: string[];
					defaultCollections: Record<string, string[]>;
					lastApplied: unknown;
					scope: unknown;
				};
			};
		},
		assertControlLockOwned: () => Promise<unknown>
	) => {
		await assertControlLockOwned();
		const state = checkpoint.stateCommit;
		h.commitKometaConfigMutationState(state);
		if (state.structured) {
			await h.setKometaManagedLibraries(state.structured.managedLibraries);
			await h.setKometaDefaultCollections(state.structured.defaultCollections);
			await h.setKometaLastApplied(state.structured.lastApplied, state.structured.scope);
		}
		await h.setKometaManagedSettings(state.managedSettings);
		h.configCheckpoint = null;
		return { ...checkpoint, status: 'completed' };
	}
}));
vi.mock('./migration-store', () => ({
	loadKometaMigrationJournalForGuard: async (serverInstanceId: string) => {
		if (
			h.migrationJournal &&
			h.migrationJournal.status !== 'completed' &&
			h.migrationJournal.status !== 'rolled_back'
		) {
			return h.migrationJournal;
		}
		return h.migrationJournal?.payload.serverInstanceId === serverInstanceId
			? h.migrationJournal
			: null;
	}
}));
vi.mock('./migration', () => ({
	loadCurrentKometaMigrationState: h.loadCurrentMigrationState
}));
vi.mock('./server-binding', () => ({
	resolveKometaServerBinding: async (serverInstanceId: string | null) => ({
		status: 'ready',
		binding: {
			id: serverInstanceId ?? 'legacy-default',
			name: serverInstanceId === 'server-a' ? 'Plex A' : 'Plex B',
			plexUrl: 'http://plex-a',
			plexToken: 'plex-secret'
		}
	}),
	kometaBindingErrorCode: (status: string) => `kometa_server_binding_${status}`
}));

import { db } from '$lib/server/db';
import { operationPlans, settings } from '$lib/server/db/schema';
import { operationPlanStore } from '$lib/server/plans/operation-plan-store';
import { createKometaMigrationControlLock } from './migration-control-lock';
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

function migrationJournal(
	status: string,
	overrides: { metadataPathPrefix?: string } = {}
): NonNullable<typeof h.migrationJournal> {
	return {
		migrationId: 'migration-fixture',
		status,
		activationEvidence: null,
		completedAt: null,
		payload: {
			serverInstanceId: 'server-a',
			outputDirectory: directory,
			metadataPathPrefix: overrides.metadataPathPrefix ?? 'config',
			config: { path: configPath, mode: 'merge' },
			references: {
				movie: `config/${MOVIE_FILENAME}`,
				show: `config/${SHOW_FILENAME}`
			}
		}
	};
}

beforeAll(() => {
	directory = mkdtempSync(join(tmpdir(), 'posterpilot-kometa-plan-'));
	configPath = join(directory, 'config.yml');
});

beforeEach(async () => {
	vi.clearAllMocks();
	await db.delete(operationPlans);
	await db.delete(settings);
	h.config = {
		kometaConfigPath: configPath,
		kometaMetadataPathPrefix: 'config',
		kometaConfigMode: 'merge',
		kometaServerInstanceId: 'server-a',
		kometaAssetsDir: directory,
		tmdbKey: 'tmdb-secret'
	};
	h.managedSettings = {};
	h.cachedLibraries = [];
	h.migrationState = null;
	h.loadCurrentMigrationState.mockImplementation(async () => h.migrationState);
	h.migrationJournal = null;
	h.configCheckpoint = null;
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
		expect(written.libraries.Movies.metadata_files).toEqual([{ file: `config/${MOVIE_FILENAME}` }]);
		expect(written.libraries['TV Shows'].metadata_files).toEqual([
			{ file: `config/${SHOW_FILENAME}` }
		]);
		expect(h.setKometaLastApplied).toHaveBeenCalledWith(
			expect.objectContaining({
				metadataPathPrefix: 'config',
				libraries: expect.objectContaining({
					Movies: expect.objectContaining({
						metadataReference: `config/${MOVIE_FILENAME}`
					}),
					'TV Shows': expect.objectContaining({
						metadataReference: `config/${SHOW_FILENAME}`
					})
				})
			}),
			expect.objectContaining({
				serverInstanceId: 'server-a',
				configPath: expect.stringContaining('/config.yml'),
				outputDirectory: expect.stringContaining('posterpilot-kometa-plan-'),
				metadataPathPrefix: 'config'
			})
		);
	});

	it('deduplicates repeated section keys before freezing config and snapshot ownership', async () => {
		h.cachedLibraries = [{ key: '1', title: 'Movies', type: 'movie' }];

		const preview = await previewSync(selection(['1', '1']));
		expect(preview.planId).toBeTruthy();
		await runSync({ planId: preview.planId!, digest: preview.digest! });

		expect(h.setKometaManagedLibraries).toHaveBeenCalledWith(['1']);
		expect(h.setKometaLastApplied).toHaveBeenCalledWith(
			expect.objectContaining({
				libraries: {
					Movies: expect.objectContaining({
						metadataReference: `config/${MOVIE_FILENAME}`
					})
				}
			}),
			expect.any(Object)
		);
	});

	it('fails closed when distinct selected sections collide on one Kometa library title', async () => {
		h.cachedLibraries = [
			{ key: '1', title: 'Shared', type: 'movie' },
			{ key: '2', title: 'Shared', type: 'show' }
		];

		const preview = await previewSync(selection(['1', '2']));

		expect(preview).toMatchObject({
			planId: null,
			digest: null,
			warnings: ['kometa_library_title_conflict'],
			changes: []
		});
		expect(await db.select().from(operationPlans)).toHaveLength(0);
	});

	it('ignores an unsupported section when its title matches a supported library', async () => {
		h.cachedLibraries = [
			{ key: '1', title: 'Shared', type: 'movie' },
			{ key: '2', title: 'Shared', type: 'artist' }
		];

		const preview = await previewSync(selection(['1', '2']));

		expect(preview.planId).toBeTruthy();
		expect(preview.warnings).toContain('kometa_library_type_unsupported');
		expect(preview.warnings).not.toContain('kometa_library_title_conflict');
	});

	it('recognizes prefixed PosterPilot files by basename, including Windows references', async () => {
		writeFileSync(
			configPath,
			`libraries:
  Movies:
    metadata_files:
      - file: config/${MOVIE_FILENAME}
  TV Shows:
    metadata_files:
      - file: config\\${SHOW_FILENAME}
`,
			'utf8'
		);
		const state = await loadKometaState();
		expect(state.libraryState.Movies.hasMetadata).toBe(true);
		expect(state.libraryState['TV Shows'].hasMetadata).toBe(true);
		expect(state.metadataFiles).toEqual({ movie: MOVIE_FILENAME, show: SHOW_FILENAME });
		expect(state.metadataReferences).toEqual({
			movie: `config/${MOVIE_FILENAME}`,
			show: `config/${SHOW_FILENAME}`
		});
	});

	it('rejects a structured confirmation when the visible prefix changes after preview', async () => {
		h.cachedLibraries = [{ key: '1', title: 'Movies', type: 'movie' }];
		const preview = await previewSync(selection(['1']));
		expect(preview.planId).toBeTruthy();

		h.config.kometaMetadataPathPrefix = 'metadata';
		await expect(
			runSync({ planId: preview.planId!, digest: preview.digest! })
		).rejects.toMatchObject({ code: 'plan_stale' });
		expect(readFileSync(configPath, 'utf8')).toBe('settings:\n  cache: true\n');
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

	it('blocks every normal config preview while an in-scope migration is resumable', async () => {
		h.migrationJournal = migrationJournal('config_written');
		const backupName = 'config.yml.posterpilot-bak-migration-lock';
		writeFileSync(join(directory, backupName), 'settings:\n  cache: restored\n', 'utf8');

		const [structured, raw, restore] = await Promise.all([
			previewSync(selection([])),
			previewRawConfig('settings:\n  cache: false\n'),
			previewRestoreConfig(backupName)
		]);

		expect(structured).toMatchObject({
			planId: null,
			warnings: ['kometa_migration_config_locked']
		});
		expect(raw).toMatchObject({
			ok: false,
			errorCode: 'kometa_migration_config_locked'
		});
		expect(restore).toMatchObject({
			ok: false,
			errorCode: 'kometa_migration_config_locked'
		});
		expect(await db.select().from(operationPlans)).toHaveLength(0);
	});

	it('uses the recovery-aware migration projection in the Kometa page loader', async () => {
		h.migrationJournal = migrationJournal('recovery_required');
		h.migrationState = {
			migrationId: 'migration-recovery',
			status: 'recovery_required',
			scopeMatches: true,
			canResume: false,
			canRestartPreview: false,
			canAbandon: false,
			canRollback: true,
			recoveryGuidance: 'proposed_safe_to_rollback'
		};

		const state = await loadKometaState();

		expect(h.loadCurrentMigrationState).toHaveBeenCalledOnce();
		expect(state.migration).toMatchObject({
			status: 'recovery_required',
			scopeMatches: true,
			canRollback: true,
			recoveryGuidance: 'proposed_safe_to_rollback'
		});
		expect(state.migrationStateError).toBeNull();
	});

	it('keeps the frozen migration visible and guarded after the configured binding drifts A to B', async () => {
		h.migrationJournal = migrationJournal('writing_splits');
		h.config.kometaServerInstanceId = 'server-b';
		h.migrationState = {
			migrationId: 'migration-fixture',
			status: 'writing_splits',
			scopeMatches: false,
			frozenScope: { serverInstanceId: 'server-a' },
			canResume: false,
			canRollback: false
		};

		const state = await loadKometaState();

		expect(state.migration).toMatchObject({
			migrationId: 'migration-fixture',
			scopeMatches: false,
			frozenScope: { serverInstanceId: 'server-a' }
		});
		expect(state.migrationRequired).toBe(true);
		expect(state.migrationStateError).toBeNull();
	});

	it('allows only raw preview while manual wiring awaits acknowledgment', async () => {
		h.migrationJournal = migrationJournal('awaiting_manual_wiring');

		const structured = await previewSync(selection([]));
		const raw = await previewRawConfig('settings:\n  cache: false\n');

		expect(structured).toMatchObject({
			planId: null,
			warnings: ['kometa_migration_config_locked']
		});
		expect(raw).toMatchObject({ ok: true, action: 'raw' });
		expect(raw.planId).toBeTruthy();
	});

	it('rechecks the migration journal under the config lock before confirmation', async () => {
		const preview = await previewRawConfig('settings:\n  cache: false\n');
		expect(preview.planId).toBeTruthy();

		h.migrationJournal = migrationJournal('prepared');
		await expect(
			confirmRawConfig({ planId: preview.planId!, digest: preview.digest! })
		).rejects.toMatchObject({ code: 'plan_stale' });
		expect(readFileSync(configPath, 'utf8')).toBe('settings:\n  cache: true\n');
	});

	it('preserves an external edit that lands after plan consumption but before publish', async () => {
		const preview = await previewRawConfig('settings:\n  cache: false\n');
		expect(preview.planId).toBeTruthy();
		const consumeSpy = vi.spyOn(operationPlanStore, 'consume');
		consumeSpy.mockImplementationOnce(async (planId, expected) => {
			consumeSpy.mockRestore();
			const consumed = await operationPlanStore.consume(planId, expected);
			writeFileSync(configPath, 'settings:\n  cache: external\n', 'utf8');
			return consumed;
		});

		await expect(
			confirmRawConfig({ planId: preview.planId!, digest: preview.digest! })
		).rejects.toMatchObject({ code: 'plan_stale' });
		expect(readFileSync(configPath, 'utf8')).toBe('settings:\n  cache: external\n');
	});

	it('finishes config persistence before a second process can install a migration journal', async () => {
		const preview = await previewRawConfig('settings:\n  cache: false\n');
		expect(preview.planId).toBeTruthy();
		let releasePersistence!: () => void;
		let persistenceEntered!: () => void;
		const entered = new Promise<void>((resolve) => {
			persistenceEntered = resolve;
		});
		const release = new Promise<void>((resolve) => {
			releasePersistence = resolve;
		});
		h.setKometaManagedSettings.mockImplementationOnce(async () => {
			persistenceEntered();
			await release;
		});

		const confirmation = confirmRawConfig({ planId: preview.planId!, digest: preview.digest! });
		await entered;
		expect(readFileSync(configPath, 'utf8')).toBe('settings:\n  cache: false\n');

		const secondProcessLock = createKometaMigrationControlLock(db, {
			leaseMs: 2_000,
			pollIntervalMs: 5,
			owner: () => 'migration-process'
		});
		let migrationEntered = false;
		const migration = secondProcessLock(async () => {
			migrationEntered = true;
			h.migrationJournal = migrationJournal('prepared');
		});
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(migrationEntered).toBe(false);

		releasePersistence();
		await confirmation;
		await migration;
		expect(migrationEntered).toBe(true);
		expect(h.migrationJournal?.status).toBe('prepared');
		expect(readFileSync(configPath, 'utf8')).toBe('settings:\n  cache: false\n');
	});

	it('rechecks the journal after a second process wins the migration control lock', async () => {
		const preview = await previewRawConfig('settings:\n  cache: false\n');
		expect(preview.planId).toBeTruthy();
		const secondProcessLock = createKometaMigrationControlLock(db, {
			leaseMs: 2_000,
			pollIntervalMs: 5,
			owner: () => 'migration-process'
		});
		let releaseMigration!: () => void;
		let migrationEntered!: () => void;
		const entered = new Promise<void>((resolve) => {
			migrationEntered = resolve;
		});
		const release = new Promise<void>((resolve) => {
			releaseMigration = resolve;
		});
		const migration = secondProcessLock(async () => {
			h.migrationJournal = migrationJournal('prepared');
			migrationEntered();
			await release;
		});
		await entered;

		const confirmation = confirmRawConfig({ planId: preview.planId!, digest: preview.digest! });
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(readFileSync(configPath, 'utf8')).toBe('settings:\n  cache: true\n');
		releaseMigration();
		await migration;

		await expect(confirmation).rejects.toMatchObject({ code: 'plan_stale' });
		expect(readFileSync(configPath, 'utf8')).toBe('settings:\n  cache: true\n');
	});

	it('keeps config locked when an active journal has drifted to another metadata scope', async () => {
		h.migrationJournal = migrationJournal('prepared', { metadataPathPrefix: 'other-scope' });

		const preview = await previewRawConfig('settings:\n  cache: false\n');

		expect(preview).toMatchObject({
			ok: false,
			active: true,
			errorCode: 'kometa_migration_config_locked'
		});
		expect(preview.planId).toBeUndefined();
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

	it('commits structured DB ownership even when the confirmed file bytes are unchanged', async () => {
		const empty = selection([]);
		const first = await previewSync(empty);
		await runSync({ planId: first.planId!, digest: first.digest! });
		h.setKometaManagedLibraries.mockClear();
		h.setKometaManagedSettings.mockClear();

		const noOp = await previewSync(empty);
		expect(noOp.planId).toBeTruthy();
		expect(noOp.changes).toEqual([]);
		await expect(runSync({ planId: noOp.planId!, digest: noOp.digest! })).resolves.toMatchObject({
			active: true,
			backup: false
		});
		expect(h.setKometaManagedLibraries).toHaveBeenCalledWith([]);
		expect(h.setKometaManagedSettings).toHaveBeenCalled();
	});

	it('rejects a structured confirmation when a rendered credential changes after preview', async () => {
		const preview = await previewSync(selection([]));
		expect(preview.planId).toBeTruthy();
		h.config.tmdbKey = 'rotated-tmdb-secret';

		await expect(
			runSync({ planId: preview.planId!, digest: preview.digest! })
		).rejects.toMatchObject({ code: 'plan_stale' });
		expect(readFileSync(configPath, 'utf8')).toBe('settings:\n  cache: true\n');
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
