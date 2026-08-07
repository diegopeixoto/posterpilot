import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { linkSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LEGACY_FILENAME, MOVIE_FILENAME, SHOW_FILENAME } from './destination';
import { parseLegacyMetadata } from './migration-classifier';

const h = vi.hoisted(() => ({
	config: {} as Record<string, unknown>,
	cached: [] as { key: string; title: string; type: string }[],
	managedKeys: [] as string[],
	snapshot: null as import('./config').KometaSnapshot | null,
	evidence: {
		mappings: [] as import('./migration-classifier').AuthoritativeKometaMapping[],
		revisionMappings: [] as import('./migration-classifier').AuthoritativeKometaMapping[],
		revisions: [] as import('./migration-classifier').NormalizedLegacyRevisionEvidence[]
	},
	journal: null as import('./migration-journal').KometaMigrationJournalV1 | null,
	completedSnapshot: null as import('./config').KometaSnapshot | null,
	rolledBackSnapshot: null as import('./config').KometaSnapshot | null,
	failRollbackPersistence: false,
	bindingId: 'server-a',
	logEvent: vi.fn()
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
	getCachedLibraries: async () => h.cached,
	getKometaManagedLibraries: async () => h.managedKeys,
	getKometaLastApplied: async () => h.snapshot
}));

vi.mock('$lib/server/events', () => ({ logEvent: h.logEvent }));
vi.mock('./server-binding', () => ({
	resolveKometaServerBinding: async () => ({
		status: 'ready',
		binding: {
			id: h.bindingId,
			name: h.bindingId === 'server-a' ? 'Server A' : 'Server B',
			plexUrl: 'http://plex.invalid',
			plexToken: 'secret'
		}
	}),
	kometaBindingErrorCode: (status: string) => `kometa_server_binding_${status}`
}));
vi.mock('./migration-evidence', () => ({
	loadKometaMigrationEvidence: async () => structuredClone(h.evidence)
}));
vi.mock('./migration-store', () => ({
	KometaMigrationStoreError: class KometaMigrationStoreError extends Error {
		code: string;
		constructor(code: string) {
			super(code);
			this.code = code;
		}
	},
	loadKometaMigrationJournal: async () => (h.journal ? structuredClone(h.journal) : null),
	prepareKometaMigrationJournal: async (
		journal: NonNullable<typeof h.journal>,
		expected: typeof h.journal
	) => {
		if (JSON.stringify(h.journal) !== JSON.stringify(expected)) {
			const error = new Error('journal_changed') as Error & { code: string };
			error.code = 'journal_changed';
			throw error;
		}
		h.journal = structuredClone(journal);
	},
	saveKometaMigrationJournal: async (journal: typeof h.journal, expected: typeof h.journal) => {
		if (JSON.stringify(h.journal) !== JSON.stringify(expected)) {
			const error = new Error('journal_changed') as Error & { code: string };
			error.code = 'journal_changed';
			throw error;
		}
		h.journal = journal ? structuredClone(journal) : null;
	},
	completeKometaMigrationJournal: async (
		journal: NonNullable<typeof h.journal>,
		snapshot: import('./config').KometaSnapshot,
		expected: typeof h.journal
	) => {
		if (JSON.stringify(h.journal) !== JSON.stringify(expected)) throw new Error('journal_changed');
		h.journal = structuredClone(journal);
		h.completedSnapshot = structuredClone(snapshot);
	},
	rollbackKometaMigrationJournal: async (
		journal: NonNullable<typeof h.journal>,
		snapshot: import('./config').KometaSnapshot | null,
		expected: typeof h.journal
	) => {
		if (JSON.stringify(h.journal) !== JSON.stringify(expected)) throw new Error('journal_changed');
		if (h.failRollbackPersistence) {
			h.failRollbackPersistence = false;
			throw new Error('rollback persistence failed');
		}
		h.journal = structuredClone(journal);
		h.rolledBackSnapshot = snapshot ? structuredClone(snapshot) : null;
	}
}));

import { db } from '$lib/server/db';
import { operationPlans } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { operationPlanStore } from '$lib/server/plans/operation-plan-store';
import { createKometaMigrationJournal } from './migration-journal';
import type { KometaMigrationPlanPayload } from './migration-plan';
import {
	acknowledgeKometaMigration,
	cancelKometaMigrationPreview,
	cancelKometaMigrationRollbackPreview,
	confirmKometaMigration,
	confirmKometaMigrationRollback,
	loadCurrentKometaMigrationState,
	previewKometaMigration,
	previewKometaMigrationRollback
} from './migration';

let directory: string;
let configPath: string;
let legacyPath: string;
let externalVictimPath: string;

const LEGACY_MOVIE = `metadata:\n  101:\n    url_poster: https://images.invalid/movie.jpg\n`;

function legacySnapshot(): import('./config').KometaSnapshot {
	return {
		metadataPath: `config/${LEGACY_FILENAME}`,
		libraries: { Movies: { metadata: true, defaults: [] } },
		managedSettingKeys: []
	};
}

function writeManagedFixture() {
	writeFileSync(legacyPath, LEGACY_MOVIE, 'utf8');
	writeFileSync(
		configPath,
		`libraries:\n  Movies:\n    metadata_files:\n      - file: config/${LEGACY_FILENAME} # managed legacy\n`,
		'utf8'
	);
	h.cached = [{ key: 'movies', title: 'Movies', type: 'movie' }];
	h.managedKeys = ['movies'];
	h.snapshot = legacySnapshot();
	h.evidence.mappings = [
		{ mediaItemId: 1, type: 'movie', tmdbId: '101', tvdbId: null, imdbId: null }
	];
}

beforeAll(() => {
	directory = mkdtempSync(join(tmpdir(), 'posterpilot-kometa-migration-service-'));
	configPath = join(directory, 'config.yml');
	legacyPath = join(directory, LEGACY_FILENAME);
	externalVictimPath = join(directory, 'external-victim.yml');
});

beforeEach(async () => {
	vi.clearAllMocks();
	await db.delete(operationPlans);
	for (const file of [
		configPath,
		legacyPath,
		externalVictimPath,
		join(directory, MOVIE_FILENAME),
		join(directory, SHOW_FILENAME)
	]) {
		rmSync(file, { force: true });
	}
	h.config = {
		kometaConfigPath: configPath,
		kometaAssetsDir: directory,
		kometaMetadataPathPrefix: 'config',
		kometaConfigMode: 'merge',
		kometaServerInstanceId: 'server-a'
	};
	h.cached = [];
	h.managedKeys = [];
	h.snapshot = null;
	h.evidence = { mappings: [], revisionMappings: [], revisions: [] };
	h.journal = null;
	h.completedSnapshot = null;
	h.rolledBackSnapshot = null;
	h.failRollbackPersistence = false;
	h.bindingId = 'server-a';
});

afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe('Kometa migration service', () => {
	it('gates recorded recovery when the bound Plex server changes', async () => {
		writeManagedFixture();
		const preview = await previewKometaMigration();
		const completed = await confirmKometaMigration({
			planId: preview.planId,
			digest: preview.digest
		});
		expect(completed).toMatchObject({ scopeMatches: true, canRollback: true });

		h.bindingId = 'server-b';
		const mismatched = await loadCurrentKometaMigrationState();
		expect(mismatched).toMatchObject({
			scopeMatches: false,
			frozenScope: {
				serverInstanceId: 'server-a',
				serverName: 'Server A',
				outputDirectory: expect.stringContaining('posterpilot-kometa-migration-service-')
			},
			canResume: false,
			canRestartPreview: false,
			canRollback: false
		});
	});

	async function effectlessJournalFromPreview(
		preview: Awaited<ReturnType<typeof previewKometaMigration>>
	) {
		const plan = await operationPlanStore.load<KometaMigrationPlanPayload>(preview.planId);
		if (!plan) throw new Error('missing preview plan');
		const journal = createKometaMigrationJournal({
			planId: plan.id,
			planDigest: plan.digest,
			payload: plan.payload,
			now: new Date('2026-08-07T12:00:00.000Z')
		});
		journal.status = 'recovery_required';
		journal.lastFailure = {
			phase: 'prepare',
			code: 'migration_source_changed',
			at: '2026-08-07T12:00:01.000Z'
		};
		return journal;
	}

	it('previews without URLs and confirms exact split files before rewiring config', async () => {
		writeManagedFixture();
		const preview = await previewKometaMigration();

		expect(preview.activation).toBe('managed');
		expect(preview.display.classified).toHaveLength(1);
		expect(JSON.stringify(preview)).not.toContain('https://images.invalid');
		expect(readFileSync(legacyPath, 'utf8')).toBe(LEGACY_MOVIE);

		const state = await confirmKometaMigration({
			planId: preview.planId,
			digest: preview.digest
		});
		expect(state.status).toBe('completed');
		expect(readFileSync(join(directory, MOVIE_FILENAME), 'utf8')).toContain(
			'https://images.invalid/movie.jpg'
		);
		expect(readFileSync(join(directory, SHOW_FILENAME), 'utf8')).toBe('metadata: {}\n');
		expect(readFileSync(configPath, 'utf8')).toContain(`config/${MOVIE_FILENAME}`);
		expect(readFileSync(configPath, 'utf8')).not.toContain(`config/${LEGACY_FILENAME}`);
		expect(readFileSync(legacyPath, 'utf8')).toBe(LEGACY_MOVIE);
		expect(h.completedSnapshot?.libraries.Movies.metadataReference).toBe(
			`config/${MOVIE_FILENAME}`
		);
	});

	it('invalidates a canceled migration preview and rejects confirmation replay', async () => {
		writeManagedFixture();
		const preview = await previewKometaMigration();

		await expect(
			cancelKometaMigrationPreview({ planId: preview.planId, digest: preview.digest })
		).resolves.toEqual({ cancelled: true });
		await expect(
			confirmKometaMigration({ planId: preview.planId, digest: preview.digest })
		).rejects.toMatchObject({ code: 'plan_consumed' });
		await expect(
			cancelKometaMigrationPreview({ planId: preview.planId, digest: preview.digest })
		).rejects.toMatchObject({ code: 'plan_consumed' });
		expect(h.journal).toBeNull();
		expect(() => readFileSync(join(directory, MOVIE_FILENAME), 'utf8')).toThrow();
	});

	it('lets the user dismiss an expired preview without writing files', async () => {
		writeManagedFixture();
		const preview = await previewKometaMigration();
		await db
			.update(operationPlans)
			.set({ expiresAt: new Date(0) })
			.where(eq(operationPlans.id, preview.planId));

		await expect(
			cancelKometaMigrationPreview({ planId: preview.planId, digest: preview.digest })
		).resolves.toEqual({ cancelled: true });
		await expect(
			confirmKometaMigration({ planId: preview.planId, digest: preview.digest })
		).rejects.toMatchObject({ code: 'plan_expired' });
		expect(h.journal).toBeNull();
		expect(() => readFileSync(join(directory, MOVIE_FILENAME), 'utf8')).toThrow();
	});

	it('serializes cancel against confirmation and never reports both as successful', async () => {
		writeManagedFixture();
		const preview = await previewKometaMigration();
		const [confirmation, cancellation] = await Promise.allSettled([
			confirmKometaMigration({ planId: preview.planId, digest: preview.digest }),
			cancelKometaMigrationPreview({ planId: preview.planId, digest: preview.digest })
		]);

		expect([confirmation.status, cancellation.status].sort()).toEqual(['fulfilled', 'rejected']);
		const rejectionReason =
			confirmation.status === 'rejected'
				? confirmation.reason
				: cancellation.status === 'rejected'
					? cancellation.reason
					: null;
		expect(rejectionReason).toMatchObject({ code: 'plan_consumed' });
		if (cancellation.status === 'fulfilled') {
			expect(h.journal).toBeNull();
			expect(() => readFileSync(join(directory, MOVIE_FILENAME), 'utf8')).toThrow();
		} else {
			expect(h.journal?.status).toBe('completed');
		}
	});

	it('replaces an effectless recovery journal after an external legacy edit', async () => {
		writeManagedFixture();
		const stale = await previewKometaMigration();
		h.journal = await effectlessJournalFromPreview(stale);
		writeFileSync(legacyPath, `${LEGACY_MOVIE}# externally normalized\n`, 'utf8');

		const fresh = await previewKometaMigration();
		await expect(
			confirmKometaMigration({ planId: fresh.planId, digest: fresh.digest })
		).resolves.toMatchObject({ status: 'completed' });
		expect(h.journal?.migrationId).toBe(fresh.migrationId);
	});

	it('never replaces a recovery journal with a checkpoint or registered backup', async () => {
		writeManagedFixture();
		const stale = await previewKometaMigration();
		const effectless = await effectlessJournalFromPreview(stale);

		h.journal = structuredClone(effectless);
		h.journal.checkpoints.movieVerified = true;
		await expect(previewKometaMigration()).rejects.toMatchObject({
			code: 'kometa_migration_in_progress'
		});

		h.journal = structuredClone(effectless);
		h.journal.backups.movie = {
			name: 'movie.migration.backup',
			fingerprint: '9'.repeat(64)
		};
		await expect(previewKometaMigration()).rejects.toMatchObject({
			code: 'kometa_migration_in_progress'
		});
	});

	it('requires an explicit ambiguity acceptance and never guesses a numeric collision', async () => {
		writeManagedFixture();
		h.evidence.mappings.push({
			mediaItemId: 2,
			type: 'show',
			tmdbId: '101',
			tvdbId: '202',
			imdbId: null
		});
		const preview = await previewKometaMigration();
		expect(preview.display.ambiguous).toHaveLength(1);
		expect(preview.display.classified).toHaveLength(0);

		await expect(
			confirmKometaMigration({ planId: preview.planId, digest: preview.digest })
		).rejects.toMatchObject({ code: 'kometa_migration_ambiguous_confirmation_required' });
		expect(readFileSync(configPath, 'utf8')).toContain(LEGACY_FILENAME);

		await confirmKometaMigration({
			planId: preview.planId,
			digest: preview.digest,
			acceptAmbiguous: true
		});
		expect(readFileSync(join(directory, MOVIE_FILENAME), 'utf8')).toBe('metadata: {}\n');
		expect(readFileSync(join(directory, SHOW_FILENAME), 'utf8')).toBe('metadata: {}\n');
	});

	it('keeps an identical-content entry classified when only the other source index conflicts', async () => {
		const identicalEntries = `metadata:\n  101:\n    url_poster: https://images.invalid/shared.jpg\n  202:\n    url_poster: https://images.invalid/shared.jpg\n`;
		writeFileSync(legacyPath, identicalEntries, 'utf8');
		writeFileSync(
			configPath,
			`libraries:\n  Movies:\n    metadata_files:\n      - file: config/${LEGACY_FILENAME}\n`,
			'utf8'
		);
		writeFileSync(
			join(directory, MOVIE_FILENAME),
			'metadata:\n  101:\n    url_poster: https://images.invalid/existing-conflict.jpg\n',
			'utf8'
		);
		h.cached = [{ key: 'movies', title: 'Movies', type: 'movie' }];
		h.managedKeys = ['movies'];
		h.snapshot = legacySnapshot();
		h.evidence.mappings = [
			{ mediaItemId: 1, type: 'movie', tmdbId: '101', tvdbId: null, imdbId: null },
			{ mediaItemId: 2, type: 'show', tmdbId: '202', tvdbId: '303', imdbId: null }
		];

		const preview = await previewKometaMigration();
		expect(preview.display.ambiguous).toHaveLength(1);
		expect(preview.display.ambiguous[0].legacyKey).toBe('101');
		expect(preview.display.classified.map((entry) => entry.legacyKey)).toEqual(['202']);

		await confirmKometaMigration({
			planId: preview.planId,
			digest: preview.digest,
			acceptAmbiguous: true
		});
		expect(readFileSync(join(directory, SHOW_FILENAME), 'utf8')).toContain('303:');
		expect(readFileSync(join(directory, SHOW_FILENAME), 'utf8')).toContain(
			'https://images.invalid/shared.jpg'
		);
		expect(readFileSync(join(directory, MOVIE_FILENAME), 'utf8')).toContain(
			'https://images.invalid/existing-conflict.jpg'
		);
	});

	it('lists every convergent legacy source as a separate typed-target conflict', async () => {
		const convergentEntries = `metadata:
  101: { url_poster: https://images.invalid/first.jpg }
  202: { url_poster: https://images.invalid/second.jpg }
`;
		writeFileSync(legacyPath, convergentEntries, 'utf8');
		writeFileSync(
			configPath,
			`libraries:\n  Shows:\n    metadata_files:\n      - file: config/${LEGACY_FILENAME}\n`,
			'utf8'
		);
		h.cached = [{ key: 'shows', title: 'Shows', type: 'show' }];
		h.managedKeys = ['shows'];
		h.snapshot = {
			metadataPath: `config/${LEGACY_FILENAME}`,
			libraries: { Shows: { metadata: true, defaults: [] } },
			managedSettingKeys: []
		};
		h.evidence.mappings = [
			{ mediaItemId: 1, type: 'show', tmdbId: '101', tvdbId: '303', imdbId: null },
			{ mediaItemId: 2, type: 'show', tmdbId: '202', tvdbId: '303', imdbId: null }
		];
		const parsed = parseLegacyMetadata(convergentEntries);

		const preview = await previewKometaMigration();

		expect(preview.display.classified).toEqual([]);
		expect(preview.display.ambiguous).toEqual([
			{
				legacyKey: '101',
				entryFingerprint: parsed.entries[0].entryFingerprint,
				slots: parsed.entries[0].leaves.map((leaf) => leaf.slotKey),
				reason: 'typed_target_conflict'
			},
			{
				legacyKey: '202',
				entryFingerprint: parsed.entries[1].entryFingerprint,
				slots: parsed.entries[1].leaves.map((leaf) => leaf.slotKey),
				reason: 'typed_target_conflict'
			}
		]);
	});

	it('rejects a stale preview before any write', async () => {
		writeManagedFixture();
		const preview = await previewKometaMigration();
		writeFileSync(legacyPath, `${LEGACY_MOVIE}# external edit\n`, 'utf8');

		await expect(
			confirmKometaMigration({ planId: preview.planId, digest: preview.digest })
		).rejects.toMatchObject({ code: 'plan_stale' });
		expect(() => readFileSync(join(directory, MOVIE_FILENAME), 'utf8')).toThrow();
		expect(readFileSync(configPath, 'utf8')).toContain(LEGACY_FILENAME);
	});

	it('rejects a hard-linked split target before creating a preview', async () => {
		writeManagedFixture();
		linkSync(legacyPath, join(directory, MOVIE_FILENAME));

		await expect(previewKometaMigration()).rejects.toMatchObject({
			code: 'kometa_migration_path_conflict'
		});
		expect(readFileSync(legacyPath, 'utf8')).toBe(LEGACY_MOVIE);
		expect(h.journal).toBeNull();
	});

	it('rechecks symlink aliases at confirmation before persisting a journal', async () => {
		writeManagedFixture();
		const preview = await previewKometaMigration();
		symlinkSync(legacyPath, join(directory, MOVIE_FILENAME));

		await expect(
			confirmKometaMigration({ planId: preview.planId, digest: preview.digest })
		).rejects.toMatchObject({ code: 'kometa_migration_path_conflict' });
		expect(readFileSync(legacyPath, 'utf8')).toBe(LEGACY_MOVIE);
		expect(readFileSync(configPath, 'utf8')).toContain(LEGACY_FILENAME);
		expect(h.journal).toBeNull();
	});

	it('rejects a same-content external symlink without modifying its victim', async () => {
		writeManagedFixture();
		const moviePath = join(directory, MOVIE_FILENAME);
		const source = 'metadata: {}\n';
		writeFileSync(moviePath, source, 'utf8');
		writeFileSync(externalVictimPath, source, 'utf8');
		const preview = await previewKometaMigration();
		rmSync(moviePath);
		symlinkSync(externalVictimPath, moviePath);

		await expect(
			confirmKometaMigration({ planId: preview.planId, digest: preview.digest })
		).rejects.toMatchObject({ code: 'kometa_migration_path_conflict' });
		expect(readFileSync(externalVictimPath, 'utf8')).toBe(source);
		expect(h.journal).toBeNull();
		expect(readFileSync(configPath, 'utf8')).toContain(LEGACY_FILENAME);
	});

	it('preserves the completed rollback journal against replay until legacy wiring returns', async () => {
		writeManagedFixture();
		const first = await previewKometaMigration();
		const staleTab = await previewKometaMigration();
		await confirmKometaMigration({ planId: first.planId, digest: first.digest });
		const completedId = h.journal?.migrationId;

		await expect(previewKometaMigration()).rejects.toMatchObject({
			code: 'kometa_migration_not_required'
		});
		await expect(
			confirmKometaMigration({ planId: staleTab.planId, digest: staleTab.digest })
		).rejects.toMatchObject({ code: 'kometa_migration_not_required' });
		expect(h.journal?.migrationId).toBe(completedId);

		writeFileSync(
			configPath,
			`libraries:\n  Movies:\n    metadata_files:\n      - file: config/${LEGACY_FILENAME}\n`,
			'utf8'
		);
		await expect(previewKometaMigration()).resolves.toMatchObject({ required: true });
	});

	it('writes split files but waits for an exact manual-wiring acknowledgment', async () => {
		h.config.kometaConfigPath = '';
		writeFileSync(legacyPath, LEGACY_MOVIE, 'utf8');
		h.cached = [{ key: 'movies', title: 'Movies', type: 'movie' }];
		h.managedKeys = ['movies'];
		h.evidence.mappings = [
			{ mediaItemId: 1, type: 'movie', tmdbId: '101', tvdbId: null, imdbId: null }
		];
		const preview = await previewKometaMigration();
		expect(preview.activation).toBe('manual');
		expect(preview.manualSnippet).toContain(`config/${MOVIE_FILENAME}`);

		const awaiting = await confirmKometaMigration({
			planId: preview.planId,
			digest: preview.digest
		});
		expect(awaiting.status).toBe('awaiting_manual_wiring');
		expect(awaiting.requiresAcknowledgment).toBe(true);

		await expect(
			acknowledgeKometaMigration({
				migrationId: preview.migrationId,
				manualSnippetFingerprint: '0'.repeat(64)
			})
		).rejects.toMatchObject({ code: 'kometa_migration_manual_ack_mismatch' });
		const completed = await acknowledgeKometaMigration({
			migrationId: preview.migrationId,
			manualSnippetFingerprint: preview.manualSnippetFingerprint!
		});
		expect(completed.status).toBe('completed');
		expect(completed.activation).toBe('manual');
	});

	it('previews and confirms rollback without deleting either metadata layout', async () => {
		writeManagedFixture();
		const preview = await previewKometaMigration();
		await confirmKometaMigration({ planId: preview.planId, digest: preview.digest });

		const rollback = await previewKometaMigrationRollback();
		expect(rollback.changes.length).toBeGreaterThan(0);
		const state = await confirmKometaMigrationRollback({
			planId: rollback.planId,
			digest: rollback.digest
		});
		expect(state.status).toBe('rolled_back');
		expect(readFileSync(configPath, 'utf8')).toContain(`config/${LEGACY_FILENAME}`);
		expect(readFileSync(join(directory, MOVIE_FILENAME), 'utf8')).toContain(
			'https://images.invalid/movie.jpg'
		);
		expect(readFileSync(legacyPath, 'utf8')).toBe(LEGACY_MOVIE);
		expect(h.rolledBackSnapshot).toEqual(legacySnapshot());
	});

	it('invalidates a canceled rollback preview and rejects rollback replay', async () => {
		writeManagedFixture();
		const preview = await previewKometaMigration();
		await confirmKometaMigration({ planId: preview.planId, digest: preview.digest });
		const rollback = await previewKometaMigrationRollback();

		await expect(
			cancelKometaMigrationRollbackPreview({
				planId: rollback.planId,
				digest: rollback.digest
			})
		).resolves.toEqual({ cancelled: true });
		await expect(
			confirmKometaMigrationRollback({ planId: rollback.planId, digest: rollback.digest })
		).rejects.toMatchObject({ code: 'plan_consumed' });
		expect(h.journal?.status).toBe('completed');
		expect(readFileSync(configPath, 'utf8')).toContain(`config/${MOVIE_FILENAME}`);
	});

	it('reloads and finalizes a rollback interrupted after config restoration', async () => {
		writeManagedFixture();
		const preview = await previewKometaMigration();
		await confirmKometaMigration({ planId: preview.planId, digest: preview.digest });

		const rollback = await previewKometaMigrationRollback();
		h.failRollbackPersistence = true;
		await expect(
			confirmKometaMigrationRollback({ planId: rollback.planId, digest: rollback.digest })
		).rejects.toMatchObject({ code: 'migration_write_failed', phase: 'rollback' });
		expect(h.journal?.status).toBe('rollback_prepared');
		expect(readFileSync(configPath, 'utf8')).toContain(`config/${LEGACY_FILENAME}`);
		expect(h.rolledBackSnapshot).toBeNull();

		const afterRestart = await previewKometaMigrationRollback();
		expect(afterRestart.changes).toHaveLength(0);
		const state = await confirmKometaMigrationRollback({
			planId: afterRestart.planId,
			digest: afterRestart.digest
		});
		expect(state).toMatchObject({
			status: 'rolled_back',
			canResume: false,
			canRollback: false
		});
		expect(readFileSync(configPath, 'utf8')).toContain(`config/${LEGACY_FILENAME}`);
		expect(h.rolledBackSnapshot).toEqual(legacySnapshot());
	});
});
