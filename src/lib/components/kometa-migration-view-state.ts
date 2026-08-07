export const MIGRATION_DISCLOSURE_BATCH_SIZE = 30;
export const ROLLBACK_DISCLOSURE_BATCH_SIZE = 40;

export interface DisclosureState {
	shown: number;
	remaining: number;
	next: number;
}

function boundedCount(value: number): number {
	return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/** Keep progressive disclosure arithmetic bounded and deterministic for untrusted payload counts. */
export function disclosureState(
	currentLimit: number,
	total: number,
	batchSize: number
): DisclosureState {
	const boundedTotal = boundedCount(total);
	const boundedBatch = boundedCount(batchSize);
	const shown = Math.min(boundedCount(currentLimit), boundedTotal);
	const remaining = boundedTotal - shown;
	return {
		shown,
		remaining,
		next: Math.min(boundedBatch, remaining)
	};
}

/** Reveal one stable batch without ever exceeding the available inventory. */
export function nextDisclosureLimit(
	currentLimit: number,
	total: number,
	batchSize: number
): number {
	const state = disclosureState(currentLimit, total, batchSize);
	return state.shown + state.next;
}

const FROZEN_PREVIEW_TERMINAL_ERRORS = new Set([
	'migration_not_resumable',
	'migration_target_changed',
	'migration_evidence_changed',
	'migration_evidence_unavailable',
	'migration_legacy_changed',
	'migration_backup_invalid',
	'migration_write_failed',
	'migration_verify_failed',
	'migration_rollback_unavailable',
	'kometa_migration_not_required',
	'kometa_migration_in_progress',
	'kometa_migration_scope_changed',
	'kometa_migration_config_incompatible',
	'kometa_migration_path_conflict',
	'kometa_migration_rollback_unavailable',
	'kometa_server_binding_missing',
	'kometa_server_binding_incompatible',
	'kometa_server_binding_unavailable'
]);

/** These terminal plan identities cannot be confirmed again and should not trap the local UI. */
export function shouldDiscardFrozenPreview(code: string): boolean {
	return code.startsWith('plan_') || FROZEN_PREVIEW_TERMINAL_ERRORS.has(code);
}

export type ReconciledMigrationFeedback =
	| 'failure'
	| 'completed'
	| 'awaiting_manual_wiring'
	| 'rolled_back'
	| 'abandoned'
	| null;

/**
 * Prefer a newly loaded durable checkpoint over the request-level error that
 * prompted the refresh. Unchanged or intermediate state cannot prove an outcome.
 */
export function reconciledMigrationFeedback(
	previousVersion: string,
	currentVersion: string,
	state: { status: string; hasLastFailure: boolean } | null
): ReconciledMigrationFeedback {
	if (!state || previousVersion === currentVersion) return null;
	if (state.status === 'abandoned') return 'abandoned';
	if (state.hasLastFailure) return 'failure';
	if (
		state.status === 'completed' ||
		state.status === 'awaiting_manual_wiring' ||
		state.status === 'rolled_back'
	) {
		return state.status;
	}
	return null;
}
