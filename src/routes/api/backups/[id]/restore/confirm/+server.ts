import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { confirmApplicationRestore } from '$lib/server/backups';
import { backupApiError, readBackupJsonObject } from '$lib/server/backups/http';
import { BackupServiceError } from '$lib/server/backups/errors';

export const POST: RequestHandler = async ({ params, request }) => {
	try {
		const body = await readBackupJsonObject(request);
		if (typeof body.planId !== 'string' || typeof body.digest !== 'string') {
			throw new BackupServiceError('restore_confirmation_required', 400);
		}
		return json(
			await confirmApplicationRestore({
				backupId: params.id,
				planId: body.planId,
				digest: body.digest
			}),
			{ headers: { 'Cache-Control': 'no-store' } }
		);
	} catch (error) {
		return backupApiError(error, 'restore_staging_failed');
	}
};
