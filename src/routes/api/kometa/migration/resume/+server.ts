import type { RequestHandler } from './$types';
import { resumeKometaMigration } from '$lib/server/kometa/migration';
import {
	kometaMigrationApiError,
	migrationJson,
	migrationRequestError,
	parseMigrationResume,
	readMigrationJson
} from '$lib/server/kometa/migration-http';

export const POST: RequestHandler = async ({ request }) => {
	const parsed = parseMigrationResume(await readMigrationJson(request));
	if (!parsed.ok) return migrationRequestError(parsed.code);
	try {
		return migrationJson(await resumeKometaMigration(parsed.value));
	} catch (error) {
		return kometaMigrationApiError(error);
	}
};
