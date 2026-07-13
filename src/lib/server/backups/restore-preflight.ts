import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DataPaths } from '$lib/server/data-paths';
import { hashCanonicalJson } from '$lib/server/plans/canonical-json';
import type {
	CreateOperationPlanInput,
	OperationPlan
} from '$lib/server/plans/operation-plan-store';
import { fingerprintEncryptionKey, type BackupManifestV1 } from './manifest';
import type { BackupBundleValidation } from './validation';
import type { BackupRecord } from './inventory';
import type { SupportedMigration } from './migration-catalog';
import type {
	ExternalPathInspection,
	RestoreDatabaseInspection,
	RestoreStorageInspection
} from './restore-inspection';
import type { RestorePreflightRecordStore } from './restore-records';

export type RestorePreflightBlockingCode =
	| 'bundle_invalid'
	| 'database_unreadable'
	| 'database_integrity_failed'
	| 'schema_metadata_missing'
	| 'schema_manifest_mismatch'
	| 'schema_newer_than_application'
	| 'schema_incompatible'
	| 'key_missing'
	| 'key_mismatch'
	| 'key_mode_incompatible'
	| 'restore_path_unwritable'
	| 'disk_space_insufficient'
	| 'disk_space_unavailable';

export type RestorePreflightWarningCode =
	| 'bundle_permissions'
	| 'external_path_missing'
	| 'external_path_wrong_type'
	| 'external_path_unreadable'
	| 'external_path_unwritable';

export interface RestoreSchemaCompatibility {
	status: 'current' | 'upgrade_required' | 'newer' | 'incompatible';
	backupSchemaVersion: string;
	currentSchemaVersion: string;
	requiredMigrations: Array<{ id: string; createdAt: number }>;
}

export type RestoreKeyCompatibilityStatus =
	| 'compatible'
	| 'not_required'
	| 'missing'
	| 'mismatch'
	| 'mode_incompatible';

export interface RestoreKeyCompatibility {
	status: RestoreKeyCompatibilityStatus;
	key: Uint8Array | null;
}

export interface RestorePreflightWarning {
	code: RestorePreflightWarningCode;
	externalPathKind?: 'kometa_assets' | 'kometa_config' | 'other';
}

export interface RestorePreflightReport {
	version: 1;
	backupId: string;
	manifestChecksum: string | null;
	generatedAt: string;
	restorable: boolean;
	blocking: RestorePreflightBlockingCode[];
	warnings: RestorePreflightWarning[];
	bundle: {
		status: BackupBundleValidation['status'];
		issues: string[];
		appVersion: string | null;
		schemaVersion: string | null;
		createdAt: string | null;
	};
	replacement: {
		database: boolean;
		applicationKey: boolean;
		configurationFiles: number;
	};
	key: {
		mode: BackupManifestV1['key']['mode'] | null;
		status: RestoreKeyCompatibilityStatus | 'not_checked';
		encryptedSecretCount: number;
		secretStatus: RestoreDatabaseInspection['secretStatus'] | 'not_checked';
	};
	database: {
		status: RestoreDatabaseInspection['status'] | 'not_checked';
	};
	schema: RestoreSchemaCompatibility | null;
	storage: RestoreStorageInspection | null;
	externalPaths: ExternalPathInspection[];
}

export interface RestoreConfirmationBinding {
	restoreId: string;
	planId: string;
	digest: string;
	expiresAt: string;
	previewChecksum: string;
}

export interface RestorePreflightResult {
	report: RestorePreflightReport;
	confirmation: RestoreConfirmationBinding | null;
}

export interface RestoreOperationPlanPayload {
	version: 1;
	action: 'application_restore';
	restoreId: string;
	backupId: string;
	bundleName: string;
	manifestChecksum: string;
	previewChecksum: string;
	report: RestorePreflightReport;
}

export interface ValidatedRestoreBackup {
	record: Pick<BackupRecord, 'id' | 'bundleName' | 'checksum'>;
	validation: BackupBundleValidation;
	bundleDirectory: string;
}

export interface RestorePreflightDependencies {
	dataPaths: DataPaths;
	validateBackup(backupId: string): Promise<ValidatedRestoreBackup>;
	resolveKey(bundleDirectory: string, manifest: BackupManifestV1): Promise<RestoreKeyCompatibility>;
	inspectDatabase(path: string, key: Uint8Array | null): Promise<RestoreDatabaseInspection>;
	inspectStorage(
		dataPaths: DataPaths,
		backupDatabaseBytes: number,
		includedPayloadBytes: number,
		includeApplicationKey: boolean
	): Promise<RestoreStorageInspection>;
	inspectExternal(paths: BackupManifestV1['externalPaths']): Promise<ExternalPathInspection[]>;
	loadMigrations(): SupportedMigration[];
	createPlan<T>(input: CreateOperationPlanInput<T>): Promise<OperationPlan<T>>;
	recordStore: Pick<RestorePreflightRecordStore, 'createPreview'>;
	clock?: () => Date;
	generateId?: () => string;
}

export interface CurrentRestoreKey {
	mode: 'environment' | 'generated';
	key: Uint8Array | null;
}

function pushUnique<T>(values: T[], value: T): void {
	if (!values.includes(value)) values.push(value);
}

/** Compare the snapshot's exact applied migration chain with the running catalog. */
export function compareRestoreMigrations(
	manifestSchemaVersion: string,
	applied: RestoreDatabaseInspection['appliedMigrations'],
	supported: SupportedMigration[]
): RestoreSchemaCompatibility {
	if (supported.length === 0) throw new Error('running migration catalog is empty');
	const currentSchemaVersion = String(supported.at(-1)!.createdAt);
	const backupLast = applied.at(-1);
	if (!backupLast || manifestSchemaVersion !== String(backupLast.createdAt)) {
		return {
			status: 'incompatible',
			backupSchemaVersion: manifestSchemaVersion,
			currentSchemaVersion,
			requiredMigrations: []
		};
	}

	for (let index = 0; index < applied.length; index++) {
		const candidate = applied[index]!;
		const known = supported[index];
		if (!known) {
			return {
				status: 'newer',
				backupSchemaVersion: manifestSchemaVersion,
				currentSchemaVersion,
				requiredMigrations: []
			};
		}
		if (known.createdAt !== candidate.createdAt || known.hash !== candidate.hash) {
			return {
				status: candidate.createdAt > supported.at(-1)!.createdAt ? 'newer' : 'incompatible',
				backupSchemaVersion: manifestSchemaVersion,
				currentSchemaVersion,
				requiredMigrations: []
			};
		}
	}

	const requiredMigrations = supported.slice(applied.length).map(({ id, createdAt }) => ({
		id,
		createdAt
	}));
	return {
		status: requiredMigrations.length > 0 ? 'upgrade_required' : 'current',
		backupSchemaVersion: manifestSchemaVersion,
		currentSchemaVersion,
		requiredMigrations
	};
}

/** Resolve the key that will decrypt the restored snapshot without exposing fingerprints. */
export async function resolveRestoreKey(
	bundleDirectory: string,
	manifest: BackupManifestV1,
	current: CurrentRestoreKey
): Promise<RestoreKeyCompatibility> {
	if (manifest.key.mode === 'none') return { status: 'not_required', key: null };
	if (manifest.key.mode === 'environment') {
		if (current.mode !== 'environment' || !current.key) {
			return { status: 'missing', key: null };
		}
		return fingerprintEncryptionKey(current.key) === manifest.key.fingerprint
			? { status: 'compatible', key: current.key }
			: { status: 'mismatch', key: null };
	}
	if (current.mode === 'environment') return { status: 'mode_incompatible', key: null };

	const keyFile = manifest.files.find((file) => file.role === 'application_key');
	if (!keyFile) return { status: 'missing', key: null };
	try {
		const key = await readFile(join(bundleDirectory, keyFile.path));
		if (key.byteLength !== 32) return { status: 'mismatch', key: null };
		return fingerprintEncryptionKey(key) === manifest.key.fingerprint
			? { status: 'compatible', key }
			: { status: 'mismatch', key: null };
	} catch {
		return { status: 'missing', key: null };
	}
}

function blockedReport(
	backupId: string,
	validation: BackupBundleValidation,
	generatedAt: string
): RestorePreflightReport {
	return {
		version: 1,
		backupId,
		manifestChecksum: validation.manifestChecksum,
		generatedAt,
		restorable: false,
		blocking: ['bundle_invalid'],
		warnings: validation.issues.includes('permissions_warning')
			? [{ code: 'bundle_permissions' }]
			: [],
		bundle: {
			status: validation.status,
			issues: validation.issues,
			appVersion: validation.manifest?.appVersion ?? null,
			schemaVersion: validation.manifest?.schemaVersion ?? null,
			createdAt: validation.manifest?.createdAt ?? null
		},
		replacement: { database: false, applicationKey: false, configurationFiles: 0 },
		key: {
			mode: validation.manifest?.key.mode ?? null,
			status: 'not_checked',
			encryptedSecretCount: 0,
			secretStatus: 'not_checked'
		},
		database: { status: 'not_checked' },
		schema: null,
		storage: null,
		externalPaths: []
	};
}

function externalWarnings(inspections: ExternalPathInspection[]): RestorePreflightWarning[] {
	return inspections.flatMap((inspection): RestorePreflightWarning[] => {
		if (inspection.currentStatus === 'ready') return [];
		const code =
			inspection.currentStatus === 'missing'
				? 'external_path_missing'
				: inspection.currentStatus === 'wrong_type'
					? 'external_path_wrong_type'
					: inspection.currentStatus === 'unreadable'
						? 'external_path_unreadable'
						: 'external_path_unwritable';
		return [{ code, externalPathKind: inspection.kind }];
	});
}

/** Compose every read-only check and create a short-lived exact restore confirmation. */
export function createRestorePreflightService(deps: RestorePreflightDependencies) {
	const clock = deps.clock ?? (() => new Date());
	const generateId = deps.generateId ?? randomUUID;

	return {
		async preview(backupId: string): Promise<RestorePreflightResult> {
			const validated = await deps.validateBackup(backupId);
			const generatedAt = clock().toISOString();
			const validation = validated.validation;
			if (validation.status === 'invalid' || !validation.manifest || !validation.manifestChecksum) {
				return { report: blockedReport(backupId, validation, generatedAt), confirmation: null };
			}

			const manifest = validation.manifest;
			const databaseFile = manifest.files.find((file) => file.role === 'database')!;
			const keyCompatibility = await deps.resolveKey(validated.bundleDirectory, manifest);
			const [database, storage, externalPaths] = await Promise.all([
				deps.inspectDatabase(
					join(validated.bundleDirectory, databaseFile.path),
					keyCompatibility.key
				),
				deps.inspectStorage(
					deps.dataPaths,
					databaseFile.sizeBytes,
					manifest.files
						.filter((file) => file.role !== 'database')
						.reduce((total, file) => total + file.sizeBytes, 0),
					manifest.key.included
				),
				deps.inspectExternal(manifest.externalPaths)
			]);

			const blocking: RestorePreflightBlockingCode[] = [];
			const warnings: RestorePreflightWarning[] = [
				...(validation.issues.includes('permissions_warning')
					? ([{ code: 'bundle_permissions' }] as RestorePreflightWarning[])
					: []),
				...externalWarnings(externalPaths)
			];

			if (database.status === 'unreadable') pushUnique(blocking, 'database_unreadable');
			if (database.status === 'integrity_failed') {
				pushUnique(blocking, 'database_integrity_failed');
			}
			if (database.status === 'schema_metadata_missing') {
				pushUnique(blocking, 'schema_metadata_missing');
			}
			if (keyCompatibility.status === 'missing') pushUnique(blocking, 'key_missing');
			if (keyCompatibility.status === 'mismatch') pushUnique(blocking, 'key_mismatch');
			if (keyCompatibility.status === 'mode_incompatible') {
				pushUnique(blocking, 'key_mode_incompatible');
			}
			if (database.secretStatus === 'key_missing') pushUnique(blocking, 'key_missing');
			if (database.secretStatus === 'invalid') pushUnique(blocking, 'key_mismatch');

			let schema: RestoreSchemaCompatibility | null = null;
			if (database.status === 'ok') {
				schema = compareRestoreMigrations(
					manifest.schemaVersion,
					database.appliedMigrations,
					deps.loadMigrations()
				);
				if (
					database.appliedMigrations.at(-1) &&
					manifest.schemaVersion !== String(database.appliedMigrations.at(-1)!.createdAt)
				) {
					pushUnique(blocking, 'schema_manifest_mismatch');
				} else if (schema.status === 'newer') {
					pushUnique(blocking, 'schema_newer_than_application');
				} else if (schema.status === 'incompatible') {
					pushUnique(blocking, 'schema_incompatible');
				}
			}

			if (Object.values(storage.paths).some((status) => status === 'unwritable')) {
				pushUnique(blocking, 'restore_path_unwritable');
			}
			if (storage.spaceStatus === 'insufficient') {
				pushUnique(blocking, 'disk_space_insufficient');
			}
			if (storage.spaceStatus === 'unavailable') {
				pushUnique(blocking, 'disk_space_unavailable');
			}

			const report: RestorePreflightReport = {
				version: 1,
				backupId,
				manifestChecksum: validation.manifestChecksum,
				generatedAt,
				restorable: blocking.length === 0,
				blocking,
				warnings,
				bundle: {
					status: validation.status,
					issues: validation.issues,
					appVersion: manifest.appVersion,
					schemaVersion: manifest.schemaVersion,
					createdAt: manifest.createdAt
				},
				replacement: {
					database: true,
					applicationKey: manifest.key.included,
					configurationFiles: manifest.files.filter((file) => file.role === 'configuration').length
				},
				key: {
					mode: manifest.key.mode,
					status: keyCompatibility.status,
					encryptedSecretCount: database.encryptedSecretCount,
					secretStatus: database.secretStatus
				},
				database: { status: database.status },
				schema,
				storage,
				externalPaths
			};

			if (!report.restorable) return { report, confirmation: null };

			const restoreId = generateId();
			if (!restoreId) throw new Error('restore id generator returned an empty id');
			const previewChecksum = hashCanonicalJson({
				version: 1,
				backupId,
				manifestChecksum: validation.manifestChecksum,
				report
			});
			const payload: RestoreOperationPlanPayload = {
				version: 1,
				action: 'application_restore',
				restoreId,
				backupId,
				bundleName: validated.record.bundleName,
				manifestChecksum: validation.manifestChecksum,
				previewChecksum,
				report
			};
			const plan = await deps.createPlan({ kind: 'application_restore', payload });
			await deps.recordStore.createPreview({
				id: restoreId,
				backupId,
				operationPlanId: plan.id,
				previewChecksum,
				report: report as unknown as Record<string, unknown>,
				createdAt: new Date(generatedAt)
			});

			return {
				report,
				confirmation: {
					restoreId,
					planId: plan.id,
					digest: plan.digest,
					expiresAt: plan.expiresAt.toISOString(),
					previewChecksum
				}
			};
		}
	};
}
