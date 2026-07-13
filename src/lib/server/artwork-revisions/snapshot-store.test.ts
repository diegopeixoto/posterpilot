import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	ArtworkSnapshotStore,
	SnapshotStoreError,
	resolveArtworkSnapshotDirectory,
	sha256Snapshot
} from './snapshot-store';

describe('ArtworkSnapshotStore', () => {
	let directory: string;
	let store: ArtworkSnapshotStore;

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), 'posterpilot-artwork-snapshots-'));
		store = new ArtworkSnapshotStore(directory);
	});

	afterEach(async () => {
		await rm(directory, { recursive: true, force: true });
	});

	it('stores and reads an immutable SHA-256 object with owner-only permissions', async () => {
		const bytes = Buffer.from('poster bytes');
		const expectedSha256 = sha256Snapshot(bytes);
		const stored = await store.store({ referenceId: 'snapshot-1', bytes });

		expect(stored).toMatchObject({
			referenceId: 'snapshot-1',
			sha256: expectedSha256,
			sizeBytes: bytes.byteLength,
			blobCreated: true,
			referenceCreated: true,
			deduplicated: false,
			referenceCount: 1
		});
		expect(stored.storagePath).toBe(
			join(directory, 'blobs', expectedSha256.slice(0, 2), expectedSha256)
		);
		expect(await store.read('snapshot-1', expectedSha256)).toEqual(bytes);

		const [root, blobs, references, temporary, blob, reference] = await Promise.all([
			stat(directory),
			stat(join(directory, 'blobs')),
			stat(join(directory, 'references')),
			stat(join(directory, '.tmp')),
			stat(stored.storagePath),
			stat(stored.referencePath)
		]);
		for (const info of [root, blobs, references, temporary]) {
			expect(info.mode & 0o777).toBe(0o700);
		}
		expect(blob.mode & 0o777).toBe(0o600);
		expect(reference.mode & 0o777).toBe(0o600);
		expect(reference.dev).toBe(blob.dev);
		expect(reference.ino).toBe(blob.ino);
	});

	it('deduplicates equal bytes while retaining independent references', async () => {
		const bytes = Buffer.from('same artwork');
		const first = await store.store({ referenceId: 'snapshot-a', bytes });
		const second = await store.store({ referenceId: 'snapshot-b', bytes });

		expect(first.storagePath).toBe(second.storagePath);
		expect(second).toMatchObject({
			sha256: first.sha256,
			blobCreated: false,
			referenceCreated: true,
			deduplicated: true,
			referenceCount: 2
		});

		const [blob, firstReference, secondReference] = await Promise.all([
			stat(first.storagePath),
			stat(first.referencePath),
			stat(second.referencePath)
		]);
		expect(new Set([blob.ino, firstReference.ino, secondReference.ino]).size).toBe(1);
		expect(await readdir(join(directory, 'blobs', first.sha256.slice(0, 2)))).toEqual([
			first.sha256
		]);
	});

	it('is idempotent for the same reference and rejects an immutable reference conflict', async () => {
		const original = await store.store({
			referenceId: 'immutable-reference',
			bytes: Buffer.from('original')
		});
		const repeated = await store.store({
			referenceId: 'immutable-reference',
			bytes: Buffer.from('original')
		});

		expect(repeated).toMatchObject({
			sha256: original.sha256,
			blobCreated: false,
			referenceCreated: false,
			deduplicated: true,
			referenceCount: 1
		});

		await expect(
			store.store({ referenceId: 'immutable-reference', bytes: Buffer.from('replacement') })
		).rejects.toMatchObject({ code: 'reference_conflict' });
		expect(await store.read('immutable-reference', original.sha256)).toEqual(
			Buffer.from('original')
		);
	});

	it('keeps a deduplicated blob until its last reference is released', async () => {
		const first = await store.store({
			referenceId: 'retained-a',
			bytes: Buffer.from('retained bytes')
		});
		await store.store({ referenceId: 'retained-b', bytes: Buffer.from('retained bytes') });

		expect(await store.release('retained-a', first.sha256)).toBe(true);
		const whileReferenced = await store.cleanup({
			minimumAgeMs: 0,
			now: new Date(Date.now() + 1_000)
		});
		expect(whileReferenced.deleted).not.toContain(first.sha256);
		expect(whileReferenced.retainedReferenced).toContain(first.sha256);
		expect(await store.read('retained-b', first.sha256)).toEqual(Buffer.from('retained bytes'));

		expect(await store.release('retained-b', first.sha256)).toBe(true);
		const unreferenced = await store.cleanup({
			minimumAgeMs: 0,
			now: new Date(Date.now() + 1_000)
		});
		expect(unreferenced.deleted).toContain(first.sha256);
		await expect(stat(first.storagePath)).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('uses a grace window before deleting an unreferenced blob', async () => {
		const stored = await store.store({
			referenceId: 'young-reference',
			bytes: Buffer.from('young')
		});
		await store.release('young-reference', stored.sha256);

		const retained = await store.cleanup({ minimumAgeMs: 60_000 });
		expect(retained.retainedYoung).toContain(stored.sha256);
		expect(retained.deleted).toEqual([]);

		const collected = await store.cleanup({
			minimumAgeMs: 60_000,
			now: new Date(Date.now() + 61_000)
		});
		expect(collected.deleted).toEqual([stored.sha256]);
	});

	it('retains and reports corrupt content instead of deleting or restoring it', async () => {
		const stored = await store.store({
			referenceId: 'corrupt-reference',
			bytes: Buffer.from('valid')
		});
		await writeFile(stored.storagePath, Buffer.from('tampered'));

		await expect(store.read('corrupt-reference', stored.sha256)).rejects.toMatchObject({
			code: 'blob_corrupt'
		});
		const cleanup = await store.cleanup({
			minimumAgeMs: 0,
			now: new Date(Date.now() + 1_000)
		});
		expect(cleanup.invalid).toEqual([stored.sha256]);
		expect(cleanup.deleted).toEqual([]);
		expect(await stat(stored.storagePath)).toBeTruthy();
	});

	it('does not release a reference when the expected digest does not match', async () => {
		const stored = await store.store({
			referenceId: 'guarded-reference',
			bytes: Buffer.from('guarded')
		});
		const otherDigest = sha256Snapshot(Buffer.from('other'));

		await expect(store.release('guarded-reference', otherDigest)).rejects.toMatchObject({
			code: 'reference_conflict'
		});
		expect(await store.read('guarded-reference', stored.sha256)).toEqual(Buffer.from('guarded'));
	});

	it('rejects unsafe reference identifiers before creating storage', async () => {
		await expect(
			store.store({ referenceId: '../escape', bytes: Buffer.from('nope') })
		).rejects.toBeInstanceOf(SnapshotStoreError);
		await expect(
			store.store({ referenceId: '../escape', bytes: Buffer.from('nope') })
		).rejects.toMatchObject({ code: 'invalid_reference_id' });
		expect(await readdir(directory)).toEqual([]);
	});

	it('derives its root from the centralized data directory contract', () => {
		expect(resolveArtworkSnapshotDirectory({ dataDirectory: '/srv/posterpilot' })).toBe(
			'/srv/posterpilot/artwork-snapshots'
		);
	});
});
