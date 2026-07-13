import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { pathIsWithin } from '$lib/server/data-paths';
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION, type BackupManifestV1 } from './manifest';

const MANIFEST_FILE = 'manifest.json';
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_BUNDLE_ENTRIES = 10_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_BACKUP_ID = /^[A-Za-z0-9-]+$/;
const SAFE_VERSION = /^[A-Za-z0-9._+:-]+$/;
const SAFE_PAYLOAD_SEGMENT = /^[A-Za-z0-9._-]+$/;

export type BackupValidationStatus = 'valid' | 'warning' | 'invalid';

export type BackupValidationIssueCode =
	| 'bundle_missing'
	| 'bundle_not_directory'
	| 'manifest_missing'
	| 'manifest_too_large'
	| 'manifest_invalid'
	| 'manifest_checksum_mismatch'
	| 'backup_id_mismatch'
	| 'unsafe_payload_path'
	| 'payload_missing'
	| 'payload_size_mismatch'
	| 'payload_checksum_mismatch'
	| 'unexpected_payload'
	| 'payload_read_failed'
	| 'permissions_warning';

export interface BackupBundleValidation {
	status: BackupValidationStatus;
	issues: BackupValidationIssueCode[];
	manifest: BackupManifestV1 | null;
	manifestChecksum: string | null;
	sizeBytes: number | null;
	validatedAt: Date;
}

export interface ValidateBackupBundleOptions {
	expectedBackupId?: string;
	expectedManifestChecksum?: string | null;
	now?: Date;
}

const manifestFileSchema = z.strictObject({
	path: z.string().min(1).max(512),
	role: z.enum(['database', 'application_key', 'configuration']),
	sizeBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
	sha256: z.string().regex(SHA256_PATTERN)
});

const manifestSchema = z
	.strictObject({
		format: z.literal(BACKUP_FORMAT),
		formatVersion: z.literal(BACKUP_FORMAT_VERSION),
		backupId: z.string().regex(SAFE_BACKUP_ID),
		trigger: z.enum(['manual', 'scheduled', 'pre_restore']),
		createdAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
		appVersion: z.string().min(1).max(128).regex(SAFE_VERSION),
		schemaVersion: z.string().min(1).max(128).regex(SAFE_VERSION),
		snapshot: z.strictObject({
			method: z.literal('vacuum_into'),
			checkpointFallback: z.boolean()
		}),
		key: z.strictObject({
			mode: z.enum(['generated', 'environment', 'none']),
			fingerprint: z.string().regex(SHA256_PATTERN).nullable(),
			included: z.boolean()
		}),
		files: z.array(manifestFileSchema).min(1).max(MAX_BUNDLE_ENTRIES),
		externalPaths: z
			.array(
				z.strictObject({
					kind: z.enum(['kometa_assets', 'kometa_config', 'other']),
					path: z.string().max(4096),
					expectedType: z.enum(['file', 'directory']),
					reachable: z.boolean()
				})
			)
			.max(MAX_BUNDLE_ENTRIES)
	})
	.superRefine((manifest, context) => {
		const paths = new Set<string>();
		let databaseFiles = 0;
		let keyFiles = 0;
		for (const file of manifest.files) {
			if (!isSafePayloadPath(file.path) || file.path === MANIFEST_FILE) {
				context.addIssue({ code: 'custom', message: 'unsafe payload path' });
			}
			if (paths.has(file.path)) {
				context.addIssue({ code: 'custom', message: 'duplicate payload path' });
			}
			paths.add(file.path);
			if (file.role === 'database') databaseFiles++;
			if (file.role === 'application_key') keyFiles++;
		}

		if (databaseFiles !== 1) {
			context.addIssue({ code: 'custom', message: 'exactly one database is required' });
		}
		if (manifest.key.mode === 'generated') {
			if (!manifest.key.included || manifest.key.fingerprint === null || keyFiles !== 1) {
				context.addIssue({ code: 'custom', message: 'generated key metadata is inconsistent' });
			}
		} else if (manifest.key.included || keyFiles !== 0) {
			context.addIssue({ code: 'custom', message: 'non-generated key must not be included' });
		}
		if (manifest.key.mode === 'environment' && manifest.key.fingerprint === null) {
			context.addIssue({ code: 'custom', message: 'environment key fingerprint is required' });
		}
		if (manifest.key.mode === 'none' && manifest.key.fingerprint !== null) {
			context.addIssue({ code: 'custom', message: 'none key mode cannot have a fingerprint' });
		}
	});

function isSafePayloadPath(path: string): boolean {
	if (path === '' || path.includes('\0') || path.includes('\\') || isAbsolute(path)) return false;
	const segments = path.split('/');
	return segments.every(
		(segment) =>
			segment !== '' && segment !== '.' && segment !== '..' && SAFE_PAYLOAD_SEGMENT.test(segment)
	);
}

function pushUnique(issues: BackupValidationIssueCode[], issue: BackupValidationIssueCode): void {
	if (!issues.includes(issue)) issues.push(issue);
}

function validationResult(
	issues: BackupValidationIssueCode[],
	manifest: BackupManifestV1 | null,
	manifestChecksum: string | null,
	sizeBytes: number | null,
	validatedAt: Date
): BackupBundleValidation {
	return {
		status: issues.some((issue) => issue !== 'permissions_warning')
			? 'invalid'
			: issues.length > 0
				? 'warning'
				: 'valid',
		issues,
		manifest,
		manifestChecksum,
		sizeBytes,
		validatedAt
	};
}

async function sha256File(path: string): Promise<string> {
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
	return hash.digest('hex');
}

interface BundleEntryInventory {
	files: Set<string>;
	directories: Set<string>;
	unsafe: boolean;
}

async function inventoryBundle(directory: string): Promise<BundleEntryInventory> {
	const inventory: BundleEntryInventory = {
		files: new Set<string>(),
		directories: new Set<string>(),
		unsafe: false
	};
	let entriesSeen = 0;

	async function visit(current: string, prefix: string): Promise<void> {
		for (const entry of await readdir(current, { withFileTypes: true })) {
			entriesSeen++;
			if (entriesSeen > MAX_BUNDLE_ENTRIES) {
				inventory.unsafe = true;
				return;
			}
			const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
			const absolutePath = join(current, entry.name);
			if (entry.isSymbolicLink()) {
				inventory.unsafe = true;
				continue;
			}
			if (entry.isDirectory()) {
				inventory.directories.add(relativePath);
				await visit(absolutePath, relativePath);
			} else if (entry.isFile()) {
				inventory.files.add(relativePath);
			} else {
				inventory.unsafe = true;
			}
		}
	}

	await visit(directory, '');
	return inventory;
}

function allowedPayloadDirectories(manifest: BackupManifestV1): Set<string> {
	const directories = new Set<string>();
	for (const file of manifest.files) {
		let current = dirname(file.path);
		while (current !== '.') {
			directories.add(current.split(sep).join('/'));
			current = dirname(current);
		}
	}
	return directories;
}

function resolvesWithin(directory: string, payloadPath: string): boolean {
	const absolute = resolve(directory, payloadPath);
	if (!pathIsWithin(directory, absolute)) return false;
	const child = relative(resolve(directory), absolute);
	return child !== '' && child !== '..' && !child.startsWith(`..${sep}`);
}

/**
 * Validate the non-secret backup envelope and every declared payload byte.
 * SQLite/schema/key compatibility belong to restore preflight, not inventory validation.
 */
export async function validateBackupBundle(
	directory: string,
	options: ValidateBackupBundleOptions = {}
): Promise<BackupBundleValidation> {
	const validatedAt = options.now ?? new Date();
	const issues: BackupValidationIssueCode[] = [];
	let directoryStat;
	try {
		directoryStat = await lstat(directory);
	} catch {
		return validationResult(['bundle_missing'], null, null, null, validatedAt);
	}
	if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
		return validationResult(['bundle_not_directory'], null, null, null, validatedAt);
	}
	if ((directoryStat.mode & 0o077) !== 0) pushUnique(issues, 'permissions_warning');

	const manifestPath = join(directory, MANIFEST_FILE);
	let manifestStat;
	try {
		manifestStat = await lstat(manifestPath);
	} catch {
		return validationResult(['manifest_missing'], null, null, null, validatedAt);
	}
	if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
		return validationResult(['manifest_invalid'], null, null, null, validatedAt);
	}
	if (manifestStat.size > MAX_MANIFEST_BYTES) {
		return validationResult(['manifest_too_large'], null, null, null, validatedAt);
	}
	if ((manifestStat.mode & 0o077) !== 0) pushUnique(issues, 'permissions_warning');

	let manifestBytes: Buffer;
	let manifestChecksum: string;
	let manifest: BackupManifestV1;
	try {
		manifestBytes = await readFile(manifestPath);
		if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) {
			return validationResult(['manifest_too_large'], null, null, null, validatedAt);
		}
		manifestChecksum = createHash('sha256').update(manifestBytes).digest('hex');
		const parsed = manifestSchema.safeParse(JSON.parse(manifestBytes.toString('utf8')));
		if (!parsed.success) {
			return validationResult(['manifest_invalid'], null, manifestChecksum, null, validatedAt);
		}
		manifest = parsed.data;
	} catch {
		return validationResult(['manifest_invalid'], null, null, null, validatedAt);
	}

	if (options.expectedBackupId && manifest.backupId !== options.expectedBackupId) {
		pushUnique(issues, 'backup_id_mismatch');
	}
	if (options.expectedManifestChecksum && manifestChecksum !== options.expectedManifestChecksum) {
		pushUnique(issues, 'manifest_checksum_mismatch');
	}

	let inventory: BundleEntryInventory;
	try {
		inventory = await inventoryBundle(directory);
	} catch {
		return validationResult(['payload_read_failed'], manifest, manifestChecksum, null, validatedAt);
	}
	if (inventory.unsafe) pushUnique(issues, 'unsafe_payload_path');

	const expectedFiles = new Set([MANIFEST_FILE, ...manifest.files.map((file) => file.path)]);
	if ([...inventory.files].some((path) => !expectedFiles.has(path))) {
		pushUnique(issues, 'unexpected_payload');
	}
	const allowedDirectories = allowedPayloadDirectories(manifest);
	if ([...inventory.directories].some((path) => !allowedDirectories.has(path))) {
		pushUnique(issues, 'unexpected_payload');
	}

	let sizeBytes = manifestStat.size;
	for (const file of manifest.files) {
		if (!isSafePayloadPath(file.path) || !resolvesWithin(directory, file.path)) {
			pushUnique(issues, 'unsafe_payload_path');
			continue;
		}
		const path = join(directory, file.path);
		let stat;
		try {
			stat = await lstat(path);
		} catch {
			pushUnique(issues, 'payload_missing');
			continue;
		}
		if (!stat.isFile() || stat.isSymbolicLink()) {
			pushUnique(issues, 'unsafe_payload_path');
			continue;
		}
		sizeBytes += stat.size;
		if ((stat.mode & 0o077) !== 0) pushUnique(issues, 'permissions_warning');
		if (stat.size !== file.sizeBytes) pushUnique(issues, 'payload_size_mismatch');
		try {
			if ((await sha256File(path)) !== file.sha256) {
				pushUnique(issues, 'payload_checksum_mismatch');
			}
		} catch {
			pushUnique(issues, 'payload_read_failed');
		}
	}

	return validationResult(issues, manifest, manifestChecksum, sizeBytes, validatedAt);
}
