import { createHash, randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import {
	chmod,
	link,
	lstat,
	mkdir,
	readFile,
	readdir,
	rename,
	stat,
	unlink,
	writeFile
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { DataPaths } from '$lib/server/data-paths';

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REFERENCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/**
 * Newly orphaned files get a grace period before collection. Besides making
 * cleanup policy explicit, this protects a blob created immediately before its
 * durable database/reference record from a concurrent maintenance pass.
 */
const DEFAULT_SNAPSHOT_CLEANUP_GRACE_MS = 24 * 60 * 60 * 1_000;

export type SnapshotStoreErrorCode =
	| 'invalid_reference_id'
	| 'invalid_digest'
	| 'reference_not_found'
	| 'reference_conflict'
	| 'blob_not_found'
	| 'blob_corrupt'
	| 'unsafe_storage_layout'
	| 'invalid_cleanup_policy';

/** A stable, locale-neutral storage failure safe to persist in revision outcomes. */
export class SnapshotStoreError extends Error {
	readonly code: SnapshotStoreErrorCode;

	constructor(code: SnapshotStoreErrorCode, options?: ErrorOptions) {
		super(`Artwork snapshot storage failed (${code}).`, options);
		this.name = 'SnapshotStoreError';
		this.code = code;
	}
}

export interface StoreSnapshotInput {
	/** Normally the immutable `artwork_snapshots.id` stored in SQLite. */
	referenceId: string;
	bytes: Uint8Array;
}

export interface StoredSnapshot {
	referenceId: string;
	sha256: string;
	sizeBytes: number;
	/** Canonical content-addressed file. Safe to persist in `storage_path`. */
	storagePath: string;
	/** Owner-only hard link retaining this blob for the reference. */
	referencePath: string;
	referenceCount: number;
}

export interface StoreSnapshotResult extends StoredSnapshot {
	blobCreated: boolean;
	referenceCreated: boolean;
	deduplicated: boolean;
}

export interface SnapshotCleanupOptions {
	minimumAgeMs?: number;
	now?: Date;
}

export interface SnapshotCleanupResult {
	deleted: string[];
	retainedReferenced: string[];
	retainedYoung: string[];
	invalid: string[];
	temporaryDeleted: number;
	ignoredEntries: number;
}

interface SnapshotLayout {
	root: string;
	blobs: string;
	references: string;
	temporary: string;
}

interface BlobValidation {
	sha256: string;
	sizeBytes: number;
	stats: Stats;
}

const rootLocks = new Map<string, Promise<void>>();

function isErrno(error: unknown, code: string): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		(error as NodeJS.ErrnoException).code === code
	);
}

function validateReferenceId(referenceId: string): void {
	if (!REFERENCE_ID_PATTERN.test(referenceId)) {
		throw new SnapshotStoreError('invalid_reference_id');
	}
}

function validateDigest(sha256: string): void {
	if (!SHA256_PATTERN.test(sha256)) throw new SnapshotStoreError('invalid_digest');
}

export function sha256Snapshot(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

/** Derive the app-owned snapshot root without reading `$env`. */
export function resolveArtworkSnapshotDirectory(
	dataPaths: Pick<DataPaths, 'dataDirectory'>
): string {
	return join(dataPaths.dataDirectory, 'artwork-snapshots');
}

function layoutFor(rootDirectory: string): SnapshotLayout {
	const root = resolve(rootDirectory);
	return {
		root,
		blobs: join(root, 'blobs'),
		references: join(root, 'references'),
		temporary: join(root, '.tmp')
	};
}

async function withRootLock<T>(root: string, operation: () => Promise<T>): Promise<T> {
	const prior = rootLocks.get(root) ?? Promise.resolve();
	let release: (() => void) | undefined;
	const current = new Promise<void>((resolveLock) => {
		release = resolveLock;
	});
	const queued = prior.then(
		() => current,
		() => current
	);
	rootLocks.set(root, queued);

	await prior.catch(() => undefined);
	try {
		return await operation();
	} finally {
		release?.();
		if (rootLocks.get(root) === queued) rootLocks.delete(root);
	}
}

async function ensurePrivateDirectory(path: string): Promise<void> {
	await mkdir(path, { recursive: true, mode: DIRECTORY_MODE });
	const info = await lstat(path);
	if (!info.isDirectory() || info.isSymbolicLink()) {
		throw new SnapshotStoreError('unsafe_storage_layout');
	}
	await chmod(path, DIRECTORY_MODE);
}

async function ensureLayout(layout: SnapshotLayout): Promise<void> {
	await ensurePrivateDirectory(layout.root);
	await ensurePrivateDirectory(layout.blobs);
	await ensurePrivateDirectory(layout.references);
	await ensurePrivateDirectory(layout.temporary);
}

function blobPath(layout: SnapshotLayout, sha256: string): string {
	validateDigest(sha256);
	return join(layout.blobs, sha256.slice(0, 2), sha256);
}

function referenceKey(referenceId: string): string {
	validateReferenceId(referenceId);
	return createHash('sha256').update(referenceId).digest('hex');
}

function referencePath(layout: SnapshotLayout, referenceId: string): string {
	return join(layout.references, referenceKey(referenceId));
}

async function validateContentFile(path: string, expectedSha256: string): Promise<BlobValidation> {
	let info: Awaited<ReturnType<typeof lstat>>;
	try {
		info = await lstat(path);
	} catch (error) {
		if (isErrno(error, 'ENOENT')) throw new SnapshotStoreError('blob_not_found');
		throw error;
	}

	if (!info.isFile() || info.isSymbolicLink()) {
		throw new SnapshotStoreError('unsafe_storage_layout');
	}

	const bytes = await readFile(path);
	const actualSha256 = sha256Snapshot(bytes);
	if (actualSha256 !== expectedSha256) throw new SnapshotStoreError('blob_corrupt');

	return {
		sha256: actualSha256,
		sizeBytes: bytes.byteLength,
		stats: await stat(path)
	};
}

async function createBlob(
	layout: SnapshotLayout,
	sha256: string,
	bytes: Uint8Array
): Promise<{ created: boolean; validation: BlobValidation }> {
	const destination = blobPath(layout, sha256);
	await ensurePrivateDirectory(join(layout.blobs, sha256.slice(0, 2)));

	const temporary = join(layout.temporary, `${randomUUID()}.tmp`);
	let created = false;
	try {
		await writeFile(temporary, bytes, { flag: 'wx', mode: FILE_MODE });
		await chmod(temporary, FILE_MODE);
		try {
			await link(temporary, destination);
			created = true;
		} catch (error) {
			if (!isErrno(error, 'EEXIST')) throw error;
		}
	} finally {
		await unlink(temporary).catch((error) => {
			if (!isErrno(error, 'ENOENT')) throw error;
		});
	}

	const validation = await validateContentFile(destination, sha256);
	await chmod(destination, FILE_MODE);
	return { created, validation };
}

async function readReference(
	layout: SnapshotLayout,
	referenceId: string,
	expectedSha256: string,
	mismatchCode: Extract<
		SnapshotStoreErrorCode,
		'reference_conflict' | 'blob_corrupt'
	> = 'blob_corrupt'
): Promise<BlobValidation> {
	validateDigest(expectedSha256);
	const path = referencePath(layout, referenceId);
	let info: Awaited<ReturnType<typeof lstat>>;
	try {
		info = await lstat(path);
	} catch (error) {
		if (isErrno(error, 'ENOENT')) throw new SnapshotStoreError('reference_not_found');
		throw error;
	}

	if (!info.isFile() || info.isSymbolicLink()) {
		throw new SnapshotStoreError('unsafe_storage_layout');
	}

	const bytes = await readFile(path);
	const sha256 = sha256Snapshot(bytes);
	if (sha256 !== expectedSha256) {
		throw new SnapshotStoreError(mismatchCode);
	}
	await chmod(path, FILE_MODE);
	return { sha256, sizeBytes: bytes.byteLength, stats: await stat(path) };
}

async function storedSnapshot(
	layout: SnapshotLayout,
	referenceId: string,
	validation: BlobValidation
): Promise<StoredSnapshot> {
	const canonicalPath = blobPath(layout, validation.sha256);
	let canonical: BlobValidation;
	try {
		canonical = await validateContentFile(canonicalPath, validation.sha256);
	} catch (error) {
		if (!(error instanceof SnapshotStoreError) || error.code !== 'blob_not_found') throw error;
		// A retained hard link can repair a missing canonical name without copying bytes.
		await ensurePrivateDirectory(join(layout.blobs, validation.sha256.slice(0, 2)));
		try {
			await link(referencePath(layout, referenceId), canonicalPath);
		} catch (linkError) {
			if (!isErrno(linkError, 'EEXIST')) throw linkError;
		}
		canonical = await validateContentFile(canonicalPath, validation.sha256);
	}

	const referenceStats = validation.stats;
	if (canonical.stats.dev !== referenceStats.dev || canonical.stats.ino !== referenceStats.ino) {
		throw new SnapshotStoreError('reference_conflict');
	}

	return {
		referenceId,
		sha256: validation.sha256,
		sizeBytes: validation.sizeBytes,
		storagePath: canonicalPath,
		referencePath: referencePath(layout, referenceId),
		referenceCount: Math.max(0, canonical.stats.nlink - 1)
	};
}

async function publishReference(
	layout: SnapshotLayout,
	referenceId: string,
	sha256: string
): Promise<{ created: boolean; validation: BlobValidation }> {
	const path = referencePath(layout, referenceId);
	let created = false;
	try {
		await link(blobPath(layout, sha256), path);
		created = true;
	} catch (error) {
		if (!isErrno(error, 'EEXIST')) throw error;
	}

	const validation = await readReference(layout, referenceId, sha256, 'reference_conflict');
	return { created, validation };
}

async function cleanupTemporaryFiles(
	layout: SnapshotLayout,
	cutoffMs: number
): Promise<{ deleted: number; ignored: number }> {
	let deleted = 0;
	let ignored = 0;
	for (const entry of await readdir(layout.temporary, { withFileTypes: true })) {
		if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.tmp')) {
			ignored += 1;
			continue;
		}
		const path = join(layout.temporary, entry.name);
		const info = await lstat(path);
		if (info.mtimeMs > cutoffMs || info.nlink > 1) continue;
		await unlink(path);
		deleted += 1;
	}
	return { deleted, ignored };
}

/**
 * Filesystem-backed, content-addressed artwork storage.
 *
 * A reference is an owner-only hard link to the canonical SHA-256 object. The
 * filesystem link count therefore becomes an atomic reference count: storing
 * equal bytes creates one blob, releasing one snapshot cannot remove bytes held
 * by another snapshot, and cleanup only considers blobs with no retaining link.
 */
export class ArtworkSnapshotStore {
	readonly rootDirectory: string;
	readonly #layout: SnapshotLayout;

	constructor(rootDirectory: string) {
		if (!rootDirectory.trim()) throw new SnapshotStoreError('unsafe_storage_layout');
		this.#layout = layoutFor(rootDirectory);
		this.rootDirectory = this.#layout.root;
	}

	async store(input: StoreSnapshotInput): Promise<StoreSnapshotResult> {
		validateReferenceId(input.referenceId);
		const bytes = Buffer.from(input.bytes);
		const sha256 = sha256Snapshot(bytes);

		return withRootLock(this.#layout.root, async () => {
			await ensureLayout(this.#layout);
			const blob = await createBlob(this.#layout, sha256, bytes);
			const reference = await publishReference(this.#layout, input.referenceId, sha256);
			const stored = await storedSnapshot(this.#layout, input.referenceId, reference.validation);
			return {
				...stored,
				blobCreated: blob.created,
				referenceCreated: reference.created,
				deduplicated: !blob.created
			};
		});
	}

	async get(referenceId: string, expectedSha256: string): Promise<StoredSnapshot> {
		validateReferenceId(referenceId);
		validateDigest(expectedSha256);
		return withRootLock(this.#layout.root, async () => {
			await ensureLayout(this.#layout);
			const reference = await readReference(this.#layout, referenceId, expectedSha256);
			return storedSnapshot(this.#layout, referenceId, reference);
		});
	}

	async read(referenceId: string, expectedSha256: string): Promise<Buffer> {
		validateReferenceId(referenceId);
		validateDigest(expectedSha256);
		return withRootLock(this.#layout.root, async () => {
			await ensureLayout(this.#layout);
			const reference = await readReference(this.#layout, referenceId, expectedSha256);
			await storedSnapshot(this.#layout, referenceId, reference);
			return readFile(referencePath(this.#layout, referenceId));
		});
	}

	/**
	 * Release one durable snapshot reference. The blob is intentionally retained;
	 * a separate cleanup pass provides a grace period and rechecks link counts.
	 */
	async release(referenceId: string, expectedSha256: string): Promise<boolean> {
		validateReferenceId(referenceId);
		validateDigest(expectedSha256);

		return withRootLock(this.#layout.root, async () => {
			await ensureLayout(this.#layout);
			try {
				await readReference(this.#layout, referenceId, expectedSha256, 'reference_conflict');
			} catch (error) {
				if (error instanceof SnapshotStoreError && error.code === 'reference_not_found') {
					return false;
				}
				throw error;
			}
			await unlink(referencePath(this.#layout, referenceId));
			return true;
		});
	}

	/**
	 * Remove only valid, old, unreferenced content objects. Unknown/corrupt files
	 * are retained and reported. A quarantine rename plus a second link-count
	 * check prevents a reference created during cleanup from losing its bytes.
	 */
	async cleanup(options: SnapshotCleanupOptions = {}): Promise<SnapshotCleanupResult> {
		const minimumAgeMs = options.minimumAgeMs ?? DEFAULT_SNAPSHOT_CLEANUP_GRACE_MS;
		if (!Number.isFinite(minimumAgeMs) || minimumAgeMs < 0) {
			throw new SnapshotStoreError('invalid_cleanup_policy');
		}
		const nowMs = (options.now ?? new Date()).getTime();
		if (!Number.isFinite(nowMs)) throw new SnapshotStoreError('invalid_cleanup_policy');
		const cutoffMs = nowMs - minimumAgeMs;

		return withRootLock(this.#layout.root, async () => {
			await ensureLayout(this.#layout);
			const result: SnapshotCleanupResult = {
				deleted: [],
				retainedReferenced: [],
				retainedYoung: [],
				invalid: [],
				temporaryDeleted: 0,
				ignoredEntries: 0
			};

			for (const prefix of await readdir(this.#layout.blobs, { withFileTypes: true })) {
				if (
					!prefix.isDirectory() ||
					prefix.isSymbolicLink() ||
					!/^[a-f0-9]{2}$/.test(prefix.name)
				) {
					result.ignoredEntries += 1;
					continue;
				}
				const prefixPath = join(this.#layout.blobs, prefix.name);
				for (const entry of await readdir(prefixPath, { withFileTypes: true })) {
					if (
						!entry.isFile() ||
						entry.isSymbolicLink() ||
						!SHA256_PATTERN.test(entry.name) ||
						!entry.name.startsWith(prefix.name)
					) {
						result.ignoredEntries += 1;
						continue;
					}

					const path = join(prefixPath, entry.name);
					let validation: BlobValidation;
					try {
						validation = await validateContentFile(path, entry.name);
					} catch {
						result.invalid.push(entry.name);
						continue;
					}

					if (validation.stats.nlink > 1) {
						result.retainedReferenced.push(entry.name);
						continue;
					}
					if (validation.stats.mtimeMs > cutoffMs) {
						result.retainedYoung.push(entry.name);
						continue;
					}

					const quarantine = join(this.#layout.temporary, `${entry.name}-${randomUUID()}.tmp`);
					try {
						await rename(path, quarantine);
					} catch (error) {
						if (isErrno(error, 'ENOENT')) continue;
						throw error;
					}

					const quarantined = await lstat(quarantine);
					if (quarantined.nlink > 1) {
						try {
							await link(quarantine, path);
						} catch (error) {
							if (!isErrno(error, 'EEXIST')) throw error;
						}
						await unlink(quarantine);
						result.retainedReferenced.push(entry.name);
						continue;
					}

					await unlink(quarantine);
					result.deleted.push(entry.name);
				}
			}

			const temporary = await cleanupTemporaryFiles(this.#layout, cutoffMs);
			result.temporaryDeleted = temporary.deleted;
			result.ignoredEntries += temporary.ignored;
			result.deleted.sort();
			result.retainedReferenced.sort();
			result.retainedYoung.sort();
			result.invalid.sort();
			return result;
		});
	}
}
