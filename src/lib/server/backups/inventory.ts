import { chmod, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { desc, eq, ne } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type { DataPaths } from '$lib/server/data-paths';
import * as schema from '$lib/server/db/schema';
import { backupRecords } from '$lib/server/db/schema';
import { BackupServiceError } from './errors';
import type { BackupManifestV1 } from './manifest';
import {
	validateBackupBundle,
	type BackupBundleValidation,
	type BackupValidationIssueCode,
	type BackupValidationStatus
} from './validation';

const SAFE_BUNDLE_NAME = /^[A-Za-z0-9-]+$/;

export type BackupRecord = typeof backupRecords.$inferSelect;

export interface BackupInventoryContext {
	database: LibSQLDatabase<typeof schema>;
	dataPaths: DataPaths;
}

export interface BackupInventoryItem {
	id: string;
	bundleName: string;
	status: BackupRecord['status'];
	trigger: BackupRecord['trigger'];
	createdAt: string;
	completedAt: string | null;
	validatedAt: string | null;
	appVersion: string | null;
	schemaVersion: string | null;
	sizeBytes: number | null;
	validationStatus: BackupRecord['validationStatus'];
	errorCode: string | null;
	protected: boolean;
	isManual: boolean;
	isSafety: boolean;
	canExport: boolean;
}

export interface ReconcileBackupInventoryOptions {
	/** Re-hash known valid bundles too. Explicit validation normally owns that cost. */
	validateExisting?: boolean;
}

function manifestRecord(manifest: BackupManifestV1): Record<string, unknown> {
	return manifest as unknown as Record<string, unknown>;
}

function firstIssue(result: BackupBundleValidation): BackupValidationIssueCode | null {
	return result.issues.find((issue) => issue !== 'permissions_warning') ?? result.issues[0] ?? null;
}

function toInventoryItem(record: BackupRecord): BackupInventoryItem {
	return {
		id: record.id,
		bundleName: record.bundleName,
		status: record.status,
		trigger: record.trigger,
		createdAt: record.createdAt.toISOString(),
		completedAt: record.completedAt?.toISOString() ?? null,
		validatedAt: record.validatedAt?.toISOString() ?? null,
		appVersion: record.appVersion,
		schemaVersion: record.schemaVersion,
		sizeBytes: record.sizeBytes,
		validationStatus: record.validationStatus,
		errorCode: record.errorCode,
		protected: record.protected,
		isManual: record.trigger === 'manual',
		isSafety: record.trigger === 'pre_restore',
		canExport:
			record.status === 'completed' &&
			(record.validationStatus === 'valid' || record.validationStatus === 'warning')
	};
}

export function resolveManagedBundlePath(dataPaths: DataPaths, bundleName: string): string {
	if (!SAFE_BUNDLE_NAME.test(bundleName)) {
		throw new BackupServiceError('backup_not_found', 404);
	}
	return join(dataPaths.backupsDirectory, bundleName);
}

async function persistValidation(
	context: BackupInventoryContext,
	record: BackupRecord,
	result: BackupBundleValidation
): Promise<void> {
	const errorCode = firstIssue(result);
	if (result.status === 'invalid' || !result.manifest || !result.manifestChecksum) {
		await context.database
			.update(backupRecords)
			.set({
				status: 'invalid',
				validationStatus: 'invalid',
				validatedAt: result.validatedAt,
				errorCode,
				error: null
			})
			.where(eq(backupRecords.id, record.id));
		return;
	}

	const manifest = result.manifest;
	await context.database
		.update(backupRecords)
		.set({
			status: 'completed',
			trigger: manifest.trigger,
			manifest: manifestRecord(manifest),
			appVersion: manifest.appVersion,
			schemaVersion: manifest.schemaVersion,
			keyMode: manifest.key.mode,
			keyFingerprint: manifest.key.fingerprint,
			sizeBytes: result.sizeBytes,
			checksum: result.manifestChecksum,
			protected: record.protected || manifest.trigger !== 'scheduled',
			validationStatus: result.status,
			validatedAt: result.validatedAt,
			errorCode,
			error: null,
			completedAt: record.completedAt ?? result.validatedAt
		})
		.where(eq(backupRecords.id, record.id));
}

async function insertDiscoveredBackup(
	context: BackupInventoryContext,
	bundleName: string,
	result: BackupBundleValidation
): Promise<boolean> {
	const manifest = result.manifest;
	if (
		result.status === 'invalid' ||
		!manifest ||
		!result.manifestChecksum ||
		result.sizeBytes === null
	) {
		return false;
	}

	const idCollision = (
		await context.database
			.select({ id: backupRecords.id })
			.from(backupRecords)
			.where(eq(backupRecords.id, manifest.backupId))
			.limit(1)
	)[0];
	if (idCollision) return false;

	const createdAt = new Date(manifest.createdAt);
	await context.database
		.insert(backupRecords)
		.values({
			id: manifest.backupId,
			trigger: manifest.trigger,
			status: 'completed',
			bundleName,
			storagePath: resolveManagedBundlePath(context.dataPaths, bundleName),
			manifest: manifestRecord(manifest),
			appVersion: manifest.appVersion,
			schemaVersion: manifest.schemaVersion,
			keyMode: manifest.key.mode,
			keyFingerprint: manifest.key.fingerprint,
			sizeBytes: result.sizeBytes,
			checksum: result.manifestChecksum,
			protected: manifest.trigger !== 'scheduled',
			validationStatus: result.status,
			errorCode: firstIssue(result),
			error: null,
			createdAt,
			completedAt: createdAt,
			validatedAt: result.validatedAt
		})
		.onConflictDoNothing();
	return true;
}

async function markMissing(
	context: BackupInventoryContext,
	record: BackupRecord,
	validatedAt: Date
): Promise<void> {
	// A live creator persists its row before publication; never race that brief window.
	if (record.status === 'failed' || record.status === 'creating') return;
	await context.database
		.update(backupRecords)
		.set({
			status: 'invalid',
			validationStatus: 'invalid',
			validatedAt,
			errorCode: 'bundle_missing',
			error: null
		})
		.where(eq(backupRecords.id, record.id));
}

/**
 * Reconcile the owner-controlled bundle directory with persisted inventory.
 * Only structurally valid orphan bundles are adopted; arbitrary directories are ignored.
 */
export async function reconcileBackupInventory(
	context: BackupInventoryContext,
	options: ReconcileBackupInventoryOptions = {}
): Promise<void> {
	await mkdir(context.dataPaths.backupsDirectory, { recursive: true, mode: 0o700 });
	await chmod(context.dataPaths.backupsDirectory, 0o700);
	const records = await context.database
		.select()
		.from(backupRecords)
		.where(ne(backupRecords.status, 'deleted'));
	const byBundleName = new Map(records.map((record) => [record.bundleName, record]));
	const discovered = new Set<string>();

	for (const entry of await readdir(context.dataPaths.backupsDirectory, { withFileTypes: true })) {
		if (entry.name.startsWith('.') || !entry.isDirectory() || !SAFE_BUNDLE_NAME.test(entry.name)) {
			continue;
		}
		discovered.add(entry.name);
		const existing = byBundleName.get(entry.name);
		const shouldValidate =
			!existing ||
			options.validateExisting === true ||
			existing.validationStatus === 'unknown' ||
			existing.status === 'creating' ||
			existing.status === 'failed';
		if (!shouldValidate) continue;

		const result = await validateBackupBundle(
			resolveManagedBundlePath(context.dataPaths, entry.name),
			existing
				? {
						expectedBackupId: existing.id,
						expectedManifestChecksum: existing.checksum
					}
				: undefined
		);
		if (existing) await persistValidation(context, existing, result);
		else await insertDiscoveredBackup(context, entry.name, result);
	}

	const checkedAt = new Date();
	for (const record of records) {
		if (!discovered.has(record.bundleName)) await markMissing(context, record, checkedAt);
	}
}

export async function listBackupInventory(
	context: BackupInventoryContext
): Promise<BackupInventoryItem[]> {
	try {
		await reconcileBackupInventory(context);
		const records = await context.database
			.select()
			.from(backupRecords)
			.where(ne(backupRecords.status, 'deleted'))
			.orderBy(desc(backupRecords.createdAt));
		return records.map(toInventoryItem);
	} catch (error) {
		if (error instanceof BackupServiceError) throw error;
		throw new BackupServiceError('backup_inventory_failed', 500, { cause: error });
	}
}

export async function findBackupRecord(
	context: BackupInventoryContext,
	id: string
): Promise<BackupRecord> {
	const record = (
		await context.database.select().from(backupRecords).where(eq(backupRecords.id, id)).limit(1)
	)[0];
	if (!record || record.status === 'deleted') {
		throw new BackupServiceError('backup_not_found', 404);
	}
	return record;
}

export async function validateBackupRecord(
	context: BackupInventoryContext,
	id: string
): Promise<{ item: BackupInventoryItem; result: BackupBundleValidation }> {
	const record = await findBackupRecord(context, id);
	const result = await validateBackupBundle(
		resolveManagedBundlePath(context.dataPaths, record.bundleName),
		{
			expectedBackupId: record.id,
			expectedManifestChecksum: record.checksum
		}
	);
	await persistValidation(context, record, result);
	const refreshed = await findBackupRecord(context, id);
	return { item: toInventoryItem(refreshed), result };
}

export function isValidatedStatus(
	status: BackupValidationStatus | BackupRecord['validationStatus']
): boolean {
	return status === 'valid' || status === 'warning';
}
