import type { RequestHandler } from './$types';
import { confirmKometaMigrationRollback } from '$lib/server/kometa/migration';
import {
	kometaMigrationApiError,
	migrationJson,
	migrationRequestError,
	parseMigrationConfirmation,
	readMigrationJson
} from '$lib/server/kometa/migration-http';

export const POST: RequestHandler = async ({ request }) => {
	const parsed = parseMigrationConfirmation(await readMigrationJson(request), {
		allowAmbiguous: false
	});
	if (!parsed.ok) return migrationRequestError(parsed.code);
	try {
		return migrationJson(await confirmKometaMigrationRollback(parsed.value));
	} catch (error) {
		return kometaMigrationApiError(error);
	}
};
