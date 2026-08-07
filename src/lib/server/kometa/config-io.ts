/**
 * Filesystem I/O for Kometa configuration and metadata files.
 *
 * Paths are canonicalized before locking or I/O. Writes publish a mode-0600
 * temporary file with rename, sync it when the filesystem supports fsync, and
 * leave a verified backup when replacing an existing file.
 */

import { createHash, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
	chmodSync,
	closeSync,
	constants,
	existsSync,
	fchmodSync,
	fstatSync,
	fsyncSync,
	linkSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	unlinkSync,
	writeFileSync
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import {
	freezePhysicalPath,
	inspectFrozenPhysicalPath,
	PhysicalPathInspectionError,
	validateFrozenPhysicalPath,
	type FrozenPhysicalPath
} from './physical-path-alias';

const BACKUP_INFIX = '.posterpilot-bak-';
const PROTECTED_BACKUP_INFIX = '.posterpilot-migration-bak-';
const CAS_QUARANTINE_SUFFIX = '.posterpilot-cas-quarantine';
const MIGRATION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,127})$/;
const SHA256 = /^[a-f0-9]{64}$/;

/** Serializable canonical destination binding frozen during migration preview. */
export type ConfigPathBinding = FrozenPhysicalPath;

/** Freeze a config/metadata target without creating any filesystem entries. */
export function freezeConfigPath(path: string): ConfigPathBinding {
	return freezePhysicalPath(path);
}

/** Validate a serialized binding without touching the filesystem. */
export function validateConfigPathBinding(value: unknown): ConfigPathBinding {
	return validateFrozenPhysicalPath(value);
}

/** Resolve aliases through the deepest existing ancestor, including symlinked dirs. */
export function canonicalConfigPath(path: string): string {
	let cursor = resolve(path);
	const suffix: string[] = [];
	while (!existsSync(cursor)) {
		const parent = dirname(cursor);
		if (parent === cursor) break;
		suffix.unshift(basename(cursor));
		cursor = parent;
	}
	try {
		return join(realpathSync.native(cursor), ...suffix);
	} catch {
		return resolve(path);
	}
}

const canonicalPath = canonicalConfigPath;

function errorCode(error: unknown): string | null {
	return error instanceof Error && 'code' in error && typeof error.code === 'string'
		? error.code
		: null;
}

function unsupportedFsync(error: unknown): boolean {
	return ['EBADF', 'EINVAL', 'EISDIR', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EPERM'].includes(
		errorCode(error) ?? ''
	);
}

function syncDescriptor(fd: number): void {
	try {
		fsyncSync(fd);
	} catch (error) {
		if (!unsupportedFsync(error)) throw error;
	}
}

function syncFile(path: string): void {
	const fd = openSync(path, 'r');
	try {
		syncDescriptor(fd);
	} finally {
		closeSync(fd);
	}
}

function syncDirectory(path: string): void {
	let fd: number | null = null;
	try {
		fd = openSync(path, 'r');
		syncDescriptor(fd);
	} catch (error) {
		if (!unsupportedFsync(error)) throw error;
	} finally {
		if (fd !== null) closeSync(fd);
	}
}

function sha256(content: Buffer): string {
	return createHash('sha256').update(content).digest('hex');
}

function boundPathChanged(cause?: unknown): never {
	throw new PhysicalPathInspectionError('path_changed', 0, { cause });
}

function boundInspectionFailed(cause?: unknown): never {
	throw new PhysicalPathInspectionError('inspection_failed', 0, { cause });
}

function noFollowFlag(): number {
	if (typeof constants.O_NOFOLLOW !== 'number' || constants.O_NOFOLLOW === 0) {
		boundInspectionFailed(new Error('O_NOFOLLOW is unavailable'));
	}
	return constants.O_NOFOLLOW;
}

function fileIdentity(device: bigint, inode: bigint): string {
	return `${device.toString()}:${inode.toString()}`;
}

interface BoundFileRead {
	content: Buffer;
	identity: string;
}

/** Open a frozen final component without following it and bind lstat to fstat. */
function readBoundFile(
	binding: ConfigPathBinding,
	opts: { secureMode?: boolean } = {}
): BoundFileRead | null {
	const inspected = inspectFrozenPhysicalPath(binding);
	if (!inspected.exists || inspected.identity === null) return null;

	let fd: number;
	try {
		fd = openSync(binding.canonicalPath, constants.O_RDONLY | noFollowFlag());
	} catch (error) {
		boundPathChanged(error);
	}
	try {
		const stats = fstatSync(fd, { bigint: true });
		const identity = fileIdentity(stats.dev, stats.ino);
		if (!stats.isFile() || identity !== inspected.identity) boundPathChanged();
		if (opts.secureMode) {
			// Never chmod a caller-supplied hard link: permissions apply to the shared
			// inode and could mutate an unrelated external file. PosterPilot's own
			// protected backups have one link after their temporary name is removed.
			if (stats.nlink !== 1n) boundPathChanged();
			fchmodSync(fd, 0o600);
			syncDescriptor(fd);
		}
		return { content: readFileSync(fd), identity };
	} catch (error) {
		if (error instanceof PhysicalPathInspectionError) throw error;
		boundInspectionFailed(error);
	} finally {
		closeSync(fd);
	}
}

function siblingBinding(binding: ConfigPathBinding, name: string): ConfigPathBinding {
	if (!name || basename(name) !== name || name === '.' || name === '..') {
		throw new TypeError('Invalid frozen sibling name');
	}
	return { ...binding, canonicalPath: join(dirname(binding.canonicalPath), name) };
}

function assertBoundDirectory(path: string): { device: bigint; inode: bigint } {
	try {
		const stats = lstatSync(path, { bigint: true });
		if (stats.isSymbolicLink() || !stats.isDirectory()) boundPathChanged();
		return { device: stats.dev, inode: stats.ino };
	} catch (error) {
		if (error instanceof PhysicalPathInspectionError) throw error;
		boundInspectionFailed(error);
	}
}

interface BoundParentLease {
	fd: number;
	path: string;
	device: bigint;
	inode: bigint;
}

/**
 * Hold the final parent directory open throughout a frozen write.
 *
 * Node does not expose openat/linkat/renameat, so the descriptor cannot be used
 * as the base of later path operations. Keeping it open still lets us detect a
 * renamed/replaced parent before and after every mutation instead of trusting a
 * pathname-only check made at preview time.
 */
function openBoundParentLease(binding: ConfigPathBinding): BoundParentLease {
	inspectFrozenPhysicalPath(binding);
	const path = dirname(binding.canonicalPath);
	const before = assertBoundDirectory(path);
	let fd: number;
	try {
		fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | noFollowFlag());
	} catch (error) {
		boundPathChanged(error);
	}
	try {
		const held = fstatSync(fd, { bigint: true });
		if (!held.isDirectory() || held.dev !== before.device || held.ino !== before.inode) {
			boundPathChanged();
		}
		inspectFrozenPhysicalPath(binding);
		return { fd, path, device: held.dev, inode: held.ino };
	} catch (error) {
		closeSync(fd);
		throw error;
	}
}

function assertBoundParentLease(binding: ConfigPathBinding, lease: BoundParentLease): void {
	const held = fstatSync(lease.fd, { bigint: true });
	const current = assertBoundDirectory(lease.path);
	if (
		!held.isDirectory() ||
		held.dev !== lease.device ||
		held.ino !== lease.inode ||
		current.device !== lease.device ||
		current.inode !== lease.inode
	) {
		boundPathChanged();
	}
	inspectFrozenPhysicalPath(binding);
}

function boundParentLeaseIsCurrent(binding: ConfigPathBinding, lease: BoundParentLease): boolean {
	try {
		assertBoundParentLease(binding, lease);
		return true;
	} catch {
		return false;
	}
}

/** Create only a missing suffix beneath the frozen, identity-checked anchor. */
function ensureBoundParentDirectories(binding: ConfigPathBinding): void {
	inspectFrozenPhysicalPath(binding);
	const parentSuffix = relative(binding.anchorPath, dirname(binding.canonicalPath));
	if (!parentSuffix) return;
	if (parentSuffix === '..' || parentSuffix.startsWith(`..${sep}`)) boundPathChanged();

	let cursor = binding.anchorPath;
	for (const segment of parentSuffix.split(sep)) {
		cursor = join(cursor, segment);
		try {
			mkdirSync(cursor, { mode: 0o700 });
		} catch (error) {
			if (errorCode(error) !== 'EEXIST') boundInspectionFailed(error);
		}
		assertBoundDirectory(cursor);
	}
	inspectFrozenPhysicalPath(binding);
}

function syncBoundParent(binding: ConfigPathBinding): void {
	inspectFrozenPhysicalPath(binding);
	const directory = dirname(binding.canonicalPath);
	const before = assertBoundDirectory(directory);
	let fd: number;
	try {
		fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | noFollowFlag());
	} catch (error) {
		boundPathChanged(error);
	}
	try {
		const after = fstatSync(fd, { bigint: true });
		if (!after.isDirectory() || after.dev !== before.device || after.ino !== before.inode) {
			boundPathChanged();
		}
		syncDescriptor(fd);
	} finally {
		closeSync(fd);
	}
}

function writeBoundTemporary(path: string, content: Buffer): void {
	let fd: number;
	try {
		fd = openSync(
			path,
			constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag(),
			0o600
		);
	} catch (error) {
		boundInspectionFailed(error);
	}
	try {
		writeFileSync(fd, content);
		fchmodSync(fd, 0o600);
		syncDescriptor(fd);
	} finally {
		closeSync(fd);
	}
}

/** Publish a new frozen file with atomic no-replace semantics via hard link. */
function publishNewBoundFile(binding: ConfigPathBinding, content: Buffer, label: string): void {
	ensureBoundParentDirectories(binding);
	if (inspectFrozenPhysicalPath(binding).exists) throw new Error(`${label} already exists`);

	const tmp = siblingBinding(
		binding,
		`.${basename(binding.canonicalPath)}.tmp-${label}-${process.pid}-${randomUUID()}`
	);
	try {
		writeBoundTemporary(tmp.canonicalPath, content);
		if (inspectFrozenPhysicalPath(binding).exists) throw new Error(`${label} already exists`);
		try {
			// link(2) fails with EEXIST and therefore cannot overwrite a backup
			// that appeared after the final inspection.
			linkSync(tmp.canonicalPath, binding.canonicalPath);
		} catch (error) {
			if (errorCode(error) === 'EEXIST')
				throw new Error(`${label} already exists`, { cause: error });
			boundInspectionFailed(error);
		}
		const publishedFile = readBoundFile(binding);
		if (!publishedFile?.content.equals(content)) {
			throw new Error(`${label} content verification failed`);
		}
		syncBoundParent(binding);
	} finally {
		unlinkIfPresent(tmp.canonicalPath);
	}
}

function assertExactContent(path: string, expected: Buffer, label: string): void {
	const actual = readFileSync(path);
	if (!actual.equals(expected)) throw new Error(`${label} content verification failed`);
}

function unlinkIfPresent(path: string): void {
	try {
		unlinkSync(path);
	} catch (error) {
		if (errorCode(error) !== 'ENOENT') throw error;
	}
}

function temporaryPath(path: string, label: string): string {
	return join(dirname(path), `.${basename(path)}.tmp-${label}-${process.pid}-${randomUUID()}`);
}

function writeTemporary(path: string, content: Buffer): void {
	const fd = openSync(path, 'wx', 0o600);
	try {
		writeFileSync(fd, content);
		chmodSync(path, 0o600);
		syncDescriptor(fd);
	} finally {
		closeSync(fd);
	}
}

/** Publish a new file without intentionally replacing an existing destination. */
function publishNewFile(path: string, content: Buffer, label: string): void {
	if (existsSync(path)) throw new Error(`${label} already exists`);
	const tmp = temporaryPath(path, label);
	try {
		writeTemporary(tmp, content);
		if (existsSync(path)) throw new Error(`${label} already exists`);
		renameSync(tmp, path);
		chmodSync(path, 0o600);
		syncFile(path);
		syncDirectory(dirname(path));
		assertExactContent(path, content, label);
	} finally {
		unlinkIfPresent(tmp);
	}
}

/** Read the config file at `path`, or null when it does not exist. */
export function readConfig(path: string): string | null {
	const target = canonicalPath(path);
	if (!existsSync(target)) return null;
	return readFileSync(target, 'utf8');
}

/** Read a preview-bound target without recanonicalizing or following its final name. */
export function readConfigAtBinding(binding: ConfigPathBinding): string | null {
	return readBoundFile(binding)?.content.toString('utf8') ?? null;
}

/** Make a timestamp safe for use in a filename. */
function safeStamp(stamp: string): string {
	return stamp.replace(/[^A-Za-z0-9_-]/g, '-') || 'backup';
}

function nextNormalBackupPath(target: string, stamp: string): string {
	const dir = dirname(target);
	const base = join(dir, `${basename(target)}${BACKUP_INFIX}${safeStamp(stamp)}`);
	if (!existsSync(base)) return base;
	let suffix = 1;
	while (existsSync(`${base}-${suffix}`)) suffix++;
	return `${base}-${suffix}`;
}

function writeVerifiedNormalBackup(target: string, content: Buffer, stamp: string): string {
	const backup = nextNormalBackupPath(target, stamp);
	publishNewFile(backup, content, 'config-backup');
	return backup;
}

/**
 * Write `text` to `path` atomically, backing up any existing file first.
 *
 * @returns the absolute backup path that was created, or null when there was no prior file.
 */
export function writeConfigAtomic(
	path: string,
	text: string,
	stamp: string,
	opts: { backups?: number } = {}
): { backup: string | null } {
	const target = canonicalPath(path);
	const dir = dirname(target);
	mkdirSync(dir, { recursive: true });

	const content = Buffer.from(text, 'utf8');
	const tmp = temporaryPath(target, safeStamp(stamp));
	let backup: string | null = null;
	try {
		// Preparing the replacement first still leaves the backup as the final step
		// before rename, while ensuring every later failure cleans a real temp file.
		writeTemporary(tmp, content);
		if (existsSync(target)) {
			backup = writeVerifiedNormalBackup(target, readFileSync(target), stamp);
		}
		renameSync(tmp, target);
		chmodSync(target, 0o600);
		syncFile(target);
		syncDirectory(dir);
		assertExactContent(target, content, 'config write');
	} finally {
		unlinkIfPresent(tmp);
	}

	pruneBackups(dir, basename(target), opts.backups ?? 5);
	return { backup };
}

function nextBoundNormalBackup(binding: ConfigPathBinding, stamp: string): ConfigPathBinding {
	const base = `${basename(binding.canonicalPath)}${BACKUP_INFIX}${safeStamp(stamp)}`;
	for (let suffix = 0; suffix < Number.MAX_SAFE_INTEGER; suffix++) {
		const name = suffix === 0 ? base : `${base}-${suffix}`;
		const candidate = siblingBinding(binding, name);
		if (!inspectFrozenPhysicalPath(candidate).exists) return candidate;
	}
	throw new Error('Unable to allocate config backup name');
}

function sameBoundFile(expected: BoundFileRead | null, actual: BoundFileRead | null): boolean {
	return (
		(expected === null && actual === null) ||
		(expected !== null &&
			actual !== null &&
			expected.identity === actual.identity &&
			expected.content.equals(actual.content))
	);
}

function hasExpectedContent(actual: BoundFileRead | null, expected: Buffer | null): boolean {
	return expected === null ? actual === null : actual !== null && actual.content.equals(expected);
}

function casQuarantineBinding(binding: ConfigPathBinding): ConfigPathBinding {
	return siblingBinding(binding, `.${basename(binding.canonicalPath)}${CAS_QUARANTINE_SUFFIX}`);
}

/**
 * Restore a detached target only while its canonical name is still absent.
 * link(2) is deliberately used instead of rename(2): if another writer has
 * filled the name, both its bytes and the quarantined bytes remain untouched.
 */
function restoreQuarantinedTarget(
	binding: ConfigPathBinding,
	quarantine: ConfigPathBinding,
	lease: BoundParentLease
): boolean {
	try {
		assertBoundParentLease(binding, lease);
		const detached = readBoundFile(quarantine);
		if (detached === null) return true;
		if (readBoundFile(binding) !== null) return false;
		try {
			linkSync(quarantine.canonicalPath, binding.canonicalPath);
		} catch (error) {
			if (errorCode(error) === 'EEXIST') return false;
			return false;
		}
		const restored = readBoundFile(binding);
		if (!sameBoundFile(detached, restored)) return false;
		assertBoundParentLease(binding, lease);
		unlinkSync(quarantine.canonicalPath);
		syncDescriptor(lease.fd);
		return true;
	} catch {
		// Recovery is intentionally best-effort and no-replace. On any ambiguity,
		// leave the discoverable quarantine in place rather than deleting bytes.
		return false;
	}
}

function recoverOrRejectStaleQuarantine(
	binding: ConfigPathBinding,
	quarantine: ConfigPathBinding,
	lease: BoundParentLease,
	intendedContent: Buffer,
	expectedSource: Buffer | null | undefined
): boolean {
	const quarantined = readBoundFile(quarantine);
	if (quarantined === null) return false;
	const target = readBoundFile(binding);
	if (target === null) {
		if (!restoreQuarantinedTarget(binding, quarantine, lease)) boundPathChanged();
		return false;
	}

	// This is the durable state left by termination after publication but before
	// cleanup. Finalize it only when both sides prove the exact attempted CAS.
	if (
		!target.content.equals(intendedContent) ||
		expectedSource === undefined ||
		expectedSource === null ||
		!quarantined.content.equals(expectedSource)
	) {
		boundPathChanged();
	}
	assertBoundParentLease(binding, lease);
	if (
		!sameBoundFile(target, readBoundFile(binding)) ||
		!sameBoundFile(quarantined, readBoundFile(quarantine))
	) {
		boundPathChanged();
	}
	unlinkSync(quarantine.canonicalPath);
	syncDescriptor(lease.fd);
	return true;
}

/** Synchronous fault-injection hooks used only by filesystem race tests. */
export interface BoundConfigWriteTestHooks {
	beforeFinalRevalidation?: () => void;
	afterTargetDetached?: () => void;
	beforePublish?: () => void;
}

export interface BoundConfigWriteOptions {
	/** Exact predecessor bytes frozen by the migration, or null when it was absent. */
	expectedSource?: string | null;
	/** @internal */
	testHooks?: BoundConfigWriteTestHooks;
}

/**
 * Replace the canonical name frozen at preview time without overwriting a
 * target that wins a concurrent race.
 *
 * Portable Node has neither renameat2(RENAME_NOREPLACE) nor dirfd-relative
 * openat/linkat/renameat. An existing target is therefore first detached into
 * a deterministic, discoverable quarantine, then the prepared file is linked
 * into the empty name with atomic no-replace semantics. A caught failure
 * restores the quarantine only when the target is still empty; otherwise both
 * versions are preserved. A later invocation restores a quarantine left while
 * the target is absent, or finalizes a completed publication only when the
 * target and quarantined predecessor exactly match the intended CAS.
 *
 * The parent directory is held open and its identity plus the frozen anchor are
 * checked around mutations. This is fail-closed for ordinary/cooperative local
 * writers. A hostile principal able to rename ancestors between a check and a
 * pathname syscall is outside the supported self-hosted filesystem threat
 * model; eliminating that residual requires native dirfd-relative operations.
 * kill -9 during the detach window can temporarily leave the canonical name
 * absent, but the exact bytes remain in quarantine (and migration callers also
 * keep a protected backup) for automatic recovery on the next invocation.
 */
export function writeConfigAtomicAtBinding(
	binding: ConfigPathBinding,
	text: string,
	stamp: string,
	opts: BoundConfigWriteOptions = {}
): { backup: string | null } {
	ensureBoundParentDirectories(binding);
	const content = Buffer.from(text, 'utf8');
	const hasExpectedSource = Object.prototype.hasOwnProperty.call(opts, 'expectedSource');
	const expectedSource: Buffer | null | undefined = !hasExpectedSource
		? undefined
		: opts.expectedSource === null
			? null
			: typeof opts.expectedSource === 'string'
				? Buffer.from(opts.expectedSource, 'utf8')
				: boundInspectionFailed(new Error('Invalid expected source'));
	const tmp = siblingBinding(
		binding,
		`.${basename(binding.canonicalPath)}.tmp-${safeStamp(stamp)}-${process.pid}-${randomUUID()}`
	);
	const quarantine = casQuarantineBinding(binding);
	const lease = openBoundParentLease(binding);
	let backup: string | null = null;
	let detached = false;
	let published = false;

	try {
		if (recoverOrRejectStaleQuarantine(binding, quarantine, lease, content, expectedSource)) {
			return { backup: null };
		}
		const initial = readBoundFile(binding);
		// Exact intended bytes already at the target make retries idempotent even
		// after the original predecessor has ceased to be current.
		if (initial?.content.equals(content)) return { backup: null };
		if (expectedSource !== undefined && !hasExpectedContent(initial, expectedSource)) {
			boundPathChanged();
		}
		writeBoundTemporary(tmp.canonicalPath, content);
		assertBoundParentLease(binding, lease);
		if (initial !== null) {
			const backupBinding = nextBoundNormalBackup(binding, stamp);
			publishNewBoundFile(backupBinding, initial.content, 'config-backup');
			backup = backupBinding.canonicalPath;
		}

		opts.testHooks?.beforeFinalRevalidation?.();
		assertBoundParentLease(binding, lease);
		const current = readBoundFile(binding);
		if (!sameBoundFile(initial, current)) boundPathChanged();

		if (initial !== null) {
			if (readBoundFile(quarantine) !== null) boundPathChanged();
			assertBoundParentLease(binding, lease);
			try {
				renameSync(binding.canonicalPath, quarantine.canonicalPath);
			} catch (error) {
				boundPathChanged(error);
			}
			detached = true;
			assertBoundParentLease(binding, lease);
			const quarantined = readBoundFile(quarantine);
			if (!sameBoundFile(initial, quarantined)) {
				if (restoreQuarantinedTarget(binding, quarantine, lease)) detached = false;
				boundPathChanged();
			}
			opts.testHooks?.afterTargetDetached?.();
		}

		assertBoundParentLease(binding, lease);
		if (readBoundFile(binding) !== null) boundPathChanged();
		opts.testHooks?.beforePublish?.();
		assertBoundParentLease(binding, lease);
		try {
			// link(2) cannot replace a file that appears after the final check.
			linkSync(tmp.canonicalPath, binding.canonicalPath);
		} catch (error) {
			if (errorCode(error) === 'EEXIST') boundPathChanged(error);
			boundInspectionFailed(error);
		}
		published = true;

		const publishedFile = readBoundFile(binding);
		if (!publishedFile?.content.equals(content)) {
			throw new Error('config write content verification failed');
		}
		if (detached) {
			const quarantined = readBoundFile(quarantine);
			if (!sameBoundFile(initial, quarantined)) {
				throw new Error('config write quarantine changed during publication');
			}
			assertBoundParentLease(binding, lease);
			unlinkSync(quarantine.canonicalPath);
			detached = false;
		}
		assertBoundParentLease(binding, lease);
		syncDescriptor(lease.fd);
	} catch (error) {
		if (detached && !published) restoreQuarantinedTarget(binding, quarantine, lease);
		throw error;
	} finally {
		if (boundParentLeaseIsCurrent(binding, lease)) {
			try {
				unlinkIfPresent(tmp.canonicalPath);
			} catch {
				// Do not mask the primary result; a mode-0600 temp is inert and discoverable.
			}
		}
		closeSync(lease.fd);
	}

	return { backup };
}

/** Keep only the newest rotating backups; protected migration backups are excluded. */
export function pruneBackups(dir: string, configName: string, keep: number): void {
	if (keep < 0) return;
	const directory = canonicalPath(dir);
	const prefix = `${basename(configName)}${BACKUP_INFIX}`;
	let entries: string[];
	try {
		entries = readdirSync(directory);
	} catch {
		return;
	}
	const backups = entries.filter((entry) => entry.startsWith(prefix)).sort();
	for (const old of backups.slice(0, Math.max(0, backups.length - keep))) {
		try {
			unlinkSync(join(directory, old));
		} catch {
			// Best-effort rotating cleanup never invalidates a completed write.
		}
	}
}

/** A backup file PosterPilot has written for the config. */
export interface BackupInfo {
	name: string;
	stamp: string;
	protected: boolean;
	migrationId?: string;
}

export interface ProtectedBackupResult {
	name: string;
	path: string;
	migrationId: string;
	checksum: string;
	created: boolean;
}

export interface CreateProtectedBackupOptions {
	/** Exact preview-bound source bytes; required by migration callers for stale detection. */
	expectedContent?: string;
}

export interface ReadBackupOptions {
	/** Optional stored checksum used to detect backup tampering before restore. */
	expectedChecksum?: string;
}

function assertMigrationId(migrationId: string): void {
	if (!MIGRATION_ID.test(migrationId)) throw new TypeError('Invalid Kometa migration id');
}

/** Deterministic protected-backup filename for one migration id. */
export function protectedBackupName(path: string, migrationId: string): string {
	assertMigrationId(migrationId);
	return `${basename(canonicalPath(path))}${PROTECTED_BACKUP_INFIX}${migrationId}`;
}

/**
 * Create or verify the immutable rollback backup for one migration.
 *
 * Repeating the call with the same migration id and expected content returns the
 * existing verified backup. It never overwrites mismatched or tampered bytes.
 */
export function createProtectedBackup(
	path: string,
	migrationId: string,
	opts: CreateProtectedBackupOptions = {}
): ProtectedBackupResult {
	const target = canonicalPath(path);
	const name = protectedBackupName(target, migrationId);
	const backup = join(dirname(target), name);
	const expected =
		opts.expectedContent === undefined ? null : Buffer.from(opts.expectedContent, 'utf8');

	if (existsSync(backup)) {
		const content = readFileSync(backup);
		if (expected && !content.equals(expected)) {
			throw new Error('Protected Kometa backup content mismatch');
		}
		chmodSync(backup, 0o600);
		syncFile(backup);
		return {
			name,
			path: backup,
			migrationId,
			checksum: sha256(content),
			created: false
		};
	}

	if (!existsSync(target)) throw new Error('Protected Kometa backup source not found');
	const source = readFileSync(target);
	if (expected && !source.equals(expected)) {
		throw new Error('Protected Kometa backup source changed');
	}
	mkdirSync(dirname(target), { recursive: true });
	publishNewFile(backup, source, 'protected-config-backup');
	return {
		name,
		path: backup,
		migrationId,
		checksum: sha256(source),
		created: true
	};
}

function protectedBackupBinding(
	binding: ConfigPathBinding,
	migrationId: string
): { binding: ConfigPathBinding; name: string } {
	assertMigrationId(migrationId);
	const name = `${basename(binding.canonicalPath)}${PROTECTED_BACKUP_INFIX}${migrationId}`;
	return { binding: siblingBinding(binding, name), name };
}

/** Create or verify a protected backup without following frozen final components. */
export function createProtectedBackupAtBinding(
	binding: ConfigPathBinding,
	migrationId: string,
	opts: CreateProtectedBackupOptions = {}
): ProtectedBackupResult {
	// Validate the source binding before deriving any sibling path from it.
	inspectFrozenPhysicalPath(binding);
	const protectedBackup = protectedBackupBinding(binding, migrationId);
	const expected =
		opts.expectedContent === undefined ? null : Buffer.from(opts.expectedContent, 'utf8');
	const existing = readBoundFile(protectedBackup.binding, { secureMode: true });

	if (existing !== null) {
		if (expected && !existing.content.equals(expected)) {
			throw new Error('Protected Kometa backup content mismatch');
		}
		return {
			name: protectedBackup.name,
			path: protectedBackup.binding.canonicalPath,
			migrationId,
			checksum: sha256(existing.content),
			created: false
		};
	}

	const source = readBoundFile(binding);
	if (source === null) throw new Error('Protected Kometa backup source not found');
	if (expected && !source.content.equals(expected)) {
		throw new Error('Protected Kometa backup source changed');
	}
	publishNewBoundFile(protectedBackup.binding, source.content, 'protected-config-backup');
	return {
		name: protectedBackup.name,
		path: protectedBackup.binding.canonicalPath,
		migrationId,
		checksum: sha256(source.content),
		created: true
	};
}

function protectedMigrationId(configName: string, name: string): string | null {
	const prefix = `${configName}${PROTECTED_BACKUP_INFIX}`;
	if (!name.startsWith(prefix)) return null;
	const migrationId = name.slice(prefix.length);
	return MIGRATION_ID.test(migrationId) ? migrationId : null;
}

/** List rotating and protected backups for a config file, newest names first. */
export function listBackups(path: string): BackupInfo[] {
	const target = canonicalPath(path);
	const dir = dirname(target);
	const configName = basename(target);
	const normalPrefix = `${configName}${BACKUP_INFIX}`;
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}

	const backups: BackupInfo[] = [];
	for (const name of entries) {
		if (name.startsWith(normalPrefix)) {
			backups.push({ name, stamp: name.slice(normalPrefix.length), protected: false });
			continue;
		}
		const migrationId = protectedMigrationId(configName, name);
		if (migrationId) backups.push({ name, stamp: migrationId, protected: true, migrationId });
	}
	return backups.sort((a, b) => b.stamp.localeCompare(a.stamp) || b.name.localeCompare(a.name));
}

function unsafeBackupName(name: string): boolean {
	return name.length === 0 || name.includes('/') || name.includes('\\') || name.includes('..');
}

/** Read one validated rotating or protected backup belonging to this config file. */
export function readBackup(path: string, name: string, opts: ReadBackupOptions = {}): string {
	const target = canonicalPath(path);
	const configName = basename(target);
	const normalPrefix = `${configName}${BACKUP_INFIX}`;
	const protectedId = protectedMigrationId(configName, name);
	if (unsafeBackupName(name) || (!name.startsWith(normalPrefix) && protectedId === null)) {
		throw new Error('Invalid backup name');
	}
	if (opts.expectedChecksum !== undefined && !SHA256.test(opts.expectedChecksum)) {
		throw new TypeError('Invalid backup checksum');
	}

	const src = join(dirname(target), name);
	if (!existsSync(src)) throw new Error('Backup not found');
	const content = readFileSync(src);
	if (opts.expectedChecksum && sha256(content) !== opts.expectedChecksum) {
		throw new Error('Backup checksum mismatch');
	}
	return content.toString('utf8');
}

/** Read a validated backup sibling through a frozen target binding. */
export function readBackupAtBinding(
	binding: ConfigPathBinding,
	name: string,
	opts: ReadBackupOptions = {}
): string {
	inspectFrozenPhysicalPath(binding);
	const configName = basename(binding.canonicalPath);
	const normalPrefix = `${configName}${BACKUP_INFIX}`;
	const protectedId = protectedMigrationId(configName, name);
	if (unsafeBackupName(name) || (!name.startsWith(normalPrefix) && protectedId === null)) {
		throw new Error('Invalid backup name');
	}
	if (opts.expectedChecksum !== undefined && !SHA256.test(opts.expectedChecksum)) {
		throw new TypeError('Invalid backup checksum');
	}

	const source = readBoundFile(siblingBinding(binding, name));
	if (source === null) throw new Error('Backup not found');
	if (opts.expectedChecksum && sha256(source.content) !== opts.expectedChecksum) {
		throw new Error('Backup checksum mismatch');
	}
	return source.content.toString('utf8');
}

/**
 * Restore a named rotating or protected backup over the current config, backing
 * up the current file first. Callers that need CAS must preview and fingerprint it.
 */
export function restoreBackup(
	path: string,
	name: string,
	stamp: string
): { backup: string | null } {
	const content = readBackup(path, name);
	return writeConfigAtomic(path, content, stamp);
}

// ── Multi-path single-flight lock ─────────────────────────────────────────────
// Every operation acquires canonical keys in the same order. Existing callers may
// continue nesting withConfigLock in that order, while self-reentry is a no-op.
// The lock remains in-process only; external Kometa/editor writes still require CAS.
const chains = new Map<string, Promise<void>>();
interface ConfigLockContext {
	paths: ReadonlySet<string>;
	active: boolean;
}
const lockContext = new AsyncLocalStorage<ConfigLockContext>();

function canonicalLockPaths(paths: readonly string[]): string[] {
	return [...new Set(paths.map(canonicalPath))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

async function acquireConfigPath<T>(path: string, fn: () => Promise<T>): Promise<T> {
	const previous = chains.get(path) ?? Promise.resolve();
	let release!: () => void;
	const completion = new Promise<void>((resolveCompletion) => {
		release = resolveCompletion;
	});
	chains.set(path, completion);

	await previous;
	try {
		return await fn();
	} finally {
		release();
		if (chains.get(path) === completion) chains.delete(path);
	}
}

function acquireConfigPaths<T>(
	paths: readonly string[],
	index: number,
	context: ConfigLockContext,
	fn: () => Promise<T>
): Promise<T> {
	if (index >= paths.length) return lockContext.run(context, fn);
	return acquireConfigPath(paths[index], () => acquireConfigPaths(paths, index + 1, context, fn));
}

/**
 * Serialize an operation against every supplied path as one deadlock-free set.
 *
 * Re-entering a path already held by the current async operation is a no-op.
 * A legacy nested call may add paths only after every path already held; reverse
 * expansion fails fast instead of introducing a lock-order deadlock.
 */
export async function withConfigLocks<T>(
	paths: readonly string[],
	fn: () => Promise<T>
): Promise<T> {
	const canonical = canonicalLockPaths(paths);
	const current = lockContext.getStore();
	if (current?.active) {
		const missing = canonical.filter((path) => !current.paths.has(path));
		if (missing.length === 0) return fn();
		const held = [...current.paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
		if (held.length > 0 && missing[0] < held[held.length - 1]) {
			throw new Error('Nested Kometa locks must follow canonical path order');
		}
		const nestedContext: ConfigLockContext = {
			paths: new Set([...current.paths, ...missing]),
			active: true
		};
		try {
			return await acquireConfigPaths(missing, 0, nestedContext, fn);
		} finally {
			nestedContext.active = false;
		}
	}
	if (canonical.length === 0) return fn();

	const context: ConfigLockContext = { paths: new Set(canonical), active: true };
	try {
		return await acquireConfigPaths(canonical, 0, context, fn);
	} finally {
		context.active = false;
	}
}

/** Backward-compatible one-path lock implemented by the multi-path primitive. */
export function withConfigLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
	return withConfigLocks([path], fn);
}
