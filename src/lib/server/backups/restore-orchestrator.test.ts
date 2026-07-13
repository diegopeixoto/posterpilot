import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashCanonicalJson } from '$lib/server/plans/canonical-json';
import type { BackupManifestV1 } from './manifest';
import {
	createRestoreConfirmationService,
	type RestoreConfirmationDependencies
} from './restore-orchestrator';
import type { RestoreOperationPlanPayload, RestorePreflightReport } from './restore-preflight';

const NOW = new Date('2026-07-10T21:00:00.000Z');
const MANIFEST_CHECKSUM = 'a'.repeat(64);

function manifest(): BackupManifestV1 {
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
		files: [{ path: 'database.db', role: 'database', sizeBytes: 100, sha256: 'b'.repeat(64) }],
		externalPaths: []
	};
}

function report(): RestorePreflightReport {
	return {
		version: 1,
		backupId: 'backup-1',
		manifestChecksum: MANIFEST_CHECKSUM,
		generatedAt: '2026-07-10T20:00:00.000Z',
		restorable: true,
		blocking: [],
		warnings: [],
		bundle: {
			status: 'valid',
			issues: [],
			appVersion: '0.8.0',
			schemaVersion: '100',
			createdAt: '2026-07-01T10:00:00.000Z'
		},
		replacement: { database: true, applicationKey: false, configurationFiles: 0 },
		key: {
			mode: 'none',
			status: 'not_required',
			encryptedSecretCount: 0,
			secretStatus: 'not_present'
		},
		database: { status: 'ok' },
		schema: {
			status: 'current',
			backupSchemaVersion: '100',
			currentSchemaVersion: '100',
			requiredMigrations: []
		},
		storage: {
			paths: {
				database: 'writable',
				application_key: 'not_applicable',
				restore_staging: 'writable',
				backup_storage: 'writable'
			},
			requiredBytes: 1024,
			spaceStatus: 'sufficient'
		},
		externalPaths: []
	};
}

function fixture() {
	const events: string[] = [];
	const preview = report();
	const previewChecksum = hashCanonicalJson({
		version: 1,
		backupId: 'backup-1',
		manifestChecksum: MANIFEST_CHECKSUM,
		report: preview
	});
	const payload: RestoreOperationPlanPayload = {
		version: 1,
		action: 'application_restore',
		restoreId: 'restore-1',
		backupId: 'backup-1',
		bundleName: 'bundle-backup-1',
		manifestChecksum: MANIFEST_CHECKSUM,
		previewChecksum,
		report: preview
	};
	const find = vi.fn(async () => ({
		id: 'restore-1',
		backupId: 'backup-1',
		safetyBackupId: null,
		operationPlanId: 'plan-1',
		status: 'previewed' as const,
		previewChecksum,
		report: preview as unknown as Record<string, unknown>,
		errorCode: null,
		error: null,
		createdAt: new Date('2026-07-10T20:00:00.000Z'),
		startedAt: null,
		completedAt: null
	}));
	const markPendingRestart = vi.fn(async () => {
		events.push('record');
	});
	const markFailed = vi.fn(async () => undefined);
	const deps: RestoreConfirmationDependencies = {
		consumePlan: vi.fn(async () => ({
			id: 'plan-1',
			kind: 'application_restore',
			serverInstanceId: null,
			librarySectionKey: null,
			payload,
			digest: 'c'.repeat(64),
			createdAt: new Date('2026-07-10T20:00:00.000Z'),
			expiresAt: new Date('2026-07-10T20:15:00.000Z'),
			consumedAt: NOW
		})),
		validateBackup: vi.fn(async () => ({
			record: { id: 'backup-1', bundleName: 'bundle-backup-1' },
			validation: {
				status: 'valid' as const,
				issues: [],
				manifest: manifest(),
				manifestChecksum: MANIFEST_CHECKSUM,
				sizeBytes: 100,
				validatedAt: NOW
			},
			bundleDirectory: '/safe/bundle'
		})),
		enterMaintenance: vi.fn(() => events.push('maintenance')),
		leaveMaintenance: vi.fn(() => events.push('leave')),
		drainJobs: vi.fn(async () => {
			events.push('drain');
		}),
		createSafetyBackup: vi.fn(async () => {
			events.push('safety');
			return { id: 'safety-1' };
		}),
		stage: vi.fn(async () => {
			events.push('stage');
		}),
		recordStore: { find, markPendingRestart, markFailed },
		clock: () => NOW
	};
	return {
		service: createRestoreConfirmationService(deps),
		deps,
		events,
		payload,
		previewChecksum,
		find,
		markPendingRestart,
		markFailed
	};
}

describe('restore confirmation orchestration', () => {
	beforeEach(() => vi.clearAllMocks());

	it('drains accepted work, creates safety state, records it, and stages the exact payload', async () => {
		const { service, deps, events, markPendingRestart, previewChecksum } = fixture();
		const result = await service.confirm({
			backupId: 'backup-1',
			planId: 'plan-1',
			digest: 'c'.repeat(64)
		});

		expect(result).toEqual({
			restoreId: 'restore-1',
			backupId: 'backup-1',
			safetyBackupId: 'safety-1',
			status: 'restart_required'
		});
		expect(events).toEqual(['maintenance', 'drain', 'safety', 'record', 'stage']);
		expect(markPendingRestart).toHaveBeenCalledWith('restore-1', 'safety-1', expect.any(Object));
		expect(deps.stage).toHaveBeenCalledWith(
			expect.objectContaining({
				bundleDirectory: '/safe/bundle',
				restore: expect.objectContaining({
					restoreId: 'restore-1',
					safetyBackupId: 'safety-1',
					previewChecksum
				})
			})
		);
		expect(deps.leaveMaintenance).not.toHaveBeenCalled();
	});

	it('rejects a changed bundle before entering maintenance', async () => {
		const { service, deps, markFailed } = fixture();
		deps.validateBackup = vi.fn(async () => ({
			record: { id: 'backup-1', bundleName: 'bundle-backup-1' },
			validation: {
				status: 'invalid' as const,
				issues: ['payload_checksum_mismatch' as const],
				manifest: null,
				manifestChecksum: 'f'.repeat(64),
				sizeBytes: 100,
				validatedAt: NOW
			},
			bundleDirectory: '/safe/bundle'
		}));

		await expect(
			service.confirm({ backupId: 'backup-1', planId: 'plan-1', digest: 'c'.repeat(64) })
		).rejects.toMatchObject({ code: 'restore_state_changed' });
		expect(deps.enterMaintenance).not.toHaveBeenCalled();
		expect(deps.createSafetyBackup).not.toHaveBeenCalled();
		expect(deps.stage).not.toHaveBeenCalled();
		expect(markFailed).toHaveBeenCalledWith('restore-1', 'restore_state_changed', NOW);
	});

	it('leaves maintenance when draining fails and never creates a safety backup', async () => {
		const { service, deps, markFailed } = fixture();
		deps.drainJobs = vi.fn(async () => {
			throw new Error('timeout');
		});

		await expect(
			service.confirm({ backupId: 'backup-1', planId: 'plan-1', digest: 'c'.repeat(64) })
		).rejects.toMatchObject({ code: 'restore_drain_timeout' });
		expect(deps.leaveMaintenance).toHaveBeenCalledOnce();
		expect(deps.createSafetyBackup).not.toHaveBeenCalled();
		expect(markFailed).toHaveBeenCalledWith('restore-1', 'restore_drain_timeout', NOW);
	});
});
