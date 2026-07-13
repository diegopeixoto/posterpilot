import { createHash } from 'node:crypto';

export const BACKUP_FORMAT = 'posterpilot-backup';
export const BACKUP_FORMAT_VERSION = 1;

export type BackupTrigger = 'manual' | 'scheduled' | 'pre_restore';
export type BackupKeyMode = 'generated' | 'environment' | 'none';

export interface BackupManifestFile {
	path: string;
	role: 'database' | 'application_key' | 'configuration';
	sizeBytes: number;
	sha256: string;
}

export interface BackupManifestExternalPath {
	kind: 'kometa_assets' | 'kometa_config' | 'other';
	path: string;
	expectedType: 'file' | 'directory';
	reachable: boolean;
}

export interface BackupManifestV1 {
	format: typeof BACKUP_FORMAT;
	formatVersion: typeof BACKUP_FORMAT_VERSION;
	backupId: string;
	trigger: BackupTrigger;
	createdAt: string;
	appVersion: string;
	schemaVersion: string;
	snapshot: {
		method: 'vacuum_into';
		checkpointFallback: boolean;
	};
	key: {
		mode: BackupKeyMode;
		fingerprint: string | null;
		included: boolean;
	};
	files: BackupManifestFile[];
	externalPaths: BackupManifestExternalPath[];
}

export function sha256Bytes(bytes: Uint8Array | string): string {
	return createHash('sha256').update(bytes).digest('hex');
}

/** A domain-separated, non-reversible identity for the active encryption key. */
export function fingerprintEncryptionKey(key: Uint8Array): string {
	const hash = createHash('sha256');
	hash.update('posterpilot:backup-key-fingerprint:v1\0');
	hash.update(key);
	return hash.digest('hex');
}

/** Stable owner-controlled name; never contains a title, path, or credential. */
export function backupBundleName(createdAt: Date, backupId: string): string {
	if (!/^[A-Za-z0-9-]+$/.test(backupId)) throw new Error('backup id is not filename-safe');
	const stamp = createdAt.toISOString().replace(/[-:.]/g, '');
	return `${stamp}-${backupId}`;
}

export function buildBackupManifest(
	input: Omit<BackupManifestV1, 'format' | 'formatVersion'>
): BackupManifestV1 {
	return {
		format: BACKUP_FORMAT,
		formatVersion: BACKUP_FORMAT_VERSION,
		...input,
		files: [...input.files].sort((a, b) => a.path.localeCompare(b.path)),
		externalPaths: [...input.externalPaths].sort((a, b) =>
			`${a.kind}:${a.path}`.localeCompare(`${b.kind}:${b.path}`)
		)
	};
}

/** Exact bytes persisted as manifest.json and checksummed in the backup record. */
export function serializeBackupManifest(manifest: BackupManifestV1): string {
	return `${JSON.stringify(manifest, null, 2)}\n`;
}
