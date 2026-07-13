import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { validateApplicationBackup } from '$lib/server/backups';
import { backupApiError } from '$lib/server/backups/http';

export const POST: RequestHandler = async ({ params }) => {
	try {
		return json(await validateApplicationBackup(params.id), {
			headers: { 'Cache-Control': 'no-store' }
		});
	} catch (error) {
		return backupApiError(error, 'backup_validation_failed');
	}
};
