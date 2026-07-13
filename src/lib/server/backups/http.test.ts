import { describe, expect, it } from 'vitest';
import { BackupServiceError } from './errors';
import { backupApiError } from './http';

describe('backupApiError', () => {
	it('serializes only the structured code and never an underlying path', async () => {
		const response = backupApiError(
			new BackupServiceError('backup_export_failed', 500, {
				cause: new Error('failed at /data/backups/secret-bundle/.app-key')
			}),
			'backup_inventory_failed'
		);
		const text = await response.text();
		expect(response.status).toBe(500);
		expect(JSON.parse(text)).toEqual({ error: { code: 'backup_export_failed' } });
		expect(text).not.toContain('/data/backups');
		expect(text).not.toContain('.app-key');
	});
});
