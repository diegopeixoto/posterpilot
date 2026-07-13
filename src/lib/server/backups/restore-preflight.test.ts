import { describe, expect, it, vi } from 'vitest';
import { resolveDataPaths } from '$lib/server/data-paths';
import { fingerprintEncryptionKey, type BackupManifestV1 } from './manifest';
import type { BackupValidationIssueCode } from './validation';
import {
	compareRestoreMigrations,
	createRestorePreflightService,
	resolveRestoreKey,
	type RestorePreflightDependencies
} from './restore-preflight';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const MANIFEST_CHECKSUM = 'c'.repeat(64);
const NOW = new Date('2026-07-10T20:00:00.000Z');
const MIGRATIONS = [
	{ id: '0001_base', createdAt: 100, hash: HASH_A },
	{ id: '0002_scopes', createdAt: 200, hash: HASH_B }
];

function manifest(overrides: Partial<BackupManifestV1> = {}): BackupManifestV1 {
	return {
		format: 'posterpilot-backup',
		formatVersion: 1,
		backupId: 'backup-1',
		trigger: 'manual',
		createdAt: '2026-07-01T10:00:00.000Z',
		appVersion: '0.8.0',
		schemaVersion: '100',
		snapshot: { method: 'vacuum_into', checkpointFallback: false },
		key: { mode: 'none', fingerprint: null, included: false },
		files: [{ path: 'database.db', role: 'database', sizeBytes: 1024, sha256: HASH_A }],
		externalPaths: [
			{
				kind: 'kometa_assets',
				path: '/mnt/kometa/assets',
				expectedType: 'directory',
				reachable: true
			}
		],
		...overrides
	};
}

function fixture(
	options: {
		manifest?: BackupManifestV1;
		validationStatus?: 'valid' | 'warning' | 'invalid';
		validationIssues?: BackupValidationIssueCode[];
		keyStatus?: 'compatible' | 'not_required' | 'missing' | 'mismatch' | 'mode_incompatible';
		databaseStatus?: 'ok' | 'integrity_failed' | 'unreadable' | 'schema_metadata_missing';
		appliedMigrations?: Array<{ createdAt: number; hash: string }>;
		secretStatus?: 'not_present' | 'valid' | 'key_missing' | 'invalid';
		pathWritable?: boolean;
		spaceStatus?: 'sufficient' | 'insufficient' | 'unavailable';
	} = {}
) {
	const selectedManifest = options.manifest ?? manifest();
	const createPlan = vi.fn(
		async (input: Parameters<RestorePreflightDependencies['createPlan']>[0]) => ({
			id: 'plan-1',
			kind: input.kind,
			serverInstanceId: null,
			librarySectionKey: null,
			payload: input.payload,
			digest: 'd'.repeat(64),
			createdAt: NOW,
			expiresAt: new Date('2026-07-10T20:15:00.000Z'),
			consumedAt: null
		})
	);
	const createPreview = vi.fn(async () => undefined);
	const inspectDatabase = vi.fn(async () => ({
		status: options.databaseStatus ?? 'ok',
		appliedMigrations: options.appliedMigrations ?? [{ createdAt: 100, hash: HASH_A }],
		encryptedSecretCount: options.secretStatus && options.secretStatus !== 'not_present' ? 1 : 0,
		secretStatus: options.secretStatus ?? 'not_present'
	}));
	const inspectStorage = vi.fn(async () => ({
		paths: {
			database: options.pathWritable === false ? ('unwritable' as const) : ('writable' as const),
			application_key: 'not_applicable' as const,
			restore_staging: 'writable' as const,
			backup_storage: 'writable' as const
		},
		requiredBytes: 4096,
		spaceStatus: options.spaceStatus ?? ('sufficient' as const)
	}));
	const deps = {
		dataPaths: resolveDataPaths('file:./data/posterpilot.db', './data/.app-key'),
		validateBackup: vi.fn(async () => ({
			record: { id: 'backup-1', bundleName: 'bundle-backup-1', checksum: MANIFEST_CHECKSUM },
			validation: {
				status: options.validationStatus ?? 'valid',
				issues: options.validationIssues ?? [],
				manifest: options.validationStatus === 'invalid' ? null : selectedManifest,
				manifestChecksum:
					options.validationStatus === 'invalid' ? MANIFEST_CHECKSUM : MANIFEST_CHECKSUM,
				sizeBytes: 2048,
				validatedAt: NOW
			},
			bundleDirectory: '/safe/backups/bundle-backup-1'
		})),
		resolveKey: vi.fn(async () => ({
			status: options.keyStatus ?? ('not_required' as const),
			key: null
		})),
		inspectDatabase,
		inspectStorage,
		inspectExternal: vi.fn(async () => [
			{
				kind: 'kometa_assets' as const,
				expectedType: 'directory' as const,
				recordedReachable: true,
				currentStatus: 'missing' as const
			}
		]),
		loadMigrations: () => MIGRATIONS,
		createPlan: createPlan as RestorePreflightDependencies['createPlan'],
		recordStore: { createPreview },
		clock: () => NOW,
		generateId: () => 'restore-1'
	} satisfies RestorePreflightDependencies;
	return { service: createRestorePreflightService(deps), deps, createPlan, createPreview };
}

describe('restore preflight', () => {
	it('binds a valid older snapshot, required migrations, storage checks, and warnings to one plan', async () => {
		const { service, createPlan, createPreview, deps } = fixture();
		const result = await service.preview('backup-1');

		expect(result.report).toMatchObject({
			restorable: true,
			blocking: [],
			schema: {
				status: 'upgrade_required',
				requiredMigrations: [{ id: '0002_scopes', createdAt: 200 }]
			},
			warnings: [{ code: 'external_path_missing', externalPathKind: 'kometa_assets' }],
			storage: { requiredBytes: 4096, spaceStatus: 'sufficient' }
		});
		expect(deps.inspectDatabase).toHaveBeenCalledWith(
			'/safe/backups/bundle-backup-1/database.db',
			null
		);
		expect(createPlan).toHaveBeenCalledOnce();
		const planInput = createPlan.mock.calls[0]![0] as {
			kind: string;
			payload: Record<string, unknown>;
		};
		expect(planInput.kind).toBe('application_restore');
		expect(planInput.payload).toMatchObject({
			restoreId: 'restore-1',
			backupId: 'backup-1',
			bundleName: 'bundle-backup-1',
			manifestChecksum: MANIFEST_CHECKSUM,
			previewChecksum: result.confirmation?.previewChecksum,
			report: result.report
		});
		expect(result.confirmation).toMatchObject({
			restoreId: 'restore-1',
			planId: 'plan-1',
			digest: 'd'.repeat(64)
		});
		expect(createPreview).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'restore-1',
				backupId: 'backup-1',
				operationPlanId: 'plan-1',
				previewChecksum: result.confirmation?.previewChecksum
			})
		);
	});

	it('blocks checksum-invalid bundles before opening any payload', async () => {
		const { service, deps, createPlan } = fixture({
			validationStatus: 'invalid',
			validationIssues: ['payload_checksum_mismatch']
		});
		const result = await service.preview('backup-1');

		expect(result.report).toMatchObject({
			restorable: false,
			blocking: ['bundle_invalid'],
			bundle: { issues: ['payload_checksum_mismatch'] }
		});
		expect(result.confirmation).toBeNull();
		expect(deps.inspectDatabase).not.toHaveBeenCalled();
		expect(createPlan).not.toHaveBeenCalled();
	});

	it('keeps integrity, key, path, and disk failures as separate blocking categories', async () => {
		const { service, createPlan } = fixture({
			databaseStatus: 'integrity_failed',
			keyStatus: 'mismatch',
			secretStatus: 'invalid',
			pathWritable: false,
			spaceStatus: 'insufficient'
		});
		const result = await service.preview('backup-1');

		expect(result.report.blocking).toEqual(
			expect.arrayContaining([
				'database_integrity_failed',
				'key_mismatch',
				'restore_path_unwritable',
				'disk_space_insufficient'
			])
		);
		expect(result.confirmation).toBeNull();
		expect(createPlan).not.toHaveBeenCalled();
	});

	it('blocks snapshots with migrations newer than the running catalog', async () => {
		const newer = { createdAt: 300, hash: 'e'.repeat(64) };
		const { service } = fixture({
			manifest: manifest({ schemaVersion: '300' }),
			appliedMigrations: [MIGRATIONS[0]!, MIGRATIONS[1]!, newer]
		});
		const result = await service.preview('backup-1');

		expect(result.report.schema?.status).toBe('newer');
		expect(result.report.blocking).toContain('schema_newer_than_application');
		expect(result.confirmation).toBeNull();
	});
});

describe('restore key and migration compatibility', () => {
	it('requires the same environment-derived key fingerprint', async () => {
		const key = Buffer.alloc(32, 7);
		const environmentManifest = manifest({
			key: { mode: 'environment', fingerprint: fingerprintEncryptionKey(key), included: false }
		});
		expect(
			await resolveRestoreKey('/unused', environmentManifest, { mode: 'environment', key })
		).toMatchObject({ status: 'compatible', key });
		expect(
			await resolveRestoreKey('/unused', environmentManifest, {
				mode: 'environment',
				key: Buffer.alloc(32, 8)
			})
		).toEqual({ status: 'mismatch', key: null });
		expect(
			await resolveRestoreKey('/unused', environmentManifest, { mode: 'generated', key: null })
		).toEqual({ status: 'missing', key: null });
	});

	it('rejects a divergent chain even when its timestamp looks supported', () => {
		expect(
			compareRestoreMigrations('100', [{ createdAt: 100, hash: 'f'.repeat(64) }], MIGRATIONS)
		).toMatchObject({ status: 'incompatible', requiredMigrations: [] });
	});
});
