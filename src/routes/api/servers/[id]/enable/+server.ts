import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveConfig } from '$lib/server/config';
import { assertNoPendingKometaConfigMutationWhileOwned } from '$lib/server/kometa/config-mutation-recovery';
import { isKometaMigrationIncomplete } from '$lib/server/kometa/migration-journal';
import { loadActiveKometaMigrationJournal } from '$lib/server/kometa/migration-store';
import { withKometaMigrationControlLock } from '$lib/server/kometa/migration-control-lock';
import { enableManagedServer } from '$lib/server/server-instances';
import { serverInstanceErrorResponse } from '$lib/server/server-instances/http';
import { ServerInstanceError } from '$lib/server/server-instances/validation';

// Mirrors the disable route: re-enabling mutates the same binding state, so it
// takes the same migration control lock and refuses while a Kometa migration
// has this server's bindings frozen.
export const POST: RequestHandler = async ({ params }) => {
	try {
		if (!params.id) throw new ServerInstanceError('invalid_request');
		const serverInstanceId = params.id;
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
			return json({ server: await enableManagedServer(serverInstanceId, lease) });
		});
	} catch (error) {
		return serverInstanceErrorResponse(error);
	}
};
