import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	finalizeOutcome: vi.fn(),
	reconcile: vi.fn(),
	inspectDatabase: vi.fn(),
	inspectStorage: vi.fn(),
	inspectExternal: vi.fn(),
	resolveConfig: vi.fn(),
	finalizePending: vi.fn(),
	execute: vi.fn(),
	inspectScope: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({
	env: { DATABASE_URL: 'file:./data/posterpilot.db', APP_KEY_FILE: './data/.app-key' }
}));
vi.mock('$lib/server/db', () => ({
	db: {},
	databaseClient: { execute: h.execute }
}));
vi.mock('$lib/server/db/scope-integrity', () => ({ inspectScopeIntegrity: h.inspectScope }));
vi.mock('$lib/server/config', () => ({ resolveConfig: h.resolveConfig }));
vi.mock('$lib/server/secrets/key', () => ({ getEncryptionKey: () => Buffer.alloc(32, 1) }));
vi.mock('$lib/server/db/pending-restore', () => ({
	finalizeAppliedPendingRestore: h.finalizePending
}));
vi.mock('./restore-records', () => ({
	createRestorePreflightRecordStore: () => ({ finalizeBootOutcome: h.finalizeOutcome })
}));
vi.mock('./inventory', () => ({ reconcileBackupInventory: h.reconcile }));
vi.mock('./restore-inspection', () => ({
	inspectRestoreDatabase: h.inspectDatabase,
	inspectRestoreStorage: h.inspectStorage,
	inspectExternalPaths: h.inspectExternal
}));

import { finalizeApplicationRestoreBoot } from './restore-boot';

const restore = {
	restoreId: 'restore-1',
	backupId: 'backup-1',
	safetyBackupId: 'safety-1',
	manifestChecksum: 'a'.repeat(64),
	previewChecksum: 'b'.repeat(64),
	createdAt: '2026-07-10T21:00:00.000Z'
};

describe('restore boot finalization', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.inspectScope.mockResolvedValue({
			ok: true,
			violationCount: 0,
			checkedRelations: 19,
			violations: []
		});
		h.inspectDatabase.mockResolvedValue({
			status: 'ok',
			appliedMigrations: [{ createdAt: 100, hash: 'c'.repeat(64) }],
			encryptedSecretCount: 1,
			secretStatus: 'valid'
		});
		h.inspectStorage.mockResolvedValue({
			paths: {
				database: 'writable',
				application_key: 'not_applicable',
				restore_staging: 'writable',
				backup_storage: 'writable'
			},
			requiredBytes: 1024,
			spaceStatus: 'sufficient'
		});
		h.resolveConfig.mockResolvedValue({ kometaAssetsDir: '/assets', kometaConfigPath: '/config' });
		h.inspectExternal.mockResolvedValue([]);
	});

	it('commits only after local readiness and records the completed report', async () => {
		await finalizeApplicationRestoreBoot({
			status: 'applied',
			rollbackMarker: './data/restore-rollback/marker.json',
			restore
		});

		expect(h.reconcile).toHaveBeenCalledOnce();
		expect(h.finalizeOutcome).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'restore-1',
				backupId: 'backup-1',
				safetyBackupId: 'safety-1',
				status: 'completed',
				errorCode: null,
				report: { readiness: expect.objectContaining({ status: 'ready', blocking: [] }) }
			})
		);
		expect(h.finalizePending).toHaveBeenCalledWith(expect.any(Object), 'restore-1');
	});

	it('fails closed and retains rollback when local readiness is blocked', async () => {
		h.inspectDatabase.mockResolvedValue({
			status: 'integrity_failed',
			appliedMigrations: [],
			encryptedSecretCount: 0,
			secretStatus: 'not_present'
		});

		await expect(
			finalizeApplicationRestoreBoot({
				status: 'applied',
				rollbackMarker: './data/restore-rollback/marker.json',
				restore
			})
		).rejects.toThrow('restore_readiness_failed:database_integrity_failed');
		expect(h.finalizeOutcome).not.toHaveBeenCalled();
		expect(h.finalizePending).not.toHaveBeenCalled();
	});

	it('fails closed when a scoped child belongs to another server namespace', async () => {
		h.inspectScope.mockResolvedValue({
			ok: false,
			violationCount: 1,
			checkedRelations: 19,
			violations: [{ relation: 'poster_candidates.media_item_id', rows: 1 }]
		});

		await expect(
			finalizeApplicationRestoreBoot({
				status: 'applied',
				rollbackMarker: './data/restore-rollback/marker.json',
				restore
			})
		).rejects.toThrow('restore_readiness_failed:server_namespace_invalid');
		expect(h.finalizeOutcome).not.toHaveBeenCalled();
		expect(h.finalizePending).not.toHaveBeenCalled();
	});

	it('records an automatic rollback against the restored preview identity', async () => {
		await finalizeApplicationRestoreBoot({
			status: 'rolled_back',
			failedMarker: './data/restore-failed.json',
			rollbackMarker: './data/restore-rollback/marker.json',
			error: 'readiness failed',
			restore
		});

		expect(h.inspectDatabase).not.toHaveBeenCalled();
		expect(h.finalizeOutcome).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'restore-1',
				status: 'rolled_back',
				errorCode: 'restore_rolled_back'
			})
		);
		expect(h.finalizePending).not.toHaveBeenCalled();
	});
});
