import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import type { BackupManifestV1 } from './manifest';

const TAR_BLOCK_BYTES = 512;
const TAR_END_BYTES = TAR_BLOCK_BYTES * 2;

interface TarEntry {
	name: string;
	path: string;
	sizeBytes: number;
	sha256: string;
}

export interface BackupTarArchive {
	stream: Readable;
	contentLength: number;
}

function writeTarString(target: Buffer, value: string, offset: number, length: number): void {
	const encoded = Buffer.from(value, 'utf8');
	if (encoded.byteLength > length) throw new Error('tar field is too long');
	encoded.copy(target, offset);
}

function writeTarOctal(target: Buffer, value: number, offset: number, length: number): void {
	const encoded = `${Math.max(0, Math.trunc(value))
		.toString(8)
		.padStart(length - 1, '0')}\0`;
	writeTarString(target, encoded, offset, length);
}

function splitTarPath(path: string): { name: string; prefix: string } {
	const encoded = Buffer.byteLength(path, 'utf8');
	if (encoded <= 100) return { name: path, prefix: '' };
	let current = dirname(path);
	while (current !== '.') {
		const name = path.slice(current.length + 1);
		if (Buffer.byteLength(name, 'utf8') <= 100 && Buffer.byteLength(current, 'utf8') <= 155) {
			return { name, prefix: current };
		}
		current = dirname(current);
	}
	throw new Error('backup payload path cannot be represented safely in tar');
}

function tarHeader(entry: TarEntry, modifiedAt: Date): Buffer {
	const header = Buffer.alloc(TAR_BLOCK_BYTES);
	const path = splitTarPath(entry.name);
	writeTarString(header, path.name, 0, 100);
	writeTarOctal(header, 0o600, 100, 8);
	writeTarOctal(header, 0, 108, 8);
	writeTarOctal(header, 0, 116, 8);
	writeTarOctal(header, entry.sizeBytes, 124, 12);
	writeTarOctal(header, Math.floor(modifiedAt.getTime() / 1000), 136, 12);
	header.fill(0x20, 148, 156);
	header[156] = '0'.charCodeAt(0);
	writeTarString(header, 'ustar\0', 257, 6);
	writeTarString(header, '00', 263, 2);
	writeTarString(header, 'posterpilot', 265, 32);
	writeTarString(header, 'posterpilot', 297, 32);
	writeTarOctal(header, 0, 329, 8);
	writeTarOctal(header, 0, 337, 8);
	if (path.prefix) writeTarString(header, path.prefix, 345, 155);
	const checksum = header.reduce((sum, byte) => sum + byte, 0);
	const checksumText = `${checksum.toString(8).padStart(6, '0')}\0 `;
	writeTarString(header, checksumText, 148, 8);
	return header;
}

function paddedSize(sizeBytes: number): number {
	return Math.ceil(sizeBytes / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES;
}

/** Stream exactly the validated manifest and declared payload; no server path is encoded. */
export async function createBackupTarArchive(
	directory: string,
	manifest: BackupManifestV1,
	manifestChecksum: string
): Promise<BackupTarArchive> {
	const manifestPath = join(directory, 'manifest.json');
	const manifestStat = await lstat(manifestPath);
	const entries: TarEntry[] = [
		{
			name: 'manifest.json',
			path: manifestPath,
			sizeBytes: manifestStat.size,
			sha256: manifestChecksum
		},
		...manifest.files.map((file) => ({
			name: file.path,
			path: join(directory, file.path),
			sizeBytes: file.sizeBytes,
			sha256: file.sha256
		}))
	];
	const modifiedAt = new Date(manifest.createdAt);
	const contentLength =
		entries.reduce((total, entry) => total + TAR_BLOCK_BYTES + paddedSize(entry.sizeBytes), 0) +
		TAR_END_BYTES;

	async function* archive(): AsyncGenerator<Buffer> {
		for (const entry of entries) {
			let streamed = 0;
			const hash = createHash('sha256');
			const handle = await open(entry.path, constants.O_RDONLY | constants.O_NOFOLLOW);
			try {
				const stat = await handle.stat();
				if (!stat.isFile() || stat.size !== entry.sizeBytes) {
					throw new Error('backup changed during export');
				}
				yield tarHeader(entry, modifiedAt);
				if (entry.sizeBytes > 0) {
					for await (const chunk of handle.createReadStream({
						autoClose: false,
						start: 0,
						end: entry.sizeBytes - 1
					})) {
						const bytes = chunk as Buffer;
						streamed += bytes.byteLength;
						hash.update(bytes);
						yield bytes;
					}
				}
			} finally {
				await handle.close();
			}
			if (streamed !== entry.sizeBytes || hash.digest('hex') !== entry.sha256) {
				throw new Error('backup changed during export');
			}
			const padding = paddedSize(streamed) - streamed;
			if (padding > 0) yield Buffer.alloc(padding);
		}
		yield Buffer.alloc(TAR_END_BYTES);
	}

	return { stream: Readable.from(archive()), contentLength };
}

export function backupExportFilename(backupId: string): string {
	const safeId = basename(backupId)
		.replace(/[^A-Za-z0-9-]/g, '')
		.slice(0, 80);
	return `posterpilot-backup-${safeId || 'bundle'}.tar`;
}
