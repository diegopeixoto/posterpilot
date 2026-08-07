export type KometaConfigMutationAction = 'structured' | 'raw' | 'restore';

export interface KometaConfigMutationMigrationState {
	status: string;
	scopeMatches: boolean;
}

export type KometaMigrationMutationBlocker =
	| 'binding'
	| 'saving_settings'
	| 'dirty_settings'
	| null;

/** Allow only the settings UI needed to move a drifted live scope back to its journal. */
export function canRepairKometaMigrationScope(
	migration: KometaConfigMutationMigrationState | null
): boolean {
	return Boolean(
		migration &&
		!migration.scopeMatches &&
		migration.status !== 'completed' &&
		migration.status !== 'rolled_back'
	);
}

/**
 * Keep config.yml stable while a migration journal can still be resumed.
 * Manual activation is the sole exception: its exact wiring must be applied
 * through the raw editor before the user can acknowledge completion.
 */
export function isKometaConfigMutationLocked(
	action: KometaConfigMutationAction,
	migration: KometaConfigMutationMigrationState | null
): boolean {
	if (!migration || migration.status === 'completed' || migration.status === 'rolled_back') {
		return false;
	}
	// An incomplete durable journal owns its frozen config even when the live
	// settings have drifted away from that scope. Fail closed until the user
	// resolves or abandons the journal; manual wiring is safe only in-scope.
	if (!migration.scopeMatches) return true;
	return action !== 'raw' || migration.status !== 'awaiting_manual_wiring';
}

/**
 * Explain why a new migration cannot start without blocking recovery actions
 * that belong to an existing durable journal.
 */
export function kometaMigrationMutationBlocker(input: {
	migrationScopeLocked: boolean;
	bindingReady: boolean;
	savingHeader: boolean;
	headerDirty: boolean;
}): KometaMigrationMutationBlocker {
	if (input.migrationScopeLocked) return null;
	if (!input.bindingReady) return 'binding';
	if (input.savingHeader) return 'saving_settings';
	if (input.headerDirty) return 'dirty_settings';
	return null;
}
