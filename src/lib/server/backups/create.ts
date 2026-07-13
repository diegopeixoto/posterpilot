import { createHash, randomUUID } from 'node:crypto';
import {
	chmodSync,
	closeSync,
	copyFileSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
	readSync,
	renameSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createClient, type Client, type ResultSet, type Row } from '@libsql/client';
import { pathIsWithin, type DataPaths } from '$lib/server/data-paths';
import {
	backupBundleName,
	buildBackupManifest,
	fingerprintEncryptionKey,
	serializeBackupManifest,
	sha256Bytes,
	type BackupKeyMode,
	type BackupManifestExternalPath,
	type BackupManifestFile,
	type BackupManifestV1,
	type BackupTrigger
} from './manifest';

const DATABASE_FILE = 'posterpilot.db';
const KEY_FILE = '.app-key';
const MANIFEST_FILE = 'manifest.json';
const COPY_BUFFER_BYTES = 1024 * 1024;
const KEY_BYTES = 32;

export type BackupKeySource =
	| { mode: 'generated'; path: string }
	| { mode: 'environment'; key: Uint8Array }
	| { mode: 'none' };

export interface ExternalBackupPathInput {
	kind: BackupManifestExternalPath['kind'];
	path: string;
	expectedType: BackupManifestExternalPath['expectedType'];
}

export interface BackupRecordBase {
	id: string;
	trigger: BackupTrigger;
	bundleName: string;
	storagePath: string;
	protected: boolean;
	createdAt: Date;
}

export interface BackupRecordCompleted {
	id: string;
	manifest: BackupManifestV1;
	appVersion: string;
	schemaVersion: string;
	keyMode: BackupKeyMode;
	keyFingerprint: string | null;
	sizeBytes: number;
	checksum: string;
	completedAt: Date;
}

export interface BackupRecordFailed extends BackupRecordBase {
	errorCode: BackupFailureCode;
	error: string;
	completedAt: Date;
}

export interface BackupRecordStore {
	markCreating(record: BackupRecordBase): Promise<void>;
	markCompleted(record: BackupRecordCompleted): Promise<void>;
	markFailed(record: BackupRecordFailed, recordExists: boolean): Promise<void>;
}

export type BackupFailureCode =
	| 'storage_failed'
	| 'snapshot_failed'
	| 'key_failed'
	| 'manifest_failed'
	| 'publish_failed'
	| 'record_failed';

export interface CreateBackupBundleOptions {
	dataPaths: DataPaths;
	databaseClient: Pick<Client, 'execute'>;
	recordStore: BackupRecordStore;
	appVersion: string;
	trigger: BackupTrigger;
	keySource: BackupKeySource;
	externalPaths?: ExternalBackupPathInput[];
	protected?: boolean;
	backupId?: string;
	createdAt?: Date;
}

export interface CreatedBackupBundle {
	id: string;
	bundleName: string;
	storagePath: string;
	manifest: BackupManifestV1;
	manifestChecksum: string;
	sizeBytes: number;
	completedAt: Date;
}

type BackupStage = 'storage' | 'snapshot' | 'key' | 'manifest' | 'publish' | 'record';

let backupChain: Promise<void> = Promise.resolve();

function withBackupLock<T>(operation: () => Promise<T>): Promise<T> {
	const run = backupChain.then(operation, operation);
	backupChain = run.then(
		() => undefined,
		() => undefined
	);
	return run;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function failureCode(stage: BackupStage): BackupFailureCode {
	switch (stage) {
		case 'snapshot':
			return 'snapshot_failed';
		case 'key':
			return 'key_failed';
		case 'manifest':
			return 'manifest_failed';
		case 'publish':
			return 'publish_failed';
		case 'record':
			return 'record_failed';
		default:
			return 'storage_failed';
	}
}

function sanitizedFailure(code: BackupFailureCode): string {
	return `Backup creation failed (${code}).`;
}

function removeFile(path: string): void {
	try {
		unlinkSync(path);
	} catch (error) {
		if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
	}
}

function sha256File(path: string): string {
	const hash = createHash('sha256');
	const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
	const fd = openSync(path, 'r');
	try {
		let bytesRead: number;
		do {
			bytesRead = readSync(fd, buffer, 0, buffer.length, null);
			if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
		} while (bytesRead > 0);
	} finally {
		closeSync(fd);
	}
	return hash.digest('hex');
}

function syncFile(path: string): void {
	const fd = openSync(path, 'r');
	try {
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}

function rowNumber(row: Row | undefined, name: string, index: number): number {
	const value = row?.[name] ?? row?.[index];
	if (typeof value === 'bigint') return Number(value);
	if (typeof value === 'number') return value;
	if (typeof value === 'string') return Number(value);
	return Number.NaN;
}

/**
 * Build a live-safe SQLite copy. `VACUUM INTO` owns the consistency boundary;
 * checkpointing is only a retry path and is never followed by a raw file copy.
 */
async function createConsistentSqliteSnapshot(
	databaseClient: Pick<Client, 'execute'>,
	destination: string
): Promise<{ checkpointFallback: boolean }> {
	removeFile(destination);
	try {
		await databaseClient.execute({ sql: 'VACUUM INTO ?', args: [destination] });
		return { checkpointFallback: false };
	} catch (vacuumError) {
		removeFile(destination);
		let checkpoint: ResultSet;
		try {
			checkpoint = await databaseClient.execute('PRAGMA wal_checkpoint(FULL)');
		} catch (checkpointError) {
			throw new Error('SQLite WAL checkpoint failed before snapshot retry', {
				cause: checkpointError
			});
		}
		const busy = rowNumber(checkpoint.rows[0], 'busy', 0);
		if (!Number.isFinite(busy) || busy !== 0) {
			throw new Error('SQLite WAL checkpoint remained busy; no snapshot was published', {
				cause: vacuumError
			});
		}
		await databaseClient.execute({ sql: 'VACUUM INTO ?', args: [destination] });
		return { checkpointFallback: true };
	}
}

async function inspectSnapshot(path: string): Promise<{ schemaVersion: string }> {
	const client = createClient({ url: `file:${path}` });
	try {
		const check = await client.execute('PRAGMA quick_check');
		const checkValue = check.rows[0]?.quick_check ?? check.rows[0]?.[0];
		if (checkValue !== 'ok') throw new Error('SQLite snapshot quick_check failed');
		const migrations = await client.execute(
			'SELECT max(created_at) AS schema_version FROM __drizzle_migrations'
		);
		const value = migrations.rows[0]?.schema_version ?? migrations.rows[0]?.[0];
		if (value === null || value === undefined) {
			throw new Error('SQLite snapshot has no migration version');
		}
		return { schemaVersion: String(value) };
	} finally {
		client.close();
	}
}

function externalPathManifest(inputs: ExternalBackupPathInput[]): BackupManifestExternalPath[] {
	return inputs
		.filter((input) => input.path !== '')
		.map((input) => {
			let reachable = false;
			try {
				const stat = statSync(input.path);
				reachable = input.expectedType === 'file' ? stat.isFile() : stat.isDirectory();
			} catch {
				// Recorded as unreachable; backup creation does not depend on external content.
			}
			return { ...input, reachable };
		});
}

function prepareKey(
	keySource: BackupKeySource,
	bundleDirectory: string
): { mode: BackupKeyMode; fingerprint: string | null; file: BackupManifestFile | null } {
	if (keySource.mode === 'none') return { mode: 'none', fingerprint: null, file: null };
	if (keySource.mode === 'environment') {
		if (keySource.key.byteLength !== KEY_BYTES) {
			throw new Error(`environment encryption key must contain ${KEY_BYTES} bytes`);
		}
		return {
			mode: 'environment',
			fingerprint: fingerprintEncryptionKey(keySource.key),
			file: null
		};
	}

	const sourceStat = statSync(keySource.path);
	if (!sourceStat.isFile() || sourceStat.size !== KEY_BYTES) {
		throw new Error(`generated application key must be a ${KEY_BYTES}-byte file`);
	}
	const key = readFileSync(keySource.path);
	const destination = join(bundleDirectory, KEY_FILE);
	copyFileSync(keySource.path, destination);
	chmodSync(destination, 0o600);
	syncFile(destination);
	const sha256 = sha256File(destination);
	if (sha256 !== sha256Bytes(key))
		throw new Error('copied application key checksum does not match');
	return {
		mode: 'generated',
		fingerprint: fingerprintEncryptionKey(key),
		file: { path: KEY_FILE, role: 'application_key', sizeBytes: key.byteLength, sha256 }
	};
}

function writeManifestAtomic(
	directory: string,
	manifest: BackupManifestV1
): {
	text: string;
	checksum: string;
	sizeBytes: number;
} {
	const path = join(directory, MANIFEST_FILE);
	const temporary = `${path}.tmp`;
	const text = serializeBackupManifest(manifest);
	writeFileSync(temporary, text, { mode: 0o600 });
	syncFile(temporary);
	renameSync(temporary, path);
	const checksum = sha256Bytes(text);
	if (sha256File(path) !== checksum)
		throw new Error('persisted backup manifest checksum does not match');
	return {
		text,
		checksum,
		sizeBytes: Buffer.byteLength(text)
	};
}

function verifyPayload(directory: string, files: BackupManifestFile[]): void {
	for (const file of files) {
		const path = resolve(directory, file.path);
		if (!pathIsWithin(directory, path) || basename(path) !== file.path) {
			throw new Error('backup manifest contains an unsafe payload path');
		}
		const stat = statSync(path);
		if (!stat.isFile() || stat.size !== file.sizeBytes || sha256File(path) !== file.sha256) {
			throw new Error(`backup payload verification failed for ${file.role}`);
		}
	}
}

/**
 * Preview plans and HTTP/image caches are reproducible, short-lived state and may
 * contain credential-derived request material. Remove them from the copied SQLite
 * file (never the live database), securely compact it, then build checksums.
 */
async function scrubEphemeralSnapshot(databasePath: string): Promise<void> {
	const snapshot = createClient({ url: `file:${databasePath}` });
	try {
		const result = await snapshot.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('http_cache', 'thumbnail_cache', 'operation_plans')"
		);
		const tables = new Set(result.rows.map((row) => String(row.name)));
		await snapshot.execute('PRAGMA foreign_keys=ON');
		await snapshot.execute('PRAGMA secure_delete=ON');
		for (const table of ['http_cache', 'thumbnail_cache', 'operation_plans']) {
			if (tables.has(table)) await snapshot.execute(`DELETE FROM ${table}`);
		}
		if (tables.size > 0) await snapshot.execute('VACUUM');
		const foreignKeys = await snapshot.execute('PRAGMA foreign_key_check');
		if (foreignKeys.rows.length > 0) {
			throw new Error('Scrubbed SQLite snapshot has foreign-key violations');
		}
	} finally {
		snapshot.close();
	}
}

async function createBackupBundleUnlocked(
	options: CreateBackupBundleOptions
): Promise<CreatedBackupBundle> {
	const createdAt = options.createdAt ?? new Date();
	const id = options.backupId ?? randomUUID();
	const bundleName = backupBundleName(createdAt, id);
	const storagePath = join(options.dataPaths.backupsDirectory, bundleName);
	const temporaryPath = join(options.dataPaths.backupsDirectory, `.${bundleName}.tmp`);
	const protectedBackup = options.protected ?? options.trigger !== 'scheduled';
	const recordBase: BackupRecordBase = {
		id,
		trigger: options.trigger,
		bundleName,
		storagePath,
		protected: protectedBackup,
		createdAt
	};
	let stage: BackupStage = 'storage';
	let temporaryCreated = false;
	let published = false;
	let recordExists = false;

	try {
		if (!options.dataPaths.databaseFile) {
			throw new Error('application backups require a local file: SQLite database');
		}
		mkdirSync(options.dataPaths.backupsDirectory, { recursive: true, mode: 0o700 });
		chmodSync(options.dataPaths.backupsDirectory, 0o700);
		if (existsSync(storagePath) || existsSync(temporaryPath)) {
			throw new Error('backup bundle name already exists');
		}
		mkdirSync(temporaryPath, { mode: 0o700 });
		temporaryCreated = true;

		stage = 'snapshot';
		const databasePath = join(temporaryPath, DATABASE_FILE);
		const snapshot = await createConsistentSqliteSnapshot(options.databaseClient, databasePath);
		await scrubEphemeralSnapshot(databasePath);
		chmodSync(databasePath, 0o600);
		syncFile(databasePath);
		const inspection = await inspectSnapshot(databasePath);
		const databaseStat = statSync(databasePath);
		const files: BackupManifestFile[] = [
			{
				path: DATABASE_FILE,
				role: 'database',
				sizeBytes: databaseStat.size,
				sha256: sha256File(databasePath)
			}
		];

		// The inventory row is intentionally created after the SQLite snapshot so a
		// restored database never contains a permanently in-flight record for itself.
		stage = 'record';
		await options.recordStore.markCreating(recordBase);
		recordExists = true;

		stage = 'key';
		const key = prepareKey(options.keySource, temporaryPath);
		if (key.file) files.push(key.file);

		stage = 'manifest';
		const manifest = buildBackupManifest({
			backupId: id,
			trigger: options.trigger,
			createdAt: createdAt.toISOString(),
			appVersion: options.appVersion,
			schemaVersion: inspection.schemaVersion,
			snapshot: {
				method: 'vacuum_into',
				checkpointFallback: snapshot.checkpointFallback
			},
			key: {
				mode: key.mode,
				fingerprint: key.fingerprint,
				included: key.file !== null
			},
			files,
			externalPaths: externalPathManifest(options.externalPaths ?? [])
		});
		verifyPayload(temporaryPath, manifest.files);
		const persistedManifest = writeManifestAtomic(temporaryPath, manifest);
		const sizeBytes =
			manifest.files.reduce((total, file) => total + file.sizeBytes, 0) +
			persistedManifest.sizeBytes;

		stage = 'publish';
		renameSync(temporaryPath, storagePath);
		temporaryCreated = false;
		published = true;
		chmodSync(storagePath, 0o700);

		stage = 'record';
		const completedAt = new Date();
		await options.recordStore.markCompleted({
			id,
			manifest,
			appVersion: options.appVersion,
			schemaVersion: inspection.schemaVersion,
			keyMode: key.mode,
			keyFingerprint: key.fingerprint,
			sizeBytes,
			checksum: persistedManifest.checksum,
			completedAt
		});

		return {
			id,
			bundleName,
			storagePath,
			manifest,
			manifestChecksum: persistedManifest.checksum,
			sizeBytes,
			completedAt
		};
	} catch (error) {
		const cleanupErrors: unknown[] = [];
		if (temporaryCreated) {
			try {
				rmSync(temporaryPath, { recursive: true, force: true });
			} catch (cleanupError) {
				cleanupErrors.push(cleanupError);
			}
		}
		if (published) {
			try {
				rmSync(storagePath, { recursive: true, force: true });
			} catch (cleanupError) {
				cleanupErrors.push(cleanupError);
			}
		}
		const code = failureCode(stage);
		try {
			await options.recordStore.markFailed(
				{
					...recordBase,
					errorCode: code,
					error: sanitizedFailure(code),
					completedAt: new Date()
				},
				recordExists
			);
		} catch (recordError) {
			throw new Error(
				`backup failed (${errorMessage(error)}), cleanup errors: ${cleanupErrors.length}, and its failed record could not be persisted`,
				{ cause: recordError }
			);
		}
		if (cleanupErrors.length > 0) {
			throw new Error(
				`backup failed (${errorMessage(error)}) and cleanup was incomplete (${cleanupErrors.length} errors)`,
				{ cause: error }
			);
		}
		throw error;
	}
}

/** Serialize bundle publication while allowing normal database reads/writes. */
export function createBackupBundle(
	options: CreateBackupBundleOptions
): Promise<CreatedBackupBundle> {
	return withBackupLock(() => createBackupBundleUnlocked(options));
}
