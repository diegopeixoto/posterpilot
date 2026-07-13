import { desc, eq } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import { restoreRecords } from '$lib/server/db/schema';

export type RestoreRecord = typeof restoreRecords.$inferSelect;

export interface CreateRestorePreviewRecord {
	id: string;
	backupId: string;
	operationPlanId: string;
	previewChecksum: string;
	report: Record<string, unknown>;
	createdAt: Date;
}

export interface RestorePreflightRecordStore {
	createPreview(record: CreateRestorePreviewRecord): Promise<void>;
	find(id: string): Promise<RestoreRecord | null>;
	list(limit?: number): Promise<RestoreRecord[]>;
	markPendingRestart(
		id: string,
		safetyBackupId: string,
		report: Record<string, unknown>
	): Promise<void>;
	markFailed(id: string, errorCode: string, completedAt: Date): Promise<void>;
	finalizeBootOutcome(input: {
		id: string;
		backupId: string;
		safetyBackupId: string;
		previewChecksum: string;
		status: 'completed' | 'rolled_back' | 'failed';
		report: Record<string, unknown>;
		errorCode: string | null;
		createdAt: Date;
		completedAt: Date;
	}): Promise<void>;
}

export function createRestorePreflightRecordStore(
	database: LibSQLDatabase<typeof schema>
): RestorePreflightRecordStore {
	return {
		async createPreview(record): Promise<void> {
			await database.insert(restoreRecords).values({
				id: record.id,
				backupId: record.backupId,
				operationPlanId: record.operationPlanId,
				status: 'previewed',
				previewChecksum: record.previewChecksum,
				report: record.report,
				createdAt: record.createdAt
			});
		},

		async find(id): Promise<RestoreRecord | null> {
			return (
				(
					await database.select().from(restoreRecords).where(eq(restoreRecords.id, id)).limit(1)
				)[0] ?? null
			);
		},

		async list(limit = 20): Promise<RestoreRecord[]> {
			if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
				throw new RangeError('restore history limit is invalid');
			}
			return database
				.select()
				.from(restoreRecords)
				.orderBy(desc(restoreRecords.createdAt))
				.limit(limit);
		},

		async markPendingRestart(id, safetyBackupId, report): Promise<void> {
			const result = await database
				.update(restoreRecords)
				.set({ status: 'pending_restart', safetyBackupId, report, errorCode: null, error: null })
				.where(eq(restoreRecords.id, id));
			if (result.rowsAffected !== 1) throw new Error('restore preview record was not found');
		},

		async markFailed(id, errorCode, completedAt): Promise<void> {
			const result = await database
				.update(restoreRecords)
				.set({ status: 'failed', errorCode, error: null, completedAt })
				.where(eq(restoreRecords.id, id));
			if (result.rowsAffected !== 1) throw new Error('restore preview record was not found');
		},

		async finalizeBootOutcome(input): Promise<void> {
			await database
				.insert(restoreRecords)
				.values({
					id: input.id,
					backupId: input.backupId,
					safetyBackupId: input.safetyBackupId,
					operationPlanId: null,
					status: input.status,
					previewChecksum: input.previewChecksum,
					report: input.report,
					errorCode: input.errorCode,
					error: null,
					createdAt: input.createdAt,
					completedAt: input.completedAt
				})
				.onConflictDoUpdate({
					target: restoreRecords.id,
					set: {
						safetyBackupId: input.safetyBackupId,
						operationPlanId: null,
						status: input.status,
						report: input.report,
						errorCode: input.errorCode,
						error: null,
						completedAt: input.completedAt
					}
				});
		}
	};
}
