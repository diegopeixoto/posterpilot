import { createHash } from 'node:crypto';
import {
	chmodSync,
	closeSync,
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	readSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	type Stats,
	unlinkSync,
	writeFileSync
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
	pathIsWithin,
	preparedRestorePath,
	resolveStagedPath,
	type DataPaths
} from '$lib/server/data-paths';

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const MAX_MARKER_BYTES = 64 * 1024;
const COPY_BUFFER_BYTES = 1024 * 1024;
const APP_KEY_BYTES = 32;

export interface StagedRestoreFileV1 {
	/** Absolute path, or a path relative to `<data>/restore-staging`. */
	path: string;
	sha256: string;
}

/** Boot marker written only after restore preflight and staging have completed. */
export interface PendingRestoreMarkerV1 {
	version: 1;
	stagedDatabase: StagedRestoreFileV1;
	stagedKey?: StagedRestoreFileV1;
	restore?: PendingRestoreContextV1;
}

export interface PendingRestoreContextV1 {
	restoreId: string;
	backupId: string;
	safetyBackupId: string;
	manifestChecksum: string;
	previewChecksum: string;
	createdAt: string;
}

type RollbackFileState = { existed: false } | { existed: true; sha256: string; mode: number };

interface RestoreRollbackMarkerV1 {
	version: 1;
	pendingMarkerSha256: string;
	databaseTarget: string;
	keyTarget: string | null;
	database: RollbackFileState;
	wal: RollbackFileState;
	shm: RollbackFileState;
	key: RollbackFileState | null;
}

export type PendingRestoreResult =
	| { status: 'none' }
	| { status: 'applied'; rollbackMarker: string; restore?: PendingRestoreContextV1 }
	| { status: 'rejected'; failedMarker: string; error: string; restore?: PendingRestoreContextV1 }
	| {
			status: 'rolled_back';
			failedMarker: string;
			rollbackMarker: string;
			error: string;
			restore?: PendingRestoreContextV1;
	  };

interface ReadPendingMarker {
	marker: PendingRestoreMarkerV1;
	digest: string;
}

interface ValidatedStagedFile {
	path: string;
	sha256: string;
	mode: number;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStagedFile(value: unknown, field: string): StagedRestoreFileV1 {
	if (!isRecord(value) || typeof value.path !== 'string' || value.path.trim() === '') {
		throw new Error(`${field}.path must be a non-empty string`);
	}
	if (typeof value.sha256 !== 'string' || !SHA256_PATTERN.test(value.sha256)) {
		throw new Error(`${field}.sha256 must be a SHA-256 hex digest`);
	}
	return { path: value.path, sha256: value.sha256.toLowerCase() };
}

function parsePendingMarker(value: unknown): PendingRestoreMarkerV1 {
	if (!isRecord(value) || value.version !== 1) {
		throw new Error('restore marker must use version 1');
	}
	const marker: PendingRestoreMarkerV1 = {
		version: 1,
		stagedDatabase: parseStagedFile(value.stagedDatabase, 'stagedDatabase')
	};
	if (value.stagedKey !== undefined) {
		marker.stagedKey = parseStagedFile(value.stagedKey, 'stagedKey');
	}
	if (value.restore !== undefined) marker.restore = parseRestoreContext(value.restore);
	return marker;
}

function parseRestoreContext(value: unknown): PendingRestoreContextV1 {
	if (!isRecord(value)) throw new Error('restore context is invalid');
	const id = /^[A-Za-z0-9-]{1,128}$/;
	if (
		typeof value.restoreId !== 'string' ||
		!id.test(value.restoreId) ||
		typeof value.backupId !== 'string' ||
		!id.test(value.backupId) ||
		typeof value.safetyBackupId !== 'string' ||
		!id.test(value.safetyBackupId) ||
		typeof value.manifestChecksum !== 'string' ||
		!SHA256_PATTERN.test(value.manifestChecksum) ||
		typeof value.previewChecksum !== 'string' ||
		!SHA256_PATTERN.test(value.previewChecksum) ||
		typeof value.createdAt !== 'string' ||
		!Number.isFinite(Date.parse(value.createdAt))
	) {
		throw new Error('restore context is invalid');
	}
	return {
		restoreId: value.restoreId,
		backupId: value.backupId,
		safetyBackupId: value.safetyBackupId,
		manifestChecksum: value.manifestChecksum.toLowerCase(),
		previewChecksum: value.previewChecksum.toLowerCase(),
		createdAt: new Date(value.createdAt).toISOString()
	};
}

function parseRollbackFile(value: unknown, field: string): RollbackFileState {
	if (!isRecord(value) || typeof value.existed !== 'boolean') {
		throw new Error(`${field} rollback state is invalid`);
	}
	if (!value.existed) return { existed: false };
	if (
		typeof value.sha256 !== 'string' ||
		!SHA256_PATTERN.test(value.sha256) ||
		typeof value.mode !== 'number' ||
		!Number.isInteger(value.mode) ||
		value.mode < 0 ||
		value.mode > 0o777
	) {
		throw new Error(`${field} rollback metadata is invalid`);
	}
	return { existed: true, sha256: value.sha256.toLowerCase(), mode: value.mode };
}

function parseRollbackMarker(value: unknown): RestoreRollbackMarkerV1 {
	if (
		!isRecord(value) ||
		value.version !== 1 ||
		typeof value.pendingMarkerSha256 !== 'string' ||
		!SHA256_PATTERN.test(value.pendingMarkerSha256) ||
		typeof value.databaseTarget !== 'string' ||
		(value.keyTarget !== null && typeof value.keyTarget !== 'string')
	) {
		throw new Error('restore rollback marker is invalid');
	}
	return {
		version: 1,
		pendingMarkerSha256: value.pendingMarkerSha256.toLowerCase(),
		databaseTarget: value.databaseTarget,
		keyTarget: value.keyTarget,
		database: parseRollbackFile(value.database, 'database'),
		wal: parseRollbackFile(value.wal, 'wal'),
		shm: parseRollbackFile(value.shm, 'shm'),
		key: value.key === null ? null : parseRollbackFile(value.key, 'key')
	};
}

/** Compute a file digest without loading a potentially large SQLite database into memory. */
export function sha256File(path: string): string {
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

function sha256Bytes(bytes: Buffer): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function assertRegularFile(path: string, field: string): Stats {
	const link = lstatSync(path);
	if (link.isSymbolicLink()) throw new Error(`${field} must not be a symbolic link`);
	const stat = statSync(path);
	if (!stat.isFile()) throw new Error(`${field} must be a regular file`);
	return stat;
}

function readPendingMarker(path: string): ReadPendingMarker {
	const stat = assertRegularFile(path, 'restore marker');
	if (stat.size > MAX_MARKER_BYTES) throw new Error('restore marker is too large');
	const bytes = readFileSync(path);
	let parsed: unknown;
	try {
		parsed = JSON.parse(bytes.toString('utf8'));
	} catch {
		throw new Error('restore marker is not valid JSON');
	}
	return { marker: parsePendingMarker(parsed), digest: sha256Bytes(bytes) };
}

function readRollbackMarker(path: string): RestoreRollbackMarkerV1 {
	const stat = assertRegularFile(path, 'restore rollback marker');
	if (stat.size > MAX_MARKER_BYTES) throw new Error('restore rollback marker is too large');
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, 'utf8'));
	} catch {
		throw new Error('restore rollback marker is not valid JSON');
	}
	return parseRollbackMarker(parsed);
}

function validateStagedFile(
	paths: DataPaths,
	file: StagedRestoreFileV1,
	field: string,
	mode: number,
	expectedBytes?: number
): ValidatedStagedFile {
	const stagingRoot = realpathSync(paths.restore.stagingDirectory);
	const candidate = resolveStagedPath(paths.restore.stagingDirectory, file.path);
	const realCandidate = realpathSync(candidate);
	if (!pathIsWithin(stagingRoot, realCandidate)) {
		throw new Error(`${field} must stay inside the restore staging directory`);
	}
	const stat = assertRegularFile(candidate, field);
	if (expectedBytes !== undefined && stat.size !== expectedBytes) {
		throw new Error(`${field} must contain exactly ${expectedBytes} bytes`);
	}
	const actualSha256 = sha256File(candidate);
	if (actualSha256 !== file.sha256) throw new Error(`${field} checksum does not match`);
	return { path: candidate, sha256: file.sha256, mode };
}

function removeOwnedFile(path: string): void {
	try {
		unlinkSync(path);
	} catch (error) {
		if (!isRecord(error) || error.code !== 'ENOENT') throw error;
	}
}

function copyPrepared(
	source: string,
	target: string,
	expectedSha256: string,
	mode: number
): string {
	const prepared = preparedRestorePath(target);
	mkdirSync(dirname(target), { recursive: true });
	removeOwnedFile(prepared);
	copyFileSync(source, prepared);
	chmodSync(prepared, mode);
	if (sha256File(prepared) !== expectedSha256) {
		removeOwnedFile(prepared);
		throw new Error('prepared restore file checksum does not match');
	}
	return prepared;
}

function copyRollback(source: string, destination: string, label: string): RollbackFileState {
	if (!existsSync(source)) return { existed: false };
	const stat = assertRegularFile(source, label);
	const sha256 = sha256File(source);
	const temporary = `${destination}.tmp`;
	if (existsSync(destination)) throw new Error(`${label} rollback already exists`);
	removeOwnedFile(temporary);
	copyFileSync(source, temporary);
	chmodSync(temporary, 0o600);
	if (sha256File(temporary) !== sha256) {
		removeOwnedFile(temporary);
		throw new Error(`${label} rollback checksum does not match`);
	}
	renameSync(temporary, destination);
	return { existed: true, sha256, mode: stat.mode & 0o777 };
}

function writeRollbackMarker(path: string, marker: RestoreRollbackMarkerV1): void {
	if (existsSync(path)) throw new Error('restore rollback marker already exists');
	const temporary = `${path}.tmp`;
	removeOwnedFile(temporary);
	writeFileSync(temporary, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporary, path);
}

function createRollback(paths: DataPaths, pending: ReadPendingMarker): RestoreRollbackMarkerV1 {
	if (!paths.databaseFile) throw new Error('a local database file is required for restore');
	const entries = existsSync(paths.restore.rollbackDirectory)
		? readdirSync(paths.restore.rollbackDirectory)
		: [];
	if (entries.length > 0) throw new Error('restore rollback safety data already exists');
	mkdirSync(paths.restore.rollbackDirectory, { recursive: true, mode: 0o700 });
	chmodSync(paths.restore.rollbackDirectory, 0o700);

	const databaseTarget = resolve(paths.databaseFile);
	const keyTarget = pending.marker.stagedKey ? resolve(paths.appKeyFile) : null;
	const marker: RestoreRollbackMarkerV1 = {
		version: 1,
		pendingMarkerSha256: pending.digest,
		databaseTarget,
		keyTarget,
		database: copyRollback(paths.databaseFile, paths.restore.rollbackDatabase, 'database'),
		wal: copyRollback(`${paths.databaseFile}-wal`, paths.restore.rollbackWal, 'database WAL'),
		shm: copyRollback(`${paths.databaseFile}-shm`, paths.restore.rollbackShm, 'database SHM'),
		key: pending.marker.stagedKey
			? copyRollback(paths.appKeyFile, paths.restore.rollbackKey, 'application key')
			: null
	};
	writeRollbackMarker(paths.restore.rollbackMarker, marker);
	return marker;
}

function validateRollbackTargets(
	paths: DataPaths,
	pending: ReadPendingMarker,
	rollback: RestoreRollbackMarkerV1
): void {
	if (!paths.databaseFile) throw new Error('a local database file is required for restore');
	if (rollback.pendingMarkerSha256 !== pending.digest) {
		throw new Error('existing rollback data belongs to another restore marker');
	}
	if (rollback.databaseTarget !== resolve(paths.databaseFile)) {
		throw new Error('database target changed after restore began');
	}
	const expectedKeyTarget = pending.marker.stagedKey ? resolve(paths.appKeyFile) : null;
	if (rollback.keyTarget !== expectedKeyTarget) {
		throw new Error('application key target changed after restore began');
	}
	if ((rollback.key === null) !== (expectedKeyTarget === null)) {
		throw new Error('application key rollback state does not match the restore marker');
	}
}

function validateRollbackCopy(state: RollbackFileState, path: string, label: string): void {
	if (!state.existed) return;
	assertRegularFile(path, label);
	if (sha256File(path) !== state.sha256) throw new Error(`${label} checksum does not match`);
}

function verifyRestoredFile(state: RollbackFileState, target: string, label: string): void {
	if (!state.existed) {
		if (existsSync(target)) throw new Error(`${label} should be absent after rollback`);
		return;
	}
	assertRegularFile(target, label);
	if (sha256File(target) !== state.sha256) throw new Error(`${label} rollback verification failed`);
}

function restoreRollback(
	paths: DataPaths,
	pending: ReadPendingMarker,
	rollback: RestoreRollbackMarkerV1
): void {
	if (!paths.databaseFile) throw new Error('a local database file is required for restore');
	validateRollbackTargets(paths, pending, rollback);
	validateRollbackCopy(rollback.database, paths.restore.rollbackDatabase, 'database rollback');
	validateRollbackCopy(rollback.wal, paths.restore.rollbackWal, 'database WAL rollback');
	validateRollbackCopy(rollback.shm, paths.restore.rollbackShm, 'database SHM rollback');
	if (rollback.key) {
		validateRollbackCopy(rollback.key, paths.restore.rollbackKey, 'application key rollback');
	}

	const databasePrepared = rollback.database.existed
		? copyPrepared(
				paths.restore.rollbackDatabase,
				paths.databaseFile,
				rollback.database.sha256,
				rollback.database.mode
			)
		: null;
	const walTarget = `${paths.databaseFile}-wal`;
	const walPrepared = rollback.wal.existed
		? copyPrepared(paths.restore.rollbackWal, walTarget, rollback.wal.sha256, rollback.wal.mode)
		: null;
	const shmTarget = `${paths.databaseFile}-shm`;
	const shmPrepared = rollback.shm.existed
		? copyPrepared(paths.restore.rollbackShm, shmTarget, rollback.shm.sha256, rollback.shm.mode)
		: null;
	const keyPrepared = rollback.key?.existed
		? copyPrepared(
				paths.restore.rollbackKey,
				paths.appKeyFile,
				rollback.key.sha256,
				rollback.key.mode
			)
		: null;

	if (databasePrepared) renameSync(databasePrepared, paths.databaseFile);
	else removeOwnedFile(paths.databaseFile);
	if (walPrepared) renameSync(walPrepared, walTarget);
	else removeOwnedFile(walTarget);
	if (shmPrepared) renameSync(shmPrepared, shmTarget);
	else removeOwnedFile(shmTarget);
	if (rollback.key) {
		if (keyPrepared) renameSync(keyPrepared, paths.appKeyFile);
		else removeOwnedFile(paths.appKeyFile);
	}

	verifyRestoredFile(rollback.database, paths.databaseFile, 'database');
	verifyRestoredFile(rollback.wal, walTarget, 'database WAL');
	verifyRestoredFile(rollback.shm, shmTarget, 'database SHM');
	if (rollback.key) verifyRestoredFile(rollback.key, paths.appKeyFile, 'application key');
}

function archivePendingMarker(paths: DataPaths): string {
	if (existsSync(paths.restore.failedMarker)) {
		throw new Error('a failed restore marker already exists');
	}
	renameSync(paths.restore.pendingMarker, paths.restore.failedMarker);
	return paths.restore.failedMarker;
}

function cleanupPrepared(paths: DataPaths): void {
	if (paths.databaseFile) {
		removeOwnedFile(preparedRestorePath(paths.databaseFile));
		removeOwnedFile(preparedRestorePath(`${paths.databaseFile}-wal`));
		removeOwnedFile(preparedRestorePath(`${paths.databaseFile}-shm`));
	}
	removeOwnedFile(preparedRestorePath(paths.appKeyFile));
}

/**
 * Apply a preflighted restore marker before libSQL opens the database.
 *
 * Staged files are copied to the target filesystem and checksum-verified before
 * an atomic rename. The previous database, WAL/SHM, and optional key are retained
 * under `restore-rollback/`. A matching rollback marker found on the next boot is
 * treated as an interrupted replacement: the prior set is restored before the
 * database is allowed to open.
 */
export function processPendingRestore(paths: DataPaths): PendingRestoreResult {
	if (!existsSync(paths.restore.pendingMarker)) return { status: 'none' };

	let pending: ReadPendingMarker;
	try {
		pending = readPendingMarker(paths.restore.pendingMarker);
	} catch (error) {
		if (existsSync(paths.restore.rollbackMarker)) {
			throw new Error(
				`restore marker is invalid while rollback data exists: ${errorMessage(error)}`,
				{ cause: error }
			);
		}
		const failedMarker = archivePendingMarker(paths);
		return { status: 'rejected', failedMarker, error: errorMessage(error) };
	}

	if (!paths.databaseFile) {
		const failedMarker = archivePendingMarker(paths);
		return {
			status: 'rejected',
			failedMarker,
			error: 'pending restore requires a local file: database URL',
			...(pending.marker.restore ? { restore: pending.marker.restore } : {})
		};
	}

	const databaseTarget = resolve(paths.databaseFile);
	const keyTarget = pending.marker.stagedKey ? resolve(paths.appKeyFile) : null;
	if (
		keyTarget &&
		[
			databaseTarget,
			resolve(`${paths.databaseFile}-wal`),
			resolve(`${paths.databaseFile}-shm`)
		].includes(keyTarget)
	) {
		const failedMarker = archivePendingMarker(paths);
		return {
			status: 'rejected',
			failedMarker,
			error: 'application key target must differ from the database and its sidecars',
			...(pending.marker.restore ? { restore: pending.marker.restore } : {})
		};
	}

	const protectedTargets = [databaseTarget, ...(keyTarget ? [keyTarget] : [])];
	if (
		protectedTargets.some(
			(target) =>
				pathIsWithin(paths.restore.stagingDirectory, target) ||
				pathIsWithin(paths.restore.rollbackDirectory, target) ||
				target === resolve(paths.restore.pendingMarker) ||
				target === resolve(paths.restore.failedMarker)
		)
	) {
		const failedMarker = archivePendingMarker(paths);
		return {
			status: 'rejected',
			failedMarker,
			error: 'database and application key targets must stay outside restore working paths',
			...(pending.marker.restore ? { restore: pending.marker.restore } : {})
		};
	}

	if (existsSync(paths.restore.rollbackMarker)) {
		const rollback = readRollbackMarker(paths.restore.rollbackMarker);
		try {
			validateRollbackTargets(paths, pending, rollback);
			restoreRollback(paths, pending, rollback);
			cleanupPrepared(paths);
			const failedMarker = archivePendingMarker(paths);
			return {
				status: 'rolled_back',
				failedMarker,
				rollbackMarker: paths.restore.rollbackMarker,
				error: 'an interrupted restore was rolled back before database startup',
				...(pending.marker.restore ? { restore: pending.marker.restore } : {})
			};
		} catch (error) {
			throw new Error(`could not recover an interrupted restore: ${errorMessage(error)}`, {
				cause: error
			});
		}
	}

	let rollback: RestoreRollbackMarkerV1 | null = null;
	try {
		const database = validateStagedFile(
			paths,
			pending.marker.stagedDatabase,
			'stagedDatabase',
			0o600
		);
		const key = pending.marker.stagedKey
			? validateStagedFile(paths, pending.marker.stagedKey, 'stagedKey', 0o600, APP_KEY_BYTES)
			: null;
		const databasePrepared = copyPrepared(
			database.path,
			paths.databaseFile,
			database.sha256,
			database.mode
		);
		const keyPrepared = key ? copyPrepared(key.path, paths.appKeyFile, key.sha256, key.mode) : null;

		rollback = createRollback(paths, pending);
		renameSync(databasePrepared, paths.databaseFile);
		removeOwnedFile(`${paths.databaseFile}-wal`);
		removeOwnedFile(`${paths.databaseFile}-shm`);
		if (keyPrepared) renameSync(keyPrepared, paths.appKeyFile);

		if (sha256File(paths.databaseFile) !== database.sha256) {
			throw new Error('installed database checksum does not match');
		}
		if (key && sha256File(paths.appKeyFile) !== key.sha256) {
			throw new Error('installed application key checksum does not match');
		}

		// Orchestrated restores retain the marker until migrations and local readiness
		// pass. If boot fails first, the next startup sees marker + rollback data and
		// restores the prior state before opening SQLite.
		if (!pending.marker.restore) unlinkSync(paths.restore.pendingMarker);
		return {
			status: 'applied',
			rollbackMarker: paths.restore.rollbackMarker,
			...(pending.marker.restore ? { restore: pending.marker.restore } : {})
		};
	} catch (error) {
		cleanupPrepared(paths);
		if (rollback) {
			try {
				restoreRollback(paths, pending, rollback);
			} catch (rollbackError) {
				throw new Error(
					`restore failed (${errorMessage(error)}) and rollback also failed (${errorMessage(rollbackError)})`,
					{ cause: rollbackError }
				);
			}
			const failedMarker = archivePendingMarker(paths);
			return {
				status: 'rolled_back',
				failedMarker,
				rollbackMarker: paths.restore.rollbackMarker,
				error: errorMessage(error),
				...(pending.marker.restore ? { restore: pending.marker.restore } : {})
			};
		}

		const failedMarker = archivePendingMarker(paths);
		return {
			status: 'rejected',
			failedMarker,
			error: errorMessage(error),
			...(pending.marker.restore ? { restore: pending.marker.restore } : {})
		};
	}
}

/** Commit an orchestrated restore only after migrations and local readiness pass. */
export function finalizeAppliedPendingRestore(paths: DataPaths, expectedRestoreId: string): void {
	const pending = readPendingMarker(paths.restore.pendingMarker);
	if (!pending.marker.restore || pending.marker.restore.restoreId !== expectedRestoreId) {
		throw new Error('pending restore context changed before readiness completed');
	}
	removeOwnedFile(paths.restore.pendingMarker);
	rmSync(paths.restore.rollbackDirectory, { recursive: true, force: true });
	rmSync(paths.restore.stagingDirectory, { recursive: true, force: true });
	cleanupPrepared(paths);
}
