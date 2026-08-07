import type { RequestHandler } from './$types';
import { abandonKometaMigration } from '$lib/server/kometa/migration';
import {
	kometaMigrationApiError,
	migrationJson,
	migrationRequestError,
	parseMigrationAbandon,
	readMigrationJson
} from '$lib/server/kometa/migration-http';

export const POST: RequestHandler = async ({ request }) => {
	const parsed = parseMigrationAbandon(await readMigrationJson(request));
	if (!parsed.ok) return migrationRequestError(parsed.code);
	try {
		return migrationJson(await abandonKometaMigration(parsed.value));
	} catch (error) {
		return kometaMigrationApiError(error);
	}
};
