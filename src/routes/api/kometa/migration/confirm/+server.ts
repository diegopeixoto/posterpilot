import type { RequestHandler } from './$types';
import { confirmKometaMigration } from '$lib/server/kometa/migration';
import {
	kometaMigrationApiError,
	migrationJson,
	migrationRequestError,
	parseMigrationConfirmation,
	readMigrationJson
} from '$lib/server/kometa/migration-http';

export const POST: RequestHandler = async ({ request }) => {
	const parsed = parseMigrationConfirmation(await readMigrationJson(request), {
		allowAmbiguous: true
	});
	if (!parsed.ok) return migrationRequestError(parsed.code);
	try {
		return migrationJson(await confirmKometaMigration(parsed.value));
	} catch (error) {
		return kometaMigrationApiError(error);
	}
};
