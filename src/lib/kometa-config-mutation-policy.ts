export type KometaConfigMutationAction = 'structured' | 'raw' | 'restore';

export interface KometaConfigMutationMigrationState {
	status: string;
	scopeMatches: boolean;
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
	if (
		!migration?.scopeMatches ||
		migration.status === 'completed' ||
		migration.status === 'rolled_back'
	) {
		return false;
	}
	return action !== 'raw' || migration.status !== 'awaiting_manual_wiring';
}
