import { assertNoPendingKometaConfigMutationWhileOwned } from '$lib/server/kometa/config-mutation-recovery';
import { isKometaMigrationIncomplete } from '$lib/server/kometa/migration-journal';
import {
	withKometaMigrationControlLock,
	type KometaMigrationControlLease
} from '$lib/server/kometa/migration-control-lock';
import { loadKometaMigrationJournalForGuard } from '$lib/server/kometa/migration-store';
import { LEGACY_SERVER_INSTANCE_ID } from './legacy';

export type LegacyServerMutationControlErrorCode =
	| 'kometa_config_recovery_required'
	| 'kometa_migration_config_locked';

export class LegacyServerMutationControlError extends Error {
	constructor(readonly code: LegacyServerMutationControlErrorCode) {
		super(code);
		this.name = 'LegacyServerMutationControlError';
	}
}

export interface LegacyServerMutationControl {
	assertControlLockOwned: () => Promise<KometaMigrationControlLease>;
	controlLease: KometaMigrationControlLease;
}

/**
 * Serialize a mutation of the protected legacy binding with every Kometa config
 * commit and migration. The final lease renewal closes the journal-insert race;
 * callers must pass that token into the transaction that performs the write.
 */
export async function withLegacyServerMutationControl<T>(
	operation: (control: LegacyServerMutationControl) => Promise<T>
): Promise<T> {
	return withKometaMigrationControlLock(async (assertControlLockOwned) => {
		try {
			await assertNoPendingKometaConfigMutationWhileOwned(assertControlLockOwned);
		} catch {
			throw new LegacyServerMutationControlError('kometa_config_recovery_required');
		}

		let journal: Awaited<ReturnType<typeof loadKometaMigrationJournalForGuard>>;
		try {
			journal = await loadKometaMigrationJournalForGuard(LEGACY_SERVER_INSTANCE_ID);
		} catch {
			throw new LegacyServerMutationControlError('kometa_migration_config_locked');
		}
		if (journal && isKometaMigrationIncomplete(journal)) {
			throw new LegacyServerMutationControlError('kometa_migration_config_locked');
		}

		const controlLease = await assertControlLockOwned();
		return operation({ assertControlLockOwned, controlLease });
	});
}
