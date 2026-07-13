import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteApplicationBackup } from '$lib/server/backups';
import { backupApiError, readBackupJsonObject } from '$lib/server/backups/http';

export const DELETE: RequestHandler = async ({ params, request }) => {
	try {
		const body = await readBackupJsonObject(request);
		return json(
			await deleteApplicationBackup(params.id, {
				confirm: body.confirm === true,
				confirmProtected: body.confirmProtected === true
			}),
			{ headers: { 'Cache-Control': 'no-store' } }
		);
	} catch (error) {
		return backupApiError(error, 'backup_delete_failed');
	}
};
