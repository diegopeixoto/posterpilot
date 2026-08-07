import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	existsSync,
	linkSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as databaseSchema from '$lib/server/db/schema';
import { LEGACY_FILENAME, MOVIE_FILENAME, SHOW_FILENAME } from './destination';
import { parseLegacyMetadata } from './migration-classifier';
import {
	createKometaMigrationControlLock,
	withKometaMigrationControlLock
} from './migration-control-lock';

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
	afterEvidenceSnapshot: null as (() => void | Promise<void>) | null,
	beforeCompletionEvidence: null as (() => void | Promise<void>) | null,
	failEvidenceLoad: false,
	journal: null as import('./migration-journal').KometaMigrationJournalV1 | null,
	completedSnapshot: null as import('./config').KometaSnapshot | null,
	rolledBackSnapshot: null as import('./config').KometaSnapshot | null,
	failRollbackPersistence: false,
	databaseFile: '',
	logEvent: vi.fn(),
	checkpointGuard: vi.fn()
}));

vi.mock('$lib/server/db', async () => {
	const { createClient } = await import('@libsql/client');
	const { drizzle } = await import('drizzle-orm/libsql');
	const { randomUUID } = await import('node:crypto');
	const { join } = await import('node:path');
	const { tmpdir } = await import('node:os');
	const schema = await import('$lib/server/db/schema');
	h.databaseFile = join(tmpdir(), `posterpilot-kometa-migration-${randomUUID()}.db`);
	const client = createClient({ url: `file:${h.databaseFile}` });
	await client.executeMultiple(`
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
		);
		CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
	`);
	return { db: drizzle(client, { schema }), migrateDb: async () => undefined };
});

vi.mock('$lib/server/config', () => ({
	resolveConfig: async () => h.config,
	getCachedLibraries: async () => h.cached,
	getKometaManagedLibraries: async () => h.managedKeys,
	getKometaLastApplied: async () => (h.snapshot ? structuredClone(h.snapshot) : null)
}));

vi.mock('$lib/server/events', () => ({ logEvent: h.logEvent }));
vi.mock('./config-mutation-recovery', () => ({
	assertNoPendingKometaConfigMutationWhileOwned: h.checkpointGuard
}));
vi.mock('./server-binding', () => ({
	resolveKometaServerBinding: async (serverInstanceId: string | null) => ({
		status: 'ready',
		binding: {
			id: serverInstanceId ?? 'legacy-default',
			name: serverInstanceId === 'server-a' ? 'Server A' : 'Server B',
			plexUrl: 'http://plex.invalid',
			plexToken: 'secret'
		}
	}),
	kometaBindingErrorCode: (status: string) => `kometa_server_binding_${status}`
}));
vi.mock('./migration-evidence', () => ({
	loadKometaMigrationEvidence: async () => {
		if (h.failEvidenceLoad) throw new Error('evidence database unavailable');
		const snapshot = structuredClone(h.evidence);
		const afterSnapshot = h.afterEvidenceSnapshot;
		h.afterEvidenceSnapshot = null;
		await afterSnapshot?.();
		return snapshot;
	}
}));
vi.mock('./migration-store', () => ({
	KometaMigrationStoreError: class KometaMigrationStoreError extends Error {
		code: string;
		constructor(code: string) {
			super(code);
			this.code = code;
		}
	},
	loadKometaMigrationJournal: async (serverInstanceId: string) =>
		h.journal?.payload.serverInstanceId === serverInstanceId ? structuredClone(h.journal) : null,
	loadActiveKometaMigrationJournal: async () =>
		h.journal && h.journal.status !== 'completed' && h.journal.status !== 'rolled_back'
			? structuredClone(h.journal)
			: null,
	loadKometaMigrationJournalForGuard: async (serverInstanceId: string | null) => {
		if (h.journal && h.journal.status !== 'completed' && h.journal.status !== 'rolled_back') {
			return structuredClone(h.journal);
		}
		return h.journal?.payload.serverInstanceId === serverInstanceId
			? structuredClone(h.journal)
			: null;
	},
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
		expected: typeof h.journal,
		assertEvidenceCurrent?: (
			database: typeof import('$lib/server/db').db
		) => Promise<'current' | 'changed' | 'unavailable'>
	) => {
		const beforeCompletionEvidence = h.beforeCompletionEvidence;
		h.beforeCompletionEvidence = null;
		await beforeCompletionEvidence?.();
		const evidenceState = assertEvidenceCurrent ? await assertEvidenceCurrent(db) : 'current';
		if (evidenceState !== 'current') return evidenceState;
		if (JSON.stringify(h.journal) !== JSON.stringify(expected)) throw new Error('journal_changed');
		h.journal = structuredClone(journal);
		h.completedSnapshot = structuredClone(snapshot);
		h.snapshot = structuredClone(snapshot);
		return 'current';
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
		h.snapshot = snapshot ? structuredClone(snapshot) : null;
	}
}));

import { db } from '$lib/server/db';
import { operationPlans } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { operationPlanStore } from '$lib/server/plans/operation-plan-store';
import { createKometaMigrationJournal, updateKometaMigrationJournal } from './migration-journal';
import type { KometaMigrationPlanPayload } from './migration-plan';
import {
	abandonKometaMigration,
	acknowledgeKometaMigration,
	cancelKometaMigrationPreview,
	cancelKometaMigrationRollbackPreview,
	confirmKometaMigration,
	confirmKometaMigrationRollback,
	loadCurrentKometaMigrationState,
	previewKometaMigration,
	previewKometaMigrationRollback,
	resumeKometaMigration
} from './migration';

let directory: string;
let configPath: string;
let configQuarantinePath: string;
let legacyPath: string;
let externalVictimPath: string;

function independentControlLock(owner: string) {
	const client = createClient({ url: `file:${h.databaseFile}` });
	const database = drizzle(client, { schema: databaseSchema });
	return {
		client,
		lock: createKometaMigrationControlLock(database, {
			leaseMs: 2_000,
			pollIntervalMs: 5,
			owner: () => owner
		})
	};
}

const LEGACY_MOVIE = `metadata:\n  101:\n    url_poster: https://images.invalid/movie.jpg\n`;

function legacySnapshot(): import('./config').KometaSnapshot {
	return {
		metadataPath: `config/${LEGACY_FILENAME}`,
		libraries: { Movies: { metadata: true, defaults: [] } },
		managedSettingKeys: []
	};
}

function externallyChangedSnapshot(): import('./config').KometaSnapshot {
	return {
		metadataPath: 'config/external.yml',
		libraries: { External: { metadata: true, defaults: ['changed'] } },
		managedSettingKeys: ['settings.schedule']
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
	configQuarantinePath = join(directory, '.config.yml.posterpilot-cas-quarantine');
	legacyPath = join(directory, LEGACY_FILENAME);
	externalVictimPath = join(directory, 'external-victim.yml');
});

beforeEach(async () => {
	vi.clearAllMocks();
	await db.delete(operationPlans);
	for (const file of [
		configPath,
		configQuarantinePath,
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
	h.afterEvidenceSnapshot = null;
	h.beforeCompletionEvidence = null;
	h.failEvidenceLoad = false;
	h.journal = null;
	h.completedSnapshot = null;
	h.rolledBackSnapshot = null;
	h.failRollbackPersistence = false;
	h.checkpointGuard.mockImplementation(async (assertControlLockOwned: () => Promise<unknown>) =>
		assertControlLockOwned()
	);
});

afterAll(() => {
	rmSync(directory, { recursive: true, force: true });
	for (const suffix of ['', '-wal', '-shm']) rmSync(`${h.databaseFile}${suffix}`, { force: true });
});

describe('Kometa migration service', () => {
	it('blocks migration confirmation while a config commit checkpoint needs recovery', async () => {
		writeManagedFixture();
		const preview = await previewKometaMigration();
		h.checkpointGuard.mockRejectedValueOnce(new Error('checkpoint corrupt'));

		await expect(
			confirmKometaMigration({ planId: preview.planId, digest: preview.digest })
		).rejects.toMatchObject({ code: 'kometa_config_recovery_required' });
		expect(h.journal).toBeNull();
		expect(readFileSync(configPath, 'utf8')).toContain(LEGACY_FILENAME);
		expect(readFileSync(legacyPath, 'utf8')).toBe(LEGACY_MOVIE);
	});

	it('does not leak a terminal journal across server-scoped journal reads', async () => {
		writeManagedFixture();
		const preview = await previewKometaMigration();
		const completed = await confirmKometaMigration({
			planId: preview.planId,
			digest: preview.digest
		});
		expect(completed).toMatchObject({ scopeMatches: true, canRollback: true });

		h.config.kometaServerInstanceId = 'server-b';
		await expect(loadCurrentKometaMigrationState()).resolves.toBeNull();
	});

	it('keeps an active server-a journal visible after the configured binding drifts to server-b', async () => {
		writeManagedFixture();
		const preview = await previewKometaMigration();
		const plan = await operationPlanStore.load<KometaMigrationPlanPayload>(preview.planId);
		if (!plan) throw new Error('missing preview plan');
		h.journal = createKometaMigrationJournal({
			planId: plan.id,
			planDigest: plan.digest,
			payload: plan.payload,
			now: new Date('2026-08-07T12:00:00.000Z')
		});
		h.config.kometaServerInstanceId = 'server-b';

		await expect(loadCurrentKometaMigrationState()).resolves.toMatchObject({
			migrationId: h.journal.migrationId,
			status: 'prepared',
			scopeMatches: false,
			frozenScope: { serverInstanceId: 'server-a' },
			canResume: false,
			canRollback: false
		});
	});

	it('does not create a server-b preview while a server-a journal is active', async () => {
		writeManagedFixture();
		const preview = await previewKometaMigration();
		const plan = await operationPlanStore.load<KometaMigrationPlanPayload>(preview.planId);
		if (!plan) throw new Error('missing preview plan');
		h.journal = createKometaMigrationJournal({
			planId: plan.id,
			planDigest: plan.digest,
			payload: plan.payload,
			now: new Date('2026-08-07T12:00:00.000Z')
		});
		h.config.kometaServerInstanceId = 'server-b';

		await expect(previewKometaMigration()).rejects.toMatchObject({
			code: 'kometa_migration_in_progress'
		});
		expect(h.journal.payload.serverInstanceId).toBe('server-a');
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

	it('abandons a physically unchanged failure but keeps guards until a replacement completes', async () => {
		writeManagedFixture();
		const stale = await previewKometaMigration();
		h.journal = await effectlessJournalFromPreview(stale);

		await expect(loadCurrentKometaMigrationState()).resolves.toMatchObject({
			status: 'recovery_required',
			canAbandon: true,
			recoveryGuidance: 'source_safe_to_abandon'
		});
		const abandoned = await abandonKometaMigration({ migrationId: stale.migrationId });
		expect(abandoned).toMatchObject({
			status: 'abandoned',
			canResume: false,
			canRestartPreview: true
		});
		expect(h.journal?.status).toBe('abandoned');

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

	it('rejects a changed last-applied baseline before consuming the plan or writing files', async () => {
		writeManagedFixture();
		const preview = await previewKometaMigration();
		const configBefore = readFileSync(configPath, 'utf8');
		h.snapshot = externallyChangedSnapshot();

		await expect(
			confirmKometaMigration({ planId: preview.planId, digest: preview.digest })
		).rejects.toMatchObject({ code: 'plan_stale' });

		expect(h.journal).toBeNull();
		expect(readFileSync(configPath, 'utf8')).toBe(configBefore);
		expect(existsSync(join(directory, MOVIE_FILENAME))).toBe(false);
		expect(existsSync(join(directory, SHOW_FILENAME))).toBe(false);
		const [storedPlan] = await db
			.select({ consumedAt: operationPlans.consumedAt })
			.from(operationPlans)
			.where(eq(operationPlans.id, preview.planId));
		expect(storedPlan?.consumedAt).toBeNull();
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

	it('allows a replacement preview when a completed managed config becomes unobservable', async () => {
		writeManagedFixture();
		const first = await previewKometaMigration();
		await confirmKometaMigration({ planId: first.planId, digest: first.digest });
		rmSync(configPath, { force: true });

		await expect(previewKometaMigration()).resolves.toMatchObject({ required: true });
	});

	it('does not create a preview when an active legacy library has no authoritative target', async () => {
		writeFileSync(legacyPath, LEGACY_MOVIE, 'utf8');
		writeFileSync(
			configPath,
			`libraries:\n  Movies 4K:\n    metadata_files:\n      - file: config/${LEGACY_FILENAME}\n`,
			'utf8'
		);
		h.cached = [{ key: 'movies', title: 'Movies', type: 'movie' }];
		h.managedKeys = ['movies'];
		h.evidence.mappings = [
			{ mediaItemId: 1, type: 'movie', tmdbId: '101', tvdbId: null, imdbId: null }
		];

		await expect(previewKometaMigration()).rejects.toMatchObject({
			code: 'kometa_migration_config_incompatible'
		});
		expect(await db.select().from(operationPlans)).toHaveLength(0);
		expect(h.journal).toBeNull();
	});

	it('rechecks config actionability before confirming a frozen preview', async () => {
		writeManagedFixture();
		const preview = await previewKometaMigration();
		h.cached = [
			{ key: 'movies', title: 'Movies', type: 'movie' },
			{ key: 'shows', title: 'Movies', type: 'show' }
		];

		await expect(
			confirmKometaMigration({ planId: preview.planId, digest: preview.digest })
		).rejects.toMatchObject({ code: 'kometa_migration_config_incompatible' });
		expect(h.journal).toBeNull();
		expect(readFileSync(configPath, 'utf8')).toContain(LEGACY_FILENAME);
	});

	it.each([
		['media type', (mapping: (typeof h.evidence.mappings)[number]) => (mapping.type = 'show')],
		['TMDB id', (mapping: (typeof h.evidence.mappings)[number]) => (mapping.tmdbId = '202')],
		['media item id', (mapping: (typeof h.evidence.mappings)[number]) => (mapping.mediaItemId = 2)]
	])(
		'rechecks a concurrent %s change at the managed activation boundary',
		async (_label, mutate) => {
			writeManagedFixture();
			const preview = await previewKometaMigration();
			h.afterEvidenceSnapshot = () => {
				mutate(h.evidence.mappings[0]);
			};

			await expect(
				confirmKometaMigration({ planId: preview.planId, digest: preview.digest })
			).rejects.toMatchObject({
				code: 'migration_evidence_changed',
				phase: 'source_revalidate',
				recoveryRequired: true
			});
			expect(h.journal?.status).toBe('recovery_required');
			expect(h.completedSnapshot).toBeNull();
			expect(readFileSync(configPath, 'utf8')).toContain(LEGACY_FILENAME);
		}
	);

	it('rechecks the last-applied baseline inside the final persistence transaction', async () => {
		writeManagedFixture();
		const preview = await previewKometaMigration();
		h.beforeCompletionEvidence = () => {
			h.snapshot = externallyChangedSnapshot();
		};

		await expect(
			confirmKometaMigration({ planId: preview.planId, digest: preview.digest })
		).rejects.toMatchObject({
			code: 'migration_evidence_changed',
			phase: 'final_verify',
			recoveryRequired: true
		});

		expect(h.journal?.status).toBe('recovery_required');
		expect(h.completedSnapshot).toBeNull();
		expect(readFileSync(configPath, 'utf8')).toContain(`config/${MOVIE_FILENAME}`);
	});

	it('keeps a commit-boundary evidence read outage resumable', async () => {
		writeManagedFixture();
		const preview = await previewKometaMigration();
		h.afterEvidenceSnapshot = () => {
			h.failEvidenceLoad = true;
		};

		await expect(
			confirmKometaMigration({ planId: preview.planId, digest: preview.digest })
		).rejects.toMatchObject({
			code: 'migration_evidence_unavailable',
			phase: 'source_revalidate',
			recoveryRequired: false
		});
		expect(h.journal?.status).toBe('failed');
		expect(readFileSync(configPath, 'utf8')).toContain(LEGACY_FILENAME);

		h.failEvidenceLoad = false;
		await expect(
			resumeKometaMigration({ migrationId: preview.migrationId })
		).resolves.toMatchObject({
			status: 'completed'
		});
	});

	it('rechecks concurrent evidence again inside a resumed executor', async () => {
		writeManagedFixture();
		const preview = await previewKometaMigration();
		const plan = await operationPlanStore.load<KometaMigrationPlanPayload>(preview.planId);
		if (!plan) throw new Error('missing preview plan');
		const failed = createKometaMigrationJournal({
			planId: plan.id,
			planDigest: plan.digest,
			payload: plan.payload,
			now: new Date('2026-08-07T12:00:00.000Z')
		});
		failed.status = 'failed';
		failed.lastFailure = {
			phase: 'prepare',
			code: 'migration_write_failed',
			at: '2026-08-07T12:00:01.000Z'
		};
		h.journal = failed;
		h.afterEvidenceSnapshot = () => {
			h.evidence.mappings[0].tmdbId = '202';
		};

		await expect(resumeKometaMigration({ migrationId: failed.migrationId })).rejects.toMatchObject({
			code: 'migration_evidence_changed',
			phase: 'source_revalidate',
			recoveryRequired: true
		});
		expect(h.journal?.status).toBe('recovery_required');
		expect(h.completedSnapshot).toBeNull();
		expect(readFileSync(configPath, 'utf8')).toContain(LEGACY_FILENAME);
	});

	it('persists recovery-required when a resume starts with already-stale evidence', async () => {
		writeManagedFixture();
		const preview = await previewKometaMigration();
		const plan = await operationPlanStore.load<KometaMigrationPlanPayload>(preview.planId);
		if (!plan) throw new Error('missing preview plan');
		const failed = createKometaMigrationJournal({
			planId: plan.id,
			planDigest: plan.digest,
			payload: plan.payload,
			now: new Date('2026-08-07T12:00:00.000Z')
		});
		failed.status = 'failed';
		failed.lastFailure = {
			phase: 'prepare',
			code: 'migration_write_failed',
			at: '2026-08-07T12:00:01.000Z'
		};
		h.journal = failed;
		h.evidence.mappings[0].tmdbId = '202';

		await expect(resumeKometaMigration({ migrationId: failed.migrationId })).rejects.toMatchObject({
			code: 'migration_evidence_changed',
			recoveryRequired: true
		});
		expect(h.journal?.status).toBe('recovery_required');
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

	it('keeps frozen library evidence after manual wiring removes the last legacy reference', async () => {
		writeFileSync(legacyPath, LEGACY_MOVIE, 'utf8');
		writeFileSync(
			configPath,
			`libraries:\n  Movies:\n    metadata_files:\n      - file: config/${LEGACY_FILENAME}\n`,
			'utf8'
		);
		h.cached = [{ key: 'movies', title: 'Movies', type: 'movie' }];
		h.managedKeys = [];
		h.snapshot = null;
		h.evidence.mappings = [
			{ mediaItemId: 1, type: 'movie', tmdbId: '101', tvdbId: null, imdbId: null }
		];
		const preview = await previewKometaMigration();
		expect(preview.activation).toBe('manual');
		await confirmKometaMigration({ planId: preview.planId, digest: preview.digest });

		writeFileSync(
			configPath,
			`libraries:\n  Movies:\n    metadata_files:\n      - file: config/${MOVIE_FILENAME}\n`,
			'utf8'
		);
		await expect(
			acknowledgeKometaMigration({
				migrationId: preview.migrationId,
				manualSnippetFingerprint: preview.manualSnippetFingerprint!
			})
		).resolves.toMatchObject({ status: 'completed', activation: 'manual' });
	});

	it('lets a raw config writer finish before manual acknowledgment revalidates', async () => {
		writeManagedFixture();
		h.snapshot = null;
		const preview = await previewKometaMigration();
		await confirmKometaMigration({ planId: preview.planId, digest: preview.digest });
		const { client, lock } = independentControlLock('raw-process-first');
		let releaseRaw!: () => void;
		let rawEntered!: () => void;
		const entered = new Promise<void>((resolve) => {
			rawEntered = resolve;
		});
		const release = new Promise<void>((resolve) => {
			releaseRaw = resolve;
		});
		try {
			const raw = lock(async () => {
				writeFileSync(
					configPath,
					`libraries:\n  Movies:\n    metadata_files:\n      - file: config/${MOVIE_FILENAME}\n`,
					'utf8'
				);
				rawEntered();
				await release;
			});
			await entered;

			const acknowledgment = acknowledgeKometaMigration({
				migrationId: preview.migrationId,
				manualSnippetFingerprint: preview.manualSnippetFingerprint!
			});
			await new Promise((resolve) => setTimeout(resolve, 30));
			expect(h.journal?.status).toBe('awaiting_manual_wiring');
			releaseRaw();
			await raw;
			await expect(acknowledgment).resolves.toMatchObject({ status: 'completed' });
		} finally {
			client.close();
		}
	});

	it('completes manual acknowledgment before a later raw writer can enter', async () => {
		writeManagedFixture();
		h.snapshot = null;
		const preview = await previewKometaMigration();
		await confirmKometaMigration({ planId: preview.planId, digest: preview.digest });
		writeFileSync(
			configPath,
			`libraries:\n  Movies:\n    metadata_files:\n      - file: config/${MOVIE_FILENAME}\n`,
			'utf8'
		);
		let releaseEvidence!: () => void;
		let evidenceEntered!: () => void;
		const entered = new Promise<void>((resolve) => {
			evidenceEntered = resolve;
		});
		const release = new Promise<void>((resolve) => {
			releaseEvidence = resolve;
		});
		h.afterEvidenceSnapshot = async () => {
			evidenceEntered();
			await release;
		};
		const acknowledgment = acknowledgeKometaMigration({
			migrationId: preview.migrationId,
			manualSnippetFingerprint: preview.manualSnippetFingerprint!
		});
		await entered;

		const { client, lock } = independentControlLock('raw-process-second');
		let rawEntered = false;
		try {
			const raw = lock(async () => {
				rawEntered = true;
				writeFileSync(configPath, 'settings:\n  cache: false\n', 'utf8');
			});
			await new Promise((resolve) => setTimeout(resolve, 30));
			expect(rawEntered).toBe(false);
			releaseEvidence();
			await expect(acknowledgment).resolves.toMatchObject({ status: 'completed' });
			await raw;
			expect(rawEntered).toBe(true);
		} finally {
			client.close();
		}
	});

	it('persists recovery-required when the authoritative manual target disappears', async () => {
		writeManagedFixture();
		h.snapshot = null;
		const preview = await previewKometaMigration();
		expect(preview.activation).toBe('manual');
		const awaiting = await confirmKometaMigration({
			planId: preview.planId,
			digest: preview.digest
		});
		expect(awaiting.status).toBe('awaiting_manual_wiring');

		h.cached = [];
		await expect(
			acknowledgeKometaMigration({
				migrationId: preview.migrationId,
				manualSnippetFingerprint: preview.manualSnippetFingerprint!
			})
		).rejects.toMatchObject({
			code: 'migration_evidence_changed',
			phase: 'manual_acknowledgment',
			recoveryRequired: true
		});
		expect(h.journal?.status).toBe('recovery_required');
	});

	it('rechecks a concurrent identity change at the manual acknowledgment boundary', async () => {
		writeManagedFixture();
		h.snapshot = null;
		const preview = await previewKometaMigration();
		await confirmKometaMigration({ planId: preview.planId, digest: preview.digest });
		h.afterEvidenceSnapshot = () => {
			h.evidence.mappings[0].mediaItemId = 2;
		};

		await expect(
			acknowledgeKometaMigration({
				migrationId: preview.migrationId,
				manualSnippetFingerprint: preview.manualSnippetFingerprint!
			})
		).rejects.toMatchObject({
			code: 'migration_evidence_changed',
			phase: 'manual_acknowledgment',
			recoveryRequired: true
		});
		expect(h.journal?.status).toBe('recovery_required');
		expect(h.completedSnapshot).toBeNull();
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

	it('rejects rollback when the frozen last-applied baseline changed', async () => {
		writeManagedFixture();
		const preview = await previewKometaMigration();
		await confirmKometaMigration({ planId: preview.planId, digest: preview.digest });
		const rollback = await previewKometaMigrationRollback();
		const configBefore = readFileSync(configPath, 'utf8');
		h.snapshot = externallyChangedSnapshot();

		await expect(
			confirmKometaMigrationRollback({ planId: rollback.planId, digest: rollback.digest })
		).rejects.toMatchObject({ code: 'plan_stale' });

		expect(h.journal?.status).toBe('completed');
		expect(h.rolledBackSnapshot).toBeNull();
		expect(readFileSync(configPath, 'utf8')).toBe(configBefore);
		const [storedPlan] = await db
			.select({ consumedAt: operationPlans.consumedAt })
			.from(operationPlans)
			.where(eq(operationPlans.id, rollback.planId));
		expect(storedPlan?.consumedAt).toBeNull();
	});

	it('revalidates scope after a concurrent settings writer wins the rollback control lock', async () => {
		writeManagedFixture();
		const preview = await previewKometaMigration();
		await confirmKometaMigration({ planId: preview.planId, digest: preview.digest });
		const rollbackPreview = await previewKometaMigrationRollback();
		const proposedConfig = readFileSync(configPath, 'utf8');
		let releaseSettings!: () => void;
		let settingsEntered!: () => void;
		const entered = new Promise<void>((resolve) => {
			settingsEntered = resolve;
		});
		const release = new Promise<void>((resolve) => {
			releaseSettings = resolve;
		});
		const settings = withKometaMigrationControlLock(async () => {
			settingsEntered();
			await release;
			h.config.kometaServerInstanceId = 'server-b';
		});
		await entered;

		const rollback = confirmKometaMigrationRollback({
			planId: rollbackPreview.planId,
			digest: rollbackPreview.digest
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(readFileSync(configPath, 'utf8')).toBe(proposedConfig);
		releaseSettings();
		await settings;
		await expect(rollback).rejects.toMatchObject({ code: 'kometa_migration_not_found' });
		expect(readFileSync(configPath, 'utf8')).toBe(proposedConfig);
		expect(h.journal?.status).toBe('completed');
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

	it('recovers a detached config quarantine before reissuing rollback preview', async () => {
		writeManagedFixture();
		const preview = await previewKometaMigration();
		await confirmKometaMigration({ planId: preview.planId, digest: preview.digest });
		const proposedConfig = readFileSync(configPath, 'utf8');

		const interrupted = await previewKometaMigrationRollback();
		await operationPlanStore.consume(interrupted.planId, {
			kind: 'kometa_split_migration_rollback',
			digest: interrupted.digest,
			serverInstanceId: 'server-a'
		});
		if (!h.journal) throw new Error('missing completed migration journal');
		h.journal = updateKometaMigrationJournal(
			h.journal,
			{ status: 'rollback_prepared', lastFailure: null },
			new Date()
		);
		renameSync(configPath, configQuarantinePath);
		expect(existsSync(configPath)).toBe(false);
		expect(readFileSync(configQuarantinePath, 'utf8')).toBe(proposedConfig);

		const afterRestart = await previewKometaMigrationRollback();
		expect(readFileSync(configPath, 'utf8')).toBe(proposedConfig);
		expect(existsSync(configQuarantinePath)).toBe(false);
		expect(afterRestart.changes.length).toBeGreaterThan(0);

		const state = await confirmKometaMigrationRollback({
			planId: afterRestart.planId,
			digest: afterRestart.digest
		});
		expect(state.status).toBe('rolled_back');
		expect(readFileSync(configPath, 'utf8')).toContain(`config/${LEGACY_FILENAME}`);
		expect(h.rolledBackSnapshot).toEqual(legacySnapshot());
	});
});
