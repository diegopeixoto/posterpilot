/**
 * Read-only checks that multiple output paths refer to distinct filesystem
 * targets. This intentionally does not create missing directories or files.
 */

import { lstatSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';

export type PhysicalPathAliasKind = 'canonical_path' | 'file_identity';

/** Safe conflict details: callers can map indexes back to their own labels. */
export interface PhysicalPathAliasConflict {
	kind: PhysicalPathAliasKind;
	firstIndex: number;
	secondIndex: number;
}

export type PhysicalPathInspectionErrorCode =
	| 'inspection_failed'
	| 'invalid_path'
	| 'invalid_target_type'
	| 'path_changed';

const FROZEN_PHYSICAL_PATH_VERSION = 1 as const;

/**
 * Serializable binding between a logical destination and the canonical name
 * authorized at preview time. The directory anchor detects later ancestor
 * replacement while still allowing a missing suffix to be created safely.
 */
export interface FrozenPhysicalPath {
	readonly version: typeof FROZEN_PHYSICAL_PATH_VERSION;
	readonly canonicalPath: string;
	readonly anchorPath: string;
	readonly anchorDevice: string;
	readonly anchorInode: string;
}

export interface FrozenPhysicalPathInspection {
	canonicalPath: string;
	exists: boolean;
	identity: string | null;
}

/**
 * An input could not be proven safe to compare. The path itself is omitted so
 * this error can cross internal boundaries without disclosing host paths.
 */
export class PhysicalPathInspectionError extends Error {
	constructor(
		readonly code: PhysicalPathInspectionErrorCode,
		readonly pathIndex: number,
		options: ErrorOptions = {}
	) {
		super(`Physical path inspection failed: ${code}`, options);
		this.name = 'PhysicalPathInspectionError';
	}
}

interface InspectedPath {
	canonicalPath: string;
	identity: string | null;
}

interface DirectoryIdentity {
	device: string;
	inode: string;
}

function errorCode(error: unknown): string | null {
	return error instanceof Error && 'code' in error && typeof error.code === 'string'
		? error.code
		: null;
}

function fail(code: PhysicalPathInspectionErrorCode, pathIndex: number, cause?: unknown): never {
	throw new PhysicalPathInspectionError(code, pathIndex, { cause });
}

function validateAbsolutePath(path: unknown, pathIndex: number): string {
	if (typeof path !== 'string' || path.length === 0 || path.includes('\0') || !isAbsolute(path)) {
		fail('invalid_path', pathIndex);
	}
	return normalize(path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function identity(device: bigint, inode: bigint): string {
	return `${device.toString()}:${inode.toString()}`;
}

function invalidFsPath(code: string | null): boolean {
	return code === 'ENOTDIR' || code === 'EINVAL' || code === 'ENAMETOOLONG';
}

/**
 * Resolve aliases through the deepest existing ancestor. Missing suffixes are
 * appended to that ancestor's real path so future targets can still be
 * compared. An existing node that cannot be resolved (for example a dangling
 * symlink) is rejected instead of being treated as absent.
 */
function canonicalizePath(
	path: string,
	pathIndex: number
): {
	canonicalPath: string;
	targetExisted: boolean;
} {
	let cursor = path;
	const missingSuffix: string[] = [];

	while (true) {
		try {
			const existingPath = realpathSync.native(cursor);
			return {
				canonicalPath: join(existingPath, ...missingSuffix),
				targetExisted: missingSuffix.length === 0
			};
		} catch (error) {
			const code = errorCode(error);
			if (invalidFsPath(code)) {
				fail('invalid_path', pathIndex, error);
			}
			if (code !== 'ENOENT') fail('inspection_failed', pathIndex, error);

			let unresolvedNodeExists = false;
			try {
				lstatSync(cursor);
				unresolvedNodeExists = true;
			} catch (lstatError) {
				const lstatCode = errorCode(lstatError);
				if (invalidFsPath(lstatCode)) {
					fail('invalid_path', pathIndex, lstatError);
				}
				if (lstatCode !== 'ENOENT') fail('inspection_failed', pathIndex, lstatError);
			}
			if (unresolvedNodeExists) fail('inspection_failed', pathIndex, error);

			const parent = dirname(cursor);
			if (parent === cursor) fail('inspection_failed', pathIndex, error);
			missingSuffix.unshift(basename(cursor));
			cursor = parent;
		}
	}
}

function inspectPath(path: unknown, pathIndex: number): InspectedPath {
	const absolutePath = validateAbsolutePath(path, pathIndex);
	const { canonicalPath, targetExisted } = canonicalizePath(absolutePath, pathIndex);

	try {
		const stats = statSync(canonicalPath, { bigint: true });
		if (!stats.isFile()) fail('invalid_target_type', pathIndex);
		return {
			canonicalPath,
			identity: identity(stats.dev, stats.ino)
		};
	} catch (error) {
		if (error instanceof PhysicalPathInspectionError) throw error;
		const code = errorCode(error);
		if (code === 'ENOENT' && !targetExisted) return { canonicalPath, identity: null };
		if (invalidFsPath(code)) {
			fail('invalid_path', pathIndex, error);
		}
		fail('inspection_failed', pathIndex, error);
	}
}

function inspectDirectory(path: string, pathIndex: number): DirectoryIdentity {
	let stats: ReturnType<typeof lstatSync>;
	try {
		stats = lstatSync(path, { bigint: true });
	} catch (error) {
		const code = errorCode(error);
		if (code === 'ENOENT' || invalidFsPath(code)) fail('path_changed', pathIndex, error);
		fail('inspection_failed', pathIndex, error);
	}
	if (stats.isSymbolicLink() || !stats.isDirectory()) {
		fail('path_changed', pathIndex);
	}
	try {
		if (realpathSync.native(path) !== path) fail('path_changed', pathIndex);
	} catch (error) {
		if (error instanceof PhysicalPathInspectionError) throw error;
		const code = errorCode(error);
		if (code === 'ENOENT' || invalidFsPath(code)) fail('path_changed', pathIndex, error);
		fail('inspection_failed', pathIndex, error);
	}
	return { device: stats.dev.toString(), inode: stats.ino.toString() };
}

function findExistingDirectoryAnchor(
	canonicalPath: string,
	pathIndex: number
): {
	path: string;
	identity: DirectoryIdentity;
} {
	let cursor = dirname(canonicalPath);
	while (true) {
		try {
			const stats = lstatSync(cursor, { bigint: true });
			if (stats.isSymbolicLink() || !stats.isDirectory()) fail('invalid_path', pathIndex);
			const resolved = realpathSync.native(cursor);
			if (resolved !== cursor) fail('inspection_failed', pathIndex);
			return {
				path: cursor,
				identity: { device: stats.dev.toString(), inode: stats.ino.toString() }
			};
		} catch (error) {
			if (error instanceof PhysicalPathInspectionError) throw error;
			const code = errorCode(error);
			if (code !== 'ENOENT') {
				if (invalidFsPath(code)) fail('invalid_path', pathIndex, error);
				fail('inspection_failed', pathIndex, error);
			}
			const parent = dirname(cursor);
			if (parent === cursor) fail('inspection_failed', pathIndex, error);
			cursor = parent;
		}
	}
}

/** Freeze one absolute path to its canonical name and existing directory anchor. */
export function freezePhysicalPath(path: string): FrozenPhysicalPath {
	const inspected = inspectPath(path, 0);
	const anchor = findExistingDirectoryAnchor(inspected.canonicalPath, 0);
	return {
		version: FROZEN_PHYSICAL_PATH_VERSION,
		canonicalPath: inspected.canonicalPath,
		anchorPath: anchor.path,
		anchorDevice: anchor.identity.device,
		anchorInode: anchor.identity.inode
	};
}

function validateBindingStructure(
	value: unknown,
	pathIndex: number
): { binding: FrozenPhysicalPath; suffix: string } {
	if (
		!isRecord(value) ||
		Object.keys(value).sort().join('\0') !==
			['anchorDevice', 'anchorInode', 'anchorPath', 'canonicalPath', 'version'].join('\0') ||
		value.version !== FROZEN_PHYSICAL_PATH_VERSION ||
		typeof value.anchorDevice !== 'string' ||
		value.anchorDevice.length > 64 ||
		!/^(?:0|[1-9][0-9]*)$/.test(value.anchorDevice) ||
		typeof value.anchorInode !== 'string' ||
		value.anchorInode.length > 64 ||
		!/^(?:0|[1-9][0-9]*)$/.test(value.anchorInode)
	) {
		fail('invalid_path', pathIndex);
	}
	const binding = value as unknown as FrozenPhysicalPath;
	const canonicalPath = validateAbsolutePath(binding.canonicalPath, pathIndex);
	const anchorPath = validateAbsolutePath(binding.anchorPath, pathIndex);
	if (canonicalPath !== binding.canonicalPath || anchorPath !== binding.anchorPath) {
		fail('invalid_path', pathIndex);
	}
	const suffix = relative(anchorPath, canonicalPath);
	if (
		suffix.length === 0 ||
		isAbsolute(suffix) ||
		suffix === '..' ||
		suffix.startsWith(`..${sep}`)
	) {
		fail('invalid_path', pathIndex);
	}
	return { binding, suffix };
}

/** Validate a serialized binding without reading or mutating the filesystem. */
export function validateFrozenPhysicalPath(value: unknown): FrozenPhysicalPath {
	return validateBindingStructure(value, 0).binding;
}

/**
 * Revalidate a frozen binding without following its final component. Existing
 * intermediate components must be real directories; a missing suffix remains
 * a valid not-yet-created target.
 */
export function inspectFrozenPhysicalPath(
	binding: FrozenPhysicalPath,
	pathIndex = 0
): FrozenPhysicalPathInspection {
	const { binding: validatedBinding, suffix } = validateBindingStructure(binding, pathIndex);
	binding = validatedBinding;
	const anchor = inspectDirectory(binding.anchorPath, pathIndex);
	if (anchor.device !== binding.anchorDevice || anchor.inode !== binding.anchorInode) {
		fail('path_changed', pathIndex);
	}

	const segments = suffix.split(sep);
	let cursor = binding.anchorPath;
	for (const segment of segments.slice(0, -1)) {
		cursor = join(cursor, segment);
		try {
			const stats = lstatSync(cursor, { bigint: true });
			if (stats.isSymbolicLink() || !stats.isDirectory()) fail('path_changed', pathIndex);
		} catch (error) {
			if (error instanceof PhysicalPathInspectionError) throw error;
			const code = errorCode(error);
			if (code === 'ENOENT') {
				return { canonicalPath: binding.canonicalPath, exists: false, identity: null };
			}
			if (invalidFsPath(code)) fail('path_changed', pathIndex, error);
			fail('inspection_failed', pathIndex, error);
		}
	}

	try {
		const stats = lstatSync(binding.canonicalPath, { bigint: true });
		if (stats.isSymbolicLink()) fail('path_changed', pathIndex);
		if (!stats.isFile()) fail('invalid_target_type', pathIndex);
		return {
			canonicalPath: binding.canonicalPath,
			exists: true,
			identity: identity(stats.dev, stats.ino)
		};
	} catch (error) {
		if (error instanceof PhysicalPathInspectionError) throw error;
		const code = errorCode(error);
		if (code === 'ENOENT') {
			return { canonicalPath: binding.canonicalPath, exists: false, identity: null };
		}
		if (invalidFsPath(code)) fail('path_changed', pathIndex, error);
		fail('inspection_failed', pathIndex, error);
	}
}

/**
 * Find the first pair of paths that refer to the same physical target.
 *
 * Canonical collisions include textual duplicates and aliases through
 * symlinked ancestors, including targets that do not exist yet. Existing files
 * are also compared by device and inode to detect hard links. All inputs are
 * inspected before a conflict is returned so a later inspection error cannot
 * be hidden by an earlier duplicate.
 */
export function findPhysicalPathAliasConflict(
	paths: readonly string[]
): PhysicalPathAliasConflict | null {
	if (!Array.isArray(paths)) fail('invalid_path', -1);
	const inspected = paths.map((path, index) => inspectPath(path, index));

	const canonicalPaths = new Map<string, number>();
	for (const [index, entry] of inspected.entries()) {
		const firstIndex = canonicalPaths.get(entry.canonicalPath);
		if (firstIndex !== undefined) {
			return { kind: 'canonical_path', firstIndex, secondIndex: index };
		}
		canonicalPaths.set(entry.canonicalPath, index);
	}

	const identities = new Map<string, number>();
	for (const [index, entry] of inspected.entries()) {
		if (entry.identity === null) continue;
		const firstIndex = identities.get(entry.identity);
		if (firstIndex !== undefined) {
			return { kind: 'file_identity', firstIndex, secondIndex: index };
		}
		identities.set(entry.identity, index);
	}

	return null;
}
