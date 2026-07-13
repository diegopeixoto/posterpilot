import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	createApplicationBackup: vi.fn(),
	listApplicationBackups: vi.fn(),
	previewApplicationRestore: vi.fn(),
	confirmApplicationRestore: vi.fn()
}));

vi.mock('$lib/server/backups', () => ({
	createApplicationBackup: h.createApplicationBackup,
	listApplicationBackups: h.listApplicationBackups,
	previewApplicationRestore: h.previewApplicationRestore,
	confirmApplicationRestore: h.confirmApplicationRestore
}));

import { GET, POST } from './+server';
import { POST as RESTORE_PREVIEW } from './[id]/restore/preview/+server';
import { POST as RESTORE_CONFIRM } from './[id]/restore/confirm/+server';

describe('/api/backups', () => {
	beforeEach(() => {
		h.createApplicationBackup.mockReset();
		h.listApplicationBackups.mockReset();
		h.previewApplicationRestore.mockReset();
		h.confirmApplicationRestore.mockReset();
	});

	it('requires and forwards the exact restore plan confirmation', async () => {
		h.confirmApplicationRestore.mockResolvedValue({
			restoreId: 'restore-id',
			backupId: 'backup-id',
			safetyBackupId: 'safety-id',
			status: 'restart_required'
		});
		const response = await (RESTORE_CONFIRM as (event: unknown) => Promise<Response>)({
			params: { id: 'backup-id' },
			request: new Request('http://localhost/api/backups/backup-id/restore/confirm', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ planId: 'plan-id', digest: 'd'.repeat(64) })
			})
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			backupId: 'backup-id',
			safetyBackupId: 'safety-id',
			status: 'restart_required'
		});
		expect(h.confirmApplicationRestore).toHaveBeenCalledWith({
			backupId: 'backup-id',
			planId: 'plan-id',
			digest: 'd'.repeat(64)
		});
	});

	it('returns a no-store restore preview with an exact confirmation binding', async () => {
		h.previewApplicationRestore.mockResolvedValue({
			report: {
				version: 1,
				backupId: 'backup-id',
				manifestChecksum: 'a'.repeat(64),
				restorable: true,
				blocking: [],
				warnings: []
			},
			confirmation: {
				restoreId: 'restore-id',
				planId: 'plan-id',
				digest: 'b'.repeat(64),
				expiresAt: '2026-07-10T20:15:00.000Z',
				previewChecksum: 'c'.repeat(64)
			}
		});

		const response = await (RESTORE_PREVIEW as (event: unknown) => Promise<Response>)({
			params: { id: 'backup-id' }
		});
		const text = await response.text();
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(JSON.parse(text)).toMatchObject({
			report: { backupId: 'backup-id', restorable: true },
			confirmation: { planId: 'plan-id', digest: 'b'.repeat(64) }
		});
		expect(h.previewApplicationRestore).toHaveBeenCalledWith('backup-id');
		expect(text).not.toContain('/data/');
	});

	it('returns a sanitized manual-backup summary without a server path or manifest', async () => {
		h.createApplicationBackup.mockResolvedValue({
			id: 'backup-id',
			bundleName: '20260710T100000000Z-backup-id',
			storagePath: '/data/backups/20260710T100000000Z-backup-id',
			manifest: {
				trigger: 'manual',
				createdAt: '2026-07-10T10:00:00.000Z',
				appVersion: '1.2.3',
				schemaVersion: '123',
				externalPaths: [{ path: '/mnt/private/kometa' }]
			},
			sizeBytes: 1234,
			completedAt: new Date('2026-07-10T10:00:01.000Z'),
			retention: {
				ok: true,
				policy: { maxCount: null, maxAgeDays: null },
				deletedIds: [],
				skippedIds: [],
				failedIds: []
			}
		});

		const response = await (POST as (event: unknown) => Promise<Response>)({});
		const text = await response.text();
		expect(response.status).toBe(201);
		expect(JSON.parse(text)).toMatchObject({
			backup: { id: 'backup-id', protected: true, isManual: true },
			retention: { ok: true }
		});
		expect(text).not.toContain('/data/backups');
		expect(text).not.toContain('/mnt/private/kometa');
		expect(text).not.toContain('externalPaths');
	});

	it('returns only a structured error code when inventory fails', async () => {
		h.listApplicationBackups.mockRejectedValue(
			new Error('cannot read /data/backups/private-bundle')
		);
		const response = await (GET as (event: unknown) => Promise<Response>)({});
		const text = await response.text();
		expect(response.status).toBe(500);
		expect(JSON.parse(text)).toEqual({ error: { code: 'backup_inventory_failed' } });
		expect(text).not.toContain('/data/backups');
	});
});
