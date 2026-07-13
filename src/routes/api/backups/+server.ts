import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createApplicationBackup, listApplicationBackups } from '$lib/server/backups';
import { backupApiError } from '$lib/server/backups/http';

export const GET: RequestHandler = async () => {
	try {
		return json(
			{ backups: await listApplicationBackups() },
			{ headers: { 'Cache-Control': 'no-store' } }
		);
	} catch (error) {
		return backupApiError(error, 'backup_inventory_failed');
	}
};

/** Creating a manual backup is itself the explicit action; no secret data is returned. */
export const POST: RequestHandler = async () => {
	try {
		const created = await createApplicationBackup({ trigger: 'manual' });
		const backup = {
			id: created.id,
			bundleName: created.bundleName,
			status: 'completed' as const,
			trigger: created.manifest.trigger,
			createdAt: created.manifest.createdAt,
			completedAt: created.completedAt.toISOString(),
			validatedAt: created.completedAt.toISOString(),
			appVersion: created.manifest.appVersion,
			schemaVersion: created.manifest.schemaVersion,
			sizeBytes: created.sizeBytes,
			validationStatus: 'valid' as const,
			errorCode: null,
			protected: true,
			isManual: true,
			isSafety: false,
			canExport: true
		};
		return json(
			{ backup, retention: created.retention },
			{ status: 201, headers: { 'Cache-Control': 'no-store' } }
		);
	} catch (error) {
		return backupApiError(error, 'backup_creation_failed');
	}
};
