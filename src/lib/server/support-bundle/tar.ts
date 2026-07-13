const BLOCK = 512;

export interface MemoryTarEntry {
	name: string;
	content: Buffer;
}

function writeString(target: Buffer, value: string, offset: number, length: number): void {
	const encoded = Buffer.from(value, 'utf8');
	if (encoded.byteLength > length) throw new Error('support_bundle_path_too_long');
	encoded.copy(target, offset);
}

function writeOctal(target: Buffer, value: number, offset: number, length: number): void {
	writeString(
		target,
		`${Math.max(0, Math.trunc(value))
			.toString(8)
			.padStart(length - 1, '0')}\0`,
		offset,
		length
	);
}

function safeName(name: string): string {
	if (
		!name ||
		name.startsWith('/') ||
		name.includes('\\') ||
		name.split('/').some((segment) => segment === '' || segment === '.' || segment === '..') ||
		Buffer.byteLength(name, 'utf8') > 100
	) {
		throw new Error('support_bundle_unsafe_path');
	}
	return name;
}

function header(entry: MemoryTarEntry, modifiedAt: Date): Buffer {
	const output = Buffer.alloc(BLOCK);
	writeString(output, safeName(entry.name), 0, 100);
	writeOctal(output, 0o600, 100, 8);
	writeOctal(output, 0, 108, 8);
	writeOctal(output, 0, 116, 8);
	writeOctal(output, entry.content.byteLength, 124, 12);
	writeOctal(output, Math.floor(modifiedAt.getTime() / 1000), 136, 12);
	output.fill(0x20, 148, 156);
	output[156] = '0'.charCodeAt(0);
	writeString(output, 'ustar\0', 257, 6);
	writeString(output, '00', 263, 2);
	writeString(output, 'posterpilot', 265, 32);
	writeString(output, 'posterpilot', 297, 32);
	const checksum = output.reduce((sum, byte) => sum + byte, 0);
	writeString(output, `${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8);
	return output;
}

/** Deterministic in-memory tar for the deliberately small, bounded support payload. */
export function createMemoryTar(entries: MemoryTarEntry[], modifiedAt: Date): Buffer {
	const names = new Set<string>();
	const chunks: Buffer[] = [];
	for (const entry of entries) {
		if (names.has(entry.name)) throw new Error('support_bundle_duplicate_path');
		names.add(entry.name);
		chunks.push(header(entry, modifiedAt), entry.content);
		const remainder = entry.content.byteLength % BLOCK;
		if (remainder) chunks.push(Buffer.alloc(BLOCK - remainder));
	}
	chunks.push(Buffer.alloc(BLOCK * 2));
	return Buffer.concat(chunks);
}
