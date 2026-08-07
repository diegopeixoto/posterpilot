import type { RequestHandler } from './$types';
import { acknowledgeKometaMigration } from '$lib/server/kometa/migration';
import {
	kometaMigrationApiError,
	migrationJson,
	migrationRequestError,
	parseMigrationAcknowledgement,
	readMigrationJson
} from '$lib/server/kometa/migration-http';

export const POST: RequestHandler = async ({ request }) => {
	const parsed = parseMigrationAcknowledgement(await readMigrationJson(request));
	if (!parsed.ok) return migrationRequestError(parsed.code);
	try {
		return migrationJson(await acknowledgeKometaMigration(parsed.value));
	} catch (error) {
		return kometaMigrationApiError(error);
	}
};
