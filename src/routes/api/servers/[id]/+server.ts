import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveConfig } from '$lib/server/config';
import { assertNoPendingKometaConfigMutationWhileOwned } from '$lib/server/kometa/config-mutation-recovery';
import { isKometaMigrationIncomplete } from '$lib/server/kometa/migration-journal';
import { loadActiveKometaMigrationJournal } from '$lib/server/kometa/migration-store';
import { withKometaMigrationControlLock } from '$lib/server/kometa/migration-control-lock';
import { updateManagedServer } from '$lib/server/server-instances';
import {
	hasAnyOwnKey,
	optionalConnectionSettings,
	optionalServerType,
	optionalString,
	readJsonObject,
	serverInstanceErrorResponse
} from '$lib/server/server-instances/http';
import { ServerInstanceError } from '$lib/server/server-instances/validation';

const UPDATE_KEYS = ['name', 'type', 'baseUrl', 'credential', 'connectionSettings'] as const;
const KOMETA_BINDING_UPDATE_KEYS = ['type', 'baseUrl', 'credential', 'connectionSettings'] as const;

export const PATCH: RequestHandler = async ({ params, request }) => {
	try {
		if (!params.id) throw new ServerInstanceError('invalid_request');
		const serverInstanceId = params.id;
		const body = await readJsonObject(request);
		if (!hasAnyOwnKey(body, UPDATE_KEYS)) throw new ServerInstanceError('invalid_request');
		const update = {
			name: optionalString(body, 'name'),
			type: optionalServerType(body),
			baseUrl: optionalString(body, 'baseUrl'),
			credential: optionalString(body, 'credential'),
			connectionSettings: optionalConnectionSettings(body)
		};
		if (!hasAnyOwnKey(body, KOMETA_BINDING_UPDATE_KEYS)) {
			return json({ server: await updateManagedServer(serverInstanceId, update) });
		}
		return await withKometaMigrationControlLock(async (assertControlLockOwned) => {
			const config = await resolveConfig();
			if (config.kometaServerInstanceId === serverInstanceId) {
				try {
					await assertNoPendingKometaConfigMutationWhileOwned(assertControlLockOwned);
				} catch {
					return json({ error: { code: 'kometa_config_recovery_required' } }, { status: 409 });
				}
			}
			try {
				const journal = await loadActiveKometaMigrationJournal();
				if (
					journal?.payload.serverInstanceId === serverInstanceId &&
					isKometaMigrationIncomplete(journal)
				) {
					return json({ error: { code: 'kometa_migration_config_locked' } }, { status: 409 });
				}
			} catch {
				return json({ error: { code: 'kometa_migration_config_locked' } }, { status: 409 });
			}
			const lease = await assertControlLockOwned();
			return json({ server: await updateManagedServer(serverInstanceId, update, lease) });
		});
	} catch (error) {
		return serverInstanceErrorResponse(error);
	}
};
