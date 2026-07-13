export type BackupServiceErrorCode =
	| 'backup_not_found'
	| 'backup_creation_failed'
	| 'backup_validation_failed'
	| 'backup_not_exportable'
	| 'backup_export_confirmation_required'
	| 'backup_delete_confirmation_required'
	| 'protected_backup_confirmation_required'
	| 'backup_delete_failed'
	| 'backup_export_failed'
	| 'backup_inventory_failed'
	| 'restore_preflight_failed'
	| 'restore_confirmation_required'
	| 'restore_confirmation_invalid'
	| 'restore_confirmation_expired'
	| 'restore_confirmation_used'
	| 'restore_state_changed'
	| 'restore_drain_timeout'
	| 'restore_safety_backup_failed'
	| 'restore_staging_failed'
	| 'maintenance_mode'
	| 'retention_policy_invalid'
	| 'retention_policy_failed'
	| 'request_invalid';

/** Error contract safe to serialize: code/status only, never filesystem detail. */
export class BackupServiceError extends Error {
	readonly code: BackupServiceErrorCode;
	readonly status: number;

	constructor(code: BackupServiceErrorCode, status: number, options?: ErrorOptions) {
		super(code, options);
		this.name = 'BackupServiceError';
		this.code = code;
		this.status = status;
	}
}

export function asBackupServiceError(
	error: unknown,
	fallbackCode: BackupServiceErrorCode,
	fallbackStatus = 500
): BackupServiceError {
	return error instanceof BackupServiceError
		? error
		: new BackupServiceError(fallbackCode, fallbackStatus, { cause: error });
}
