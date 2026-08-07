import type { RequestHandler } from './$types';
import { previewKometaMigration } from '$lib/server/kometa/migration';
import { kometaMigrationApiError, migrationJson } from '$lib/server/kometa/migration-http';

export const POST: RequestHandler = async () => {
	try {
		return migrationJson(await previewKometaMigration());
	} catch (error) {
		return kometaMigrationApiError(error);
	}
};
