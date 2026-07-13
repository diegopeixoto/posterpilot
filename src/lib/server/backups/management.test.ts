import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	renameSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveDataPaths, type DataPaths } from '$lib/server/data-paths';
import * as schema from '$lib/server/db/schema';
import { backupRecords } from '$lib/server/db/schema';
import {
	listBackupInventory,
	reconcileBackupInventory,
	validateBackupRecord,
	type BackupInventoryContext
} from './inventory';
import {
	deleteBackupRecord,
	prepareBackupExport,
	runConfiguredBackupRetention
} from './management';
import {
	backupBundleName,
	buildBackupManifest,
	serializeBackupManifest,
	sha256Bytes,
	type BackupManifestV1,
	type BackupTrigger
} from './manifest';
import { getBackupRetentionPolicy, updateBackupRetentionPolicy } from './policy';
import { validateBackupBundle } from './validation';

interface TestBundle {
	id: string;
	bundleName: string;
	directory: string;
	payloadPath: string;
	manifest: BackupManifestV1;
}

let directory: string;
let client: Client;
let database: LibSQLDatabase<typeof schema>;
let dataPaths: DataPaths;
let context: BackupInventoryContext;

async function createTables(): Promise<void> {
	await client.execute(`
		CREATE TABLE backup_records (
			id TEXT PRIMARY KEY NOT NULL,
			trigger TEXT NOT NULL,
			status TEXT DEFAULT 'creating' NOT NULL,
			bundle_name TEXT NOT NULL UNIQUE,
			storage_path TEXT NOT NULL,
			manifest TEXT,
			app_version TEXT,
			schema_version TEXT,
			key_mode TEXT,
			key_fingerprint TEXT,
			size_bytes INTEGER,
			checksum TEXT,
			protected INTEGER DEFAULT 0 NOT NULL,
			validation_status TEXT DEFAULT 'unknown' NOT NULL,
			error_code TEXT,
			error TEXT,
			created_at INTEGER NOT NULL,
			completed_at INTEGER,
			validated_at INTEGER,
			deleted_at INTEGER
		)
	`);
	await client.execute(
		'CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)'
	);
}

function writeBundle(id: string, trigger: BackupTrigger, createdAt: Date): TestBundle {
	mkdirSync(dataPaths.backupsDirectory, { recursive: true, mode: 0o700 });
	chmodSync(dataPaths.backupsDirectory, 0o700);
	const bundleName = backupBundleName(createdAt, id);
	const bundleDirectory = join(dataPaths.backupsDirectory, bundleName);
	mkdirSync(bundleDirectory, { mode: 0o700 });
	const payload = Buffer.from(`sqlite-snapshot:${id}`);
	const payloadPath = join(bundleDirectory, 'posterpilot.db');
	writeFileSync(payloadPath, payload, { mode: 0o600 });
	const manifest = buildBackupManifest({
		backupId: id,
		trigger,
		createdAt: createdAt.toISOString(),
		appVersion: '1.2.3',
		schemaVersion: '123456789',
		snapshot: { method: 'vacuum_into', checkpointFallback: false },
		key: { mode: 'none', fingerprint: null, included: false },
		files: [
			{
				path: 'posterpilot.db',
				role: 'database',
				sizeBytes: payload.byteLength,
				sha256: sha256Bytes(payload)
			}
		],
		externalPaths: [
			{
				kind: 'kometa_assets',
				path: '/mnt/private/kometa',
				expectedType: 'directory',
				reachable: true
			}
		]
	});
	writeFileSync(join(bundleDirectory, 'manifest.json'), serializeBackupManifest(manifest), {
		mode: 0o600
	});
	return { id, bundleName, directory: bundleDirectory, payloadPath, manifest };
}

async function streamBytes(stream: Readable): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
	return Buffer.concat(chunks);
}

function tarEntries(archive: Buffer): Map<string, Buffer> {
	const entries = new Map<string, Buffer>();
	let offset = 0;
	while (offset + 512 <= archive.byteLength) {
		const header = archive.subarray(offset, offset + 512);
		if (header.every((byte) => byte === 0)) break;
		const stringField = (start: number, length: number) =>
			header
				.subarray(start, start + length)
				.toString('utf8')
				.replace(/\0.*$/, '');
		const name = stringField(0, 100);
		const prefix = stringField(345, 155);
		const size = Number.parseInt(stringField(124, 12).trim() || '0', 8);
		const fullName = prefix ? `${prefix}/${name}` : name;
		const contentStart = offset + 512;
		entries.set(fullName, archive.subarray(contentStart, contentStart + size));
		offset = contentStart + Math.ceil(size / 512) * 512;
	}
	return entries;
}

beforeEach(async () => {
	directory = mkdtempSync(join(tmpdir(), 'posterpilot-backup-management-'));
	client = createClient({ url: `file:${join(directory, 'inventory.db')}` });
	database = drizzle(client, { schema });
	dataPaths = resolveDataPaths(`file:${join(directory, 'posterpilot.db')}`);
	context = { database, dataPaths };
	await createTables();
});

afterEach(() => {
	client.close();
	rmSync(directory, { recursive: true, force: true });
});

describe('backup validation and inventory', () => {
	it('detects payload tampering and unexpected files without exposing paths', async () => {
		const bundle = writeBundle('backup-tamper', 'manual', new Date('2026-07-10T10:00:00.000Z'));
		expect((await validateBackupBundle(bundle.directory)).status).toBe('valid');

		writeFileSync(bundle.payloadPath, 'changed-after-manifest', { mode: 0o600 });
		const tampered = await validateBackupBundle(bundle.directory);
		expect(tampered.status).toBe('invalid');
		expect(tampered.issues).toContain('payload_checksum_mismatch');

		writeFileSync(join(bundle.directory, 'untracked-secret'), 'not in manifest', { mode: 0o600 });
		const unexpected = await validateBackupBundle(bundle.directory);
		expect(unexpected.issues).toContain('unexpected_payload');
		expect(JSON.stringify(unexpected)).not.toContain(directory);
	});

	it('adopts valid orphan bundles, persists validation, flags triggers, and sorts newest first', async () => {
		const manual = writeBundle('backup-manual', 'manual', new Date('2026-07-09T10:00:00.000Z'));
		const scheduled = writeBundle(
			'backup-scheduled',
			'scheduled',
			new Date('2026-07-10T10:00:00.000Z')
		);

		const inventory = await listBackupInventory(context);
		expect(inventory.map((item) => item.id)).toEqual([scheduled.id, manual.id]);
		expect(inventory[0]).toMatchObject({
			trigger: 'scheduled',
			protected: false,
			isManual: false,
			isSafety: false,
			validationStatus: 'valid'
		});
		expect(inventory[1]).toMatchObject({
			trigger: 'manual',
			protected: true,
			isManual: true,
			isSafety: false,
			validationStatus: 'valid'
		});
		const serialized = JSON.stringify(inventory);
		expect(serialized).not.toContain(directory);
		expect(serialized).not.toContain('/mnt/private/kometa');

		writeFileSync(scheduled.payloadPath, 'tampered', { mode: 0o600 });
		const validation = await validateBackupRecord(context, scheduled.id);
		expect(validation.item).toMatchObject({ status: 'invalid', validationStatus: 'invalid' });
		const persisted = (
			await database.select().from(backupRecords).where(eq(backupRecords.id, scheduled.id))
		)[0];
		expect(persisted?.errorCode).toBe('payload_size_mismatch');
	});
});

describe('backup retention and deletion protection', () => {
	it('rejects a zero-day age window while allowing null to disable age pruning', async () => {
		await expect(updateBackupRetentionPolicy(database, { maxAgeDays: 0 })).rejects.toMatchObject({
			code: 'retention_policy_invalid',
			status: 400
		});
		expect(await updateBackupRetentionPolicy(database, { maxAgeDays: null })).toEqual({
			maxCount: null,
			maxAgeDays: null
		});
	});

	it('combines count and age while retaining manual and safety backups', async () => {
		const now = new Date('2026-07-10T12:00:00.000Z');
		const recent = writeBundle('scheduled-recent', 'scheduled', new Date('2026-07-09T12:00:00Z'));
		const middle = writeBundle('scheduled-middle', 'scheduled', new Date('2026-07-08T12:00:00Z'));
		const old = writeBundle('scheduled-old', 'scheduled', new Date('2026-06-01T12:00:00Z'));
		const manual = writeBundle('manual-old', 'manual', new Date('2026-05-01T12:00:00Z'));
		const safety = writeBundle('safety-old', 'pre_restore', new Date('2026-04-01T12:00:00Z'));
		await reconcileBackupInventory(context);
		await updateBackupRetentionPolicy(database, { maxCount: 1, maxAgeDays: 10 });

		const result = await runConfiguredBackupRetention(context, now);
		expect(result.deletedIds).toEqual([old.id, middle.id]);
		expect(result.skippedIds).toEqual([]);
		expect(result.failedIds).toEqual([]);
		expect(existsSync(old.directory)).toBe(false);
		expect(existsSync(middle.directory)).toBe(false);
		expect(existsSync(recent.directory)).toBe(true);
		expect(existsSync(manual.directory)).toBe(true);
		expect(existsSync(safety.directory)).toBe(true);
		expect(await getBackupRetentionPolicy(database)).toEqual({ maxCount: 1, maxAgeDays: 10 });
	});

	it('revalidates candidates and skips a tampered directory instead of pruning it', async () => {
		const now = new Date('2026-07-10T12:00:00.000Z');
		writeBundle('retention-recent', 'scheduled', new Date('2026-07-09T12:00:00Z'));
		const middle = writeBundle('retention-middle', 'scheduled', new Date('2026-07-08T12:00:00Z'));
		const old = writeBundle('retention-tampered', 'scheduled', new Date('2026-07-01T12:00:00Z'));
		await reconcileBackupInventory(context);
		await updateBackupRetentionPolicy(database, { maxCount: 1 });
		writeFileSync(old.payloadPath, 'tampered', { mode: 0o600 });

		const result = await runConfiguredBackupRetention(context, now);
		expect(result.deletedIds).toEqual([middle.id]);
		expect(result.skippedIds).toEqual([old.id]);
		expect(existsSync(old.directory)).toBe(true);
		const record = (
			await database.select().from(backupRecords).where(eq(backupRecords.id, old.id))
		)[0];
		expect(record).toMatchObject({ status: 'invalid', validationStatus: 'invalid' });
	});

	it('requires a separate confirmation before deleting a protected bundle', async () => {
		const manual = writeBundle('manual-protected', 'manual', new Date('2026-07-10T10:00:00Z'));
		await reconcileBackupInventory(context);

		await expect(deleteBackupRecord(context, manual.id, { confirm: true })).rejects.toMatchObject({
			code: 'protected_backup_confirmation_required',
			status: 409
		});
		expect(existsSync(manual.directory)).toBe(true);

		expect(
			await deleteBackupRecord(context, manual.id, {
				confirm: true,
				confirmProtected: true
			})
		).toEqual({ id: manual.id, deleted: true });
		expect(existsSync(manual.directory)).toBe(false);
	});

	it('finishes an interrupted deletion from its stable quarantine', async () => {
		const bundle = writeBundle('delete-retry', 'scheduled', new Date('2026-07-10T10:00:00Z'));
		await reconcileBackupInventory(context);
		const quarantine = join(dataPaths.backupsDirectory, `.deleting-${bundle.bundleName}`);
		renameSync(bundle.directory, quarantine);

		expect(await deleteBackupRecord(context, bundle.id, { confirm: true })).toEqual({
			id: bundle.id,
			deleted: true
		});
		expect(existsSync(quarantine)).toBe(false);
	});
});

describe('safe backup export', () => {
	it('requires explicit acknowledgement and streams only the validated bundle', async () => {
		const bundle = writeBundle('backup-export', 'scheduled', new Date('2026-07-10T10:00:00Z'));
		await reconcileBackupInventory(context);

		await expect(prepareBackupExport(context, bundle.id, false)).rejects.toMatchObject({
			code: 'backup_export_confirmation_required',
			status: 409
		});

		const exported = await prepareBackupExport(context, bundle.id, true);
		const bytes = await streamBytes(exported.stream);
		const entries = tarEntries(bytes);
		expect(bytes.byteLength).toBe(exported.contentLength);
		expect([...entries.keys()]).toEqual(['manifest.json', 'posterpilot.db']);
		expect(entries.get('posterpilot.db')?.toString('utf8')).toBe(`sqlite-snapshot:${bundle.id}`);
		expect(exported.filename).toBe(`posterpilot-backup-${bundle.id}.tar`);
		expect([...entries.keys()].join()).not.toContain(directory);
	});

	it('blocks export after tampering and persists the invalid result', async () => {
		const bundle = writeBundle(
			'backup-export-tampered',
			'scheduled',
			new Date('2026-07-10T10:00:00Z')
		);
		await reconcileBackupInventory(context);
		writeFileSync(bundle.payloadPath, 'tampered', { mode: 0o600 });

		await expect(prepareBackupExport(context, bundle.id, true)).rejects.toMatchObject({
			code: 'backup_not_exportable',
			status: 409
		});
		const record = (
			await database.select().from(backupRecords).where(eq(backupRecords.id, bundle.id))
		)[0];
		expect(record).toMatchObject({ status: 'invalid', validationStatus: 'invalid' });
	});

	it('aborts an export stream if a payload changes after pre-export validation', async () => {
		const bundle = writeBundle('backup-export-race', 'scheduled', new Date('2026-07-10T10:00:00Z'));
		await reconcileBackupInventory(context);
		const exported = await prepareBackupExport(context, bundle.id, true);
		const originalLength = Buffer.byteLength(`sqlite-snapshot:${bundle.id}`);
		writeFileSync(bundle.payloadPath, Buffer.alloc(originalLength, 0x78), { mode: 0o600 });

		await expect(streamBytes(exported.stream)).rejects.toThrow('backup changed during export');
	});
});
