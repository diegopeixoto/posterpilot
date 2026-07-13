import { createHash } from 'node:crypto';
import { sanitizeSupportEntry, UnsafeSupportEntryError } from './sanitize';
import { createMemoryTar, type MemoryTarEntry } from './tar';

export interface SupportBundleSource {
	path: string;
	value: unknown;
	optional?: boolean;
}

export interface SupportBundleManifest {
	format: 'posterpilot-support-v1';
	generatedAt: string;
	appVersion: string;
	titlesIncluded: boolean;
	contents: { path: string; sizeBytes: number; sha256: string }[];
	omissions: { path: string; reason: string }[];
}

export interface BuiltSupportBundle {
	bytes: Buffer;
	filename: string;
	manifest: SupportBundleManifest;
}

function jsonBytes(value: unknown): Buffer {
	return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function checksum(content: Buffer): string {
	return createHash('sha256').update(content).digest('hex');
}

function safeFilename(date: Date): string {
	return `posterpilot-support-${date.toISOString().replace(/[:.]/g, '-').slice(0, 19)}Z.tar`;
}

/** Build a manifest-bearing archive, omitting optional entries that cannot be proven safe. */
export function buildSupportBundle(input: {
	appVersion: string;
	generatedAt: Date;
	includeTitles: boolean;
	secrets?: readonly string[];
	sources: SupportBundleSource[];
}): BuiltSupportBundle {
	const entries: MemoryTarEntry[] = [];
	const contents: SupportBundleManifest['contents'] = [];
	const omissions: SupportBundleManifest['omissions'] = [];
	for (const source of input.sources) {
		try {
			const value = sanitizeSupportEntry(source.value, input.secrets ?? []);
			const content = jsonBytes(value);
			entries.push({ name: source.path, content });
			contents.push({
				path: source.path,
				sizeBytes: content.byteLength,
				sha256: checksum(content)
			});
		} catch (error) {
			if (!source.optional) throw error;
			omissions.push({
				path: source.path,
				reason: error instanceof UnsafeSupportEntryError ? error.reason : 'sanitization_uncertain'
			});
		}
	}
	const manifest: SupportBundleManifest = {
		format: 'posterpilot-support-v1',
		generatedAt: input.generatedAt.toISOString(),
		appVersion: input.appVersion,
		titlesIncluded: input.includeTitles,
		contents,
		omissions
	};
	const archiveEntries = [
		{ name: 'manifest.json', content: jsonBytes(manifest) },
		...entries.sort((left, right) => left.name.localeCompare(right.name))
	];
	return {
		bytes: createMemoryTar(archiveEntries, input.generatedAt),
		filename: safeFilename(input.generatedAt),
		manifest
	};
}
