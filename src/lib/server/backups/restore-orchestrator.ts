import { hashCanonicalJson } from '$lib/server/plans/canonical-json';
import type { OperationPlan } from '$lib/server/plans/operation-plan-store';
import type { PendingRestoreContextV1 } from '$lib/server/db/pending-restore';
import type { BackupManifestV1 } from './manifest';
import type { BackupBundleValidation } from './validation';
import type { RestorePreflightRecordStore } from './restore-records';
import type { RestoreOperationPlanPayload } from './restore-preflight';

export type RestoreConfirmationErrorCode =
	| 'restore_confirmation_invalid'
	| 'restore_state_changed'
	| 'restore_drain_timeout'
	| 'restore_safety_backup_failed'
	| 'restore_staging_failed';

export class RestoreConfirmationError extends Error {
	constructor(
		readonly code: RestoreConfirmationErrorCode,
		options?: ErrorOptions
	) {
		super(code, options);
		this.name = 'RestoreConfirmationError';
	}
}

export interface RestoreConfirmationRequest {
	backupId: string;
	planId: string;
	digest: string;
}

export interface RestoreConfirmationResult {
	restoreId: string;
	backupId: string;
	safetyBackupId: string;
	status: 'restart_required';
}

export interface RevalidatedRestoreBackup {
	record: { id: string; bundleName: string };
	validation: BackupBundleValidation;
	bundleDirectory: string;
}

export interface RestoreConfirmationDependencies {
	consumePlan(planId: string, digest: string): Promise<OperationPlan<RestoreOperationPlanPayload>>;
	validateBackup(backupId: string): Promise<RevalidatedRestoreBackup>;
	enterMaintenance(): void;
	leaveMaintenance(): void;
	drainJobs(): Promise<void>;
	createSafetyBackup(): Promise<{ id: string }>;
	stage(input: {
		bundleDirectory: string;
		manifest: BackupManifestV1;
		restore: PendingRestoreContextV1;
	}): Promise<void>;
	recordStore: Pick<RestorePreflightRecordStore, 'find' | 'markPendingRestart' | 'markFailed'>;
	clock?: () => Date;
}

function isHash(value: unknown): value is string {
	return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function assertPayload(value: unknown): asserts value is RestoreOperationPlanPayload {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new RestoreConfirmationError('restore_confirmation_invalid');
	}
	const payload = value as Partial<RestoreOperationPlanPayload>;
	const id = /^[A-Za-z0-9-]{1,128}$/;
	if (
		payload.version !== 1 ||
		payload.action !== 'application_restore' ||
		typeof payload.restoreId !== 'string' ||
		!id.test(payload.restoreId) ||
		typeof payload.backupId !== 'string' ||
		!id.test(payload.backupId) ||
		typeof payload.bundleName !== 'string' ||
		!id.test(payload.bundleName) ||
		!isHash(payload.manifestChecksum) ||
		!isHash(payload.previewChecksum) ||
		!payload.report ||
		payload.report.restorable !== true ||
		payload.report.backupId !== payload.backupId ||
		payload.report.manifestChecksum !== payload.manifestChecksum
	) {
		throw new RestoreConfirmationError('restore_confirmation_invalid');
	}
}

/** Consume one exact preview, quiesce mutations, create safety state, and stage boot restore. */
export function createRestoreConfirmationService(deps: RestoreConfirmationDependencies) {
	const clock = deps.clock ?? (() => new Date());

	return {
		async confirm(request: RestoreConfirmationRequest): Promise<RestoreConfirmationResult> {
			const plan = await deps.consumePlan(request.planId, request.digest);
			assertPayload(plan.payload);
			const payload = plan.payload;
			if (payload.backupId !== request.backupId) {
				throw new RestoreConfirmationError('restore_state_changed');
			}
			let maintenance = false;
			let staged = false;
			let failureCode: RestoreConfirmationErrorCode = 'restore_state_changed';

			try {
				const record = await deps.recordStore.find(payload.restoreId);
				if (
					!record ||
					record.status !== 'previewed' ||
					record.backupId !== payload.backupId ||
					record.operationPlanId !== plan.id ||
					record.previewChecksum !== payload.previewChecksum
				) {
					throw new RestoreConfirmationError('restore_state_changed');
				}

				const validated = await deps.validateBackup(payload.backupId);
				const validation = validated.validation;
				if (
					validation.status === 'invalid' ||
					!validation.manifest ||
					validation.manifest.backupId !== payload.backupId ||
					validation.manifestChecksum !== payload.manifestChecksum ||
					validated.record.bundleName !== payload.bundleName ||
					hashCanonicalJson({
						version: 1,
						backupId: payload.backupId,
						manifestChecksum: payload.manifestChecksum,
						report: payload.report
					}) !== payload.previewChecksum
				) {
					throw new RestoreConfirmationError('restore_state_changed');
				}

				deps.enterMaintenance();
				maintenance = true;
				failureCode = 'restore_drain_timeout';
				await deps.drainJobs();

				failureCode = 'restore_safety_backup_failed';
				const safety = await deps.createSafetyBackup();
				const restore: PendingRestoreContextV1 = {
					restoreId: payload.restoreId,
					backupId: payload.backupId,
					safetyBackupId: safety.id,
					manifestChecksum: payload.manifestChecksum,
					previewChecksum: payload.previewChecksum,
					createdAt: clock().toISOString()
				};
				await deps.recordStore.markPendingRestart(payload.restoreId, safety.id, {
					...(payload.report as unknown as Record<string, unknown>),
					orchestration: { status: 'pending_restart', safetyBackupId: safety.id }
				});

				failureCode = 'restore_staging_failed';
				await deps.stage({
					bundleDirectory: validated.bundleDirectory,
					manifest: validation.manifest,
					restore
				});
				staged = true;
				return {
					restoreId: payload.restoreId,
					backupId: payload.backupId,
					safetyBackupId: safety.id,
					status: 'restart_required'
				};
			} catch (error) {
				const safeError =
					error instanceof RestoreConfirmationError
						? error
						: new RestoreConfirmationError(failureCode, { cause: error });
				if (!staged) {
					if (maintenance) deps.leaveMaintenance();
					await deps.recordStore
						.markFailed(payload.restoreId, safeError.code, clock())
						.catch(() => undefined);
				}
				throw safeError;
			}
		}
	};
}
