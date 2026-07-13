import { constants } from 'node:fs';
import { access, lstat, stat, statfs } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createClient, type Client, type Row } from '@libsql/client';
import type { DataPaths } from '$lib/server/data-paths';
import { inspectScopeIntegrity } from '$lib/server/db/scope-integrity';
import { decryptSecret, isEncrypted } from '$lib/server/secrets/crypto';
import type { BackupManifestExternalPath } from './manifest';

const MIB = 1024 * 1024;

export interface AppliedMigration {
	createdAt: number;
	hash: string;
}

export type DatabaseInspectionStatus =
	| 'ok'
	| 'integrity_failed'
	| 'unreadable'
	| 'schema_metadata_missing';

export type SecretInspectionStatus = 'not_present' | 'valid' | 'key_missing' | 'invalid';

export interface RestoreDatabaseInspection {
	status: DatabaseInspectionStatus;
	appliedMigrations: AppliedMigration[];
	encryptedSecretCount: number;
	secretStatus: SecretInspectionStatus;
}

export type RestorePathTarget =
	| 'database'
	| 'application_key'
	| 'restore_staging'
	| 'backup_storage';

export type RestorePathStatus = 'writable' | 'unwritable' | 'not_applicable';

export interface RestoreStorageInspection {
	paths: Record<RestorePathTarget, RestorePathStatus>;
	requiredBytes: number;
	spaceStatus: 'sufficient' | 'insufficient' | 'unavailable';
}

export type ExternalPathStatus = 'ready' | 'missing' | 'wrong_type' | 'unreadable' | 'unwritable';

export interface ExternalPathInspection {
	kind: BackupManifestExternalPath['kind'];
	expectedType: BackupManifestExternalPath['expectedType'];
	recordedReachable: boolean;
	currentStatus: ExternalPathStatus;
}

function rowValue(row: Row | undefined, name: string, index: number): unknown {
	return row?.[name] ?? row?.[index];
}

function safeInteger(value: unknown): number | null {
	if (typeof value === 'bigint') {
		const number = Number(value);
		return Number.isSafeInteger(number) ? number : null;
	}
	if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
	if (typeof value === 'string' && /^\d+$/.test(value)) {
		const number = Number(value);
		return Number.isSafeInteger(number) ? number : null;
	}
	return null;
}

async function tableNames(client: Client): Promise<Set<string>> {
	const result = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table'");
	return new Set(
		result.rows
			.map((row) => rowValue(row, 'name', 0))
			.filter((name): name is string => typeof name === 'string')
	);
}

async function encryptedValues(client: Client): Promise<string[]> {
	const tables = await tableNames(client);
	const values: string[] = [];
	if (tables.has('settings')) {
		const settings = await client.execute('SELECT value FROM settings');
		for (const row of settings.rows) {
			const value = rowValue(row, 'value', 0);
			if (typeof value === 'string' && isEncrypted(value)) values.push(value);
		}
	}
	if (tables.has('server_instances')) {
		const columns = await client.execute('PRAGMA table_info(server_instances)');
		const hasCredential = columns.rows.some((row) => rowValue(row, 'name', 1) === 'credential');
		if (hasCredential) {
			const servers = await client.execute(
				'SELECT credential FROM server_instances WHERE credential IS NOT NULL'
			);
			for (const row of servers.rows) {
				const value = rowValue(row, 'credential', 0);
				if (typeof value === 'string' && isEncrypted(value)) values.push(value);
			}
		}
	}
	return values;
}

/** Open the snapshot in query-only mode and inspect integrity, migration history, and secrets. */
export async function inspectRestoreDatabase(
	databasePath: string,
	key: Uint8Array | null
): Promise<RestoreDatabaseInspection> {
	let client: Client;
	try {
		client = createClient({ url: `file:${databasePath}` });
		await client.execute('PRAGMA query_only = ON');
	} catch {
		return {
			status: 'unreadable',
			appliedMigrations: [],
			encryptedSecretCount: 0,
			secretStatus: 'not_present'
		};
	}

	try {
		let integrity;
		try {
			integrity = await client.execute('PRAGMA integrity_check(1)');
		} catch {
			return {
				status: 'integrity_failed',
				appliedMigrations: [],
				encryptedSecretCount: 0,
				secretStatus: 'not_present'
			};
		}
		if (rowValue(integrity.rows[0], 'integrity_check', 0) !== 'ok') {
			return {
				status: 'integrity_failed',
				appliedMigrations: [],
				encryptedSecretCount: 0,
				secretStatus: 'not_present'
			};
		}
		try {
			const foreignKeys = await client.execute('PRAGMA foreign_key_check');
			if (foreignKeys.rows.length > 0 || !(await inspectScopeIntegrity(client)).ok) {
				return {
					status: 'integrity_failed',
					appliedMigrations: [],
					encryptedSecretCount: 0,
					secretStatus: 'not_present'
				};
			}
		} catch {
			return {
				status: 'integrity_failed',
				appliedMigrations: [],
				encryptedSecretCount: 0,
				secretStatus: 'not_present'
			};
		}

		let appliedMigrations: AppliedMigration[];
		try {
			const result = await client.execute(
				'SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at, id'
			);
			appliedMigrations = result.rows.map((row) => {
				const hash = rowValue(row, 'hash', 0);
				const createdAt = safeInteger(rowValue(row, 'created_at', 1));
				if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash) || createdAt === null) {
					throw new Error('invalid migration metadata');
				}
				return { hash, createdAt };
			});
			if (appliedMigrations.length === 0) throw new Error('empty migration history');
			for (let index = 1; index < appliedMigrations.length; index++) {
				if (appliedMigrations[index]!.createdAt <= appliedMigrations[index - 1]!.createdAt) {
					throw new Error('migration history is not strictly ordered');
				}
			}
		} catch {
			return {
				status: 'schema_metadata_missing',
				appliedMigrations: [],
				encryptedSecretCount: 0,
				secretStatus: 'not_present'
			};
		}

		let secrets: string[];
		try {
			secrets = await encryptedValues(client);
		} catch {
			return {
				status: 'schema_metadata_missing',
				appliedMigrations,
				encryptedSecretCount: 0,
				secretStatus: 'not_present'
			};
		}
		if (secrets.length === 0) {
			return {
				status: 'ok',
				appliedMigrations,
				encryptedSecretCount: 0,
				secretStatus: 'not_present'
			};
		}
		if (!key || key.byteLength !== 32) {
			return {
				status: 'ok',
				appliedMigrations,
				encryptedSecretCount: secrets.length,
				secretStatus: 'key_missing'
			};
		}
		try {
			const buffer = Buffer.from(key);
			for (const value of secrets) decryptSecret(value, buffer);
			return {
				status: 'ok',
				appliedMigrations,
				encryptedSecretCount: secrets.length,
				secretStatus: 'valid'
			};
		} catch {
			return {
				status: 'ok',
				appliedMigrations,
				encryptedSecretCount: secrets.length,
				secretStatus: 'invalid'
			};
		}
	} finally {
		client.close();
	}
}

async function canAccess(path: string, mode: number): Promise<boolean> {
	try {
		await access(path, mode);
		return true;
	} catch {
		return false;
	}
}

async function atomicTargetWritable(path: string): Promise<boolean> {
	if (!(await canAccess(dirname(path), constants.W_OK | constants.X_OK))) return false;
	try {
		await lstat(path);
		return canAccess(path, constants.R_OK | constants.W_OK);
	} catch {
		return true;
	}
}

function numeric(value: number | bigint): number | null {
	const converted = typeof value === 'bigint' ? Number(value) : value;
	return Number.isFinite(converted) && converted >= 0 ? converted : null;
}

/** Read-only target readiness and conservative restore/safety/rollback space estimate. */
export async function inspectRestoreStorage(
	dataPaths: DataPaths,
	backupDatabaseBytes: number,
	includedPayloadBytes: number,
	includeApplicationKey: boolean
): Promise<RestoreStorageInspection> {
	const paths: Record<RestorePathTarget, RestorePathStatus> = {
		database: 'unwritable',
		application_key: includeApplicationKey ? 'unwritable' : 'not_applicable',
		restore_staging: 'unwritable',
		backup_storage: 'unwritable'
	};
	let currentDatabaseBytes = 0;
	if (dataPaths.databaseFile) {
		paths.database = (await atomicTargetWritable(dataPaths.databaseFile))
			? 'writable'
			: 'unwritable';
		try {
			const current = await stat(dataPaths.databaseFile);
			if (current.isFile()) currentDatabaseBytes = current.size;
		} catch {
			// The path check above reports the unavailable target.
		}
	}
	if (includeApplicationKey) {
		paths.application_key = (await atomicTargetWritable(dataPaths.appKeyFile))
			? 'writable'
			: 'unwritable';
	}
	paths.restore_staging = (await canAccess(
		dataPaths.dataDirectory,
		constants.W_OK | constants.X_OK
	))
		? 'writable'
		: 'unwritable';
	paths.backup_storage = (await canAccess(
		dataPaths.backupsDirectory,
		constants.W_OK | constants.X_OK
	))
		? 'writable'
		: 'unwritable';

	const rawRequired = backupDatabaseBytes + includedPayloadBytes + currentDatabaseBytes * 2 + MIB;
	const requiredBytes = Math.ceil(rawRequired / MIB) * MIB;
	let spaceStatus: RestoreStorageInspection['spaceStatus'] = 'unavailable';
	if (dataPaths.databaseFile) {
		try {
			const filesystem = await statfs(dirname(dataPaths.databaseFile));
			const blockSize = numeric(filesystem.bsize);
			const availableBlocks = numeric(filesystem.bavail);
			if (blockSize !== null && availableBlocks !== null) {
				spaceStatus = availableBlocks * blockSize >= requiredBytes ? 'sufficient' : 'insufficient';
			}
		} catch {
			// Reported as unavailable; no path or OS detail leaves the server.
		}
	}
	return { paths, requiredBytes, spaceStatus };
}

export async function inspectExternalPaths(
	paths: BackupManifestExternalPath[]
): Promise<ExternalPathInspection[]> {
	return Promise.all(
		paths.map(async (path): Promise<ExternalPathInspection> => {
			let info;
			try {
				info = await lstat(path.path);
			} catch {
				return {
					kind: path.kind,
					expectedType: path.expectedType,
					recordedReachable: path.reachable,
					currentStatus: 'missing'
				};
			}
			const correctType = path.expectedType === 'file' ? info.isFile() : info.isDirectory();
			if (!correctType) {
				return {
					kind: path.kind,
					expectedType: path.expectedType,
					recordedReachable: path.reachable,
					currentStatus: 'wrong_type'
				};
			}
			if (!(await canAccess(path.path, constants.R_OK))) {
				return {
					kind: path.kind,
					expectedType: path.expectedType,
					recordedReachable: path.reachable,
					currentStatus: 'unreadable'
				};
			}
			if (!(await canAccess(path.path, constants.W_OK))) {
				return {
					kind: path.kind,
					expectedType: path.expectedType,
					recordedReachable: path.reachable,
					currentStatus: 'unwritable'
				};
			}
			return {
				kind: path.kind,
				expectedType: path.expectedType,
				recordedReachable: path.reachable,
				currentStatus: 'ready'
			};
		})
	);
}
