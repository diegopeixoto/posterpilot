import type { RequestHandler } from './$types';
import { cancelKometaMigrationPreview } from '$lib/server/kometa/migration';
import {
	kometaMigrationApiError,
	migrationJson,
	migrationRequestError,
	parseMigrationPlanIdentity,
	readMigrationJson
} from '$lib/server/kometa/migration-http';

export const POST: RequestHandler = async ({ request }) => {
	const parsed = parseMigrationPlanIdentity(await readMigrationJson(request));
	if (!parsed.ok) return migrationRequestError(parsed.code);
	try {
		return migrationJson(await cancelKometaMigrationPreview(parsed.value));
	} catch (error) {
		return kometaMigrationApiError(error);
	}
};
