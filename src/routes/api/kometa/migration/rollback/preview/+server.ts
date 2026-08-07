import type { RequestHandler } from './$types';
import { previewKometaMigrationRollback } from '$lib/server/kometa/migration';
import { kometaMigrationApiError, migrationJson } from '$lib/server/kometa/migration-http';

export const POST: RequestHandler = async () => {
	try {
		return migrationJson(await previewKometaMigrationRollback());
	} catch (error) {
		return kometaMigrationApiError(error);
	}
};
