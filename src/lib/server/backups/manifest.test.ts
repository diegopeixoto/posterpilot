import { describe, expect, it } from 'vitest';
import {
	BACKUP_FORMAT,
	BACKUP_FORMAT_VERSION,
	backupBundleName,
	buildBackupManifest,
	fingerprintEncryptionKey,
	serializeBackupManifest,
	sha256Bytes
} from './manifest';

describe('backup manifest helpers', () => {
	it('creates a filename-safe deterministic bundle name', () => {
		expect(backupBundleName(new Date('2026-07-10T12:34:56.789Z'), '123e4567-e89b-12d3-a456')).toBe(
			'20260710T123456789Z-123e4567-e89b-12d3-a456'
		);
		expect(() => backupBundleName(new Date(), '../escape')).toThrow(
			'backup id is not filename-safe'
		);
	});

	it('fingerprints key bytes without exposing them', () => {
		const key = Buffer.alloc(32, 7);
		const fingerprint = fingerprintEncryptionKey(key);

		expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
		expect(fingerprint).toBe(fingerprintEncryptionKey(key));
		expect(fingerprint).not.toContain(key.toString('hex'));
		expect(fingerprintEncryptionKey(Buffer.alloc(32, 8))).not.toBe(fingerprint);
	});

	it('builds a versioned, stably ordered manifest and exact serialized checksum', () => {
		const manifest = buildBackupManifest({
			backupId: 'backup-1',
			trigger: 'manual',
			createdAt: '2026-07-10T12:34:56.789Z',
			appVersion: '1.2.3',
			schemaVersion: '1234',
			snapshot: { method: 'vacuum_into', checkpointFallback: false },
			key: { mode: 'none', fingerprint: null, included: false },
			files: [
				{ path: 'z.conf', role: 'configuration', sizeBytes: 1, sha256: 'b'.repeat(64) },
				{ path: 'posterpilot.db', role: 'database', sizeBytes: 2, sha256: 'a'.repeat(64) }
			],
			externalPaths: [
				{ kind: 'other', path: '/z', expectedType: 'directory', reachable: false },
				{ kind: 'kometa_config', path: '/a', expectedType: 'file', reachable: true }
			]
		});
		const serialized = serializeBackupManifest(manifest);

		expect(manifest.format).toBe(BACKUP_FORMAT);
		expect(manifest.formatVersion).toBe(BACKUP_FORMAT_VERSION);
		expect(manifest.files.map((file) => file.path)).toEqual(['posterpilot.db', 'z.conf']);
		expect(manifest.externalPaths.map((path) => path.path)).toEqual(['/a', '/z']);
		expect(serialized.endsWith('\n')).toBe(true);
		expect(sha256Bytes(serialized)).toMatch(/^[a-f0-9]{64}$/);
	});
});
