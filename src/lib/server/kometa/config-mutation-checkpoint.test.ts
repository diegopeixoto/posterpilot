import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { eq } from 'drizzle-orm';

vi.mock('$lib/server/db', async () => {
	const { createClient } = await import('@libsql/client');
	const { drizzle } = await import('drizzle-orm/libsql');
	const schema = await import('$lib/server/db/schema');
	// Transactions can use another native connection, so share the in-memory DB.
	const client = createClient({ url: 'file::memory:?cache=shared' });
	await client.execute(
		'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)'
	);
	return {
		db: drizzle(client, { schema }),
		databaseClient: client,
		migrateDb: async () => undefined
	};
});

vi.mock('$lib/server/secrets/key', () => ({
	getEncryptionKey: () => Buffer.alloc(32, 23)
}));

import { databaseClient, db } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';
import {
	kometaLastAppliedSettingKey,
	parseKometaLastApplied,
	type KometaSnapshotScope
} from './last-applied';
import {
	createKometaMigrationControlLock,
	type KometaMigrationControlLease
} from './migration-control-lock';
import {
	kometaFileFingerprint,
	kometaProposedFingerprint,
	kometaStructuredDependencyFingerprint
} from './plan';
import {
	assertKometaConfigMutationCheckpoint,
	createKometaConfigMutationCheckpoint,
	createKometaConfigMutationCheckpointStore,
	KOMETA_CONFIG_MUTATION_CHECKPOINT_SETTING_KEY,
	type KometaConfigMutationCheckpointV1
} from './config-mutation-checkpoint';

const withControlLock = createKometaMigrationControlLock(db, {
	leaseMs: 5_000,
	pollIntervalMs: 1,
	owner: () => 'checkpoint-test'
});

const root = join(tmpdir(), 'posterpilot-config-checkpoint');
const configPath = join(root, 'config.yml');
const pathBinding = {
	version: 1 as const,
	canonicalPath: configPath,
	anchorPath: dirname(configPath),
	anchorDevice: '1',
	anchorInode: '1'
};
const scope: KometaSnapshotScope = {
	serverInstanceId: 'server-a',
	configPath,
	outputDirectory: root,
	metadataPathPrefix: 'config'
};

function checkpoint(
	overrides: Partial<{
		checkpointId: string;
		proofToken: string;
		planId: string;
		managedSettings: Record<string, string>;
		action: 'structured' | 'raw' | 'restore';
		configMode: 'merge' | 'own';
		metadataPathPrefix: string;
	}> = {}
): KometaConfigMutationCheckpointV1 {
	const sourceContent = 'settings:\n  cache: true\n';
	const proposedContent = 'settings:\n  cache: false\n';
	const action = overrides.action ?? 'structured';
	return createKometaConfigMutationCheckpoint({
		checkpointId: overrides.checkpointId ?? 'checkpoint-a',
		proofToken: overrides.proofToken ?? 'proof-token-a',
		planId: overrides.planId ?? 'plan-a',
		planDigest: 'a'.repeat(64),
		serverInstanceId: 'server-a',
		action,
		configMode: overrides.configMode ?? 'merge',
		metadataPathPrefix: overrides.metadataPathPrefix ?? 'config',
		pathBinding,
		sourceContent,
		sourceFingerprint: kometaFileFingerprint(sourceContent),
		proposedContent,
		proposedFingerprint: kometaProposedFingerprint(proposedContent),
		structuredDependencyFingerprint:
			action === 'structured'
				? kometaStructuredDependencyFingerprint({
						serverInstanceId: 'server-a',
						plexUrl: 'https://plex.example',
						plexToken: 'plex-secret',
						tmdbKey: 'tmdb-secret'
					})
				: null,
		stateCommit:
			action === 'structured'
				? {
						managedSettings: overrides.managedSettings ?? { cache: 'false' },
						structured: {
							managedLibraries: ['1', '2'],
							defaultCollections: { '1': ['seasonal'], '2': ['universe'] },
							lastApplied: {
								metadataPathPrefix: 'config',
								libraries: {
									Movies: {
										metadataReference: 'config/movies.yml',
										defaults: ['seasonal']
									}
								},
								managedSettingKeys: ['cache']
							},
							scope
						}
					}
				: { managedSettings: overrides.managedSettings ?? { cache: 'false' } }
	});
}

beforeEach(async () => {
	await db.delete(settings);
});

describe('Kometa config mutation checkpoint', () => {
	it('validates content identities and rejects a semantically forged payload', () => {
		const valid = checkpoint();
		expect(() => assertKometaConfigMutationCheckpoint(valid)).not.toThrow();
		expect(() =>
			assertKometaConfigMutationCheckpoint({
				...valid,
				proposedContent: `${valid.proposedContent}# forged\n`
			})
		).toThrow(/fingerprint mismatch/);
		expect(() =>
			createKometaConfigMutationCheckpoint({
				...valid,
				proofToken: '../bad'
			})
		).toThrow(/Invalid Kometa configuration mutation checkpoint/);
	});

	it('freezes the logical action, mode, and metadata scope with matching state semantics', () => {
		expect(checkpoint()).toMatchObject({
			action: 'structured',
			configMode: 'merge',
			metadataPathPrefix: 'config'
		});
		expect(checkpoint({ action: 'raw', configMode: 'own' }).stateCommit.structured).toBeUndefined();
		expect(checkpoint({ action: 'restore' }).stateCommit.structured).toBeUndefined();

		const structured = checkpoint();
		expect(() =>
			assertKometaConfigMutationCheckpoint({
				...structured,
				action: 'raw',
				structuredDependencyFingerprint: null
			})
		).toThrow(/state commit/);
		expect(() =>
			assertKometaConfigMutationCheckpoint({
				...structured,
				stateCommit: { managedSettings: structured.stateCommit.managedSettings }
			})
		).toThrow(/state commit/);
		expect(() =>
			assertKometaConfigMutationCheckpoint({
				...structured,
				metadataPathPrefix: 'other'
			})
		).toThrow(/structured Kometa configuration mutation state commit/);
		expect(() =>
			assertKometaConfigMutationCheckpoint({
				...structured,
				metadataPathPrefix: './config/'
			})
		).toThrow(/metadata scope/);
		expect(() =>
			assertKometaConfigMutationCheckpoint({ ...structured, configMode: 'invalid' })
		).toThrow(/Invalid Kometa configuration mutation checkpoint/);
		expect(() =>
			assertKometaConfigMutationCheckpoint({
				...structured,
				structuredDependencyFingerprint: null
			})
		).toThrow(/Invalid Kometa configuration mutation checkpoint/);
	});

	it('stores authenticated ciphertext and rejects tampering', async () => {
		const store = createKometaConfigMutationCheckpointStore(db, {
			encryptionKey: () => Buffer.alloc(32, 23)
		});
		const prepared = checkpoint();
		await withControlLock(async (assertOwned) => {
			await store.prepare(prepared, await assertOwned());
		});

		const [row] = await db
			.select({ value: settings.value })
			.from(settings)
			.where(eq(settings.key, KOMETA_CONFIG_MUTATION_CHECKPOINT_SETTING_KEY));
		expect(row.value).toMatch(/^enc:v1:/);
		expect(row.value).not.toContain(prepared.proposedContent);
		const index = Math.floor(row.value.length / 2);
		const replacement = row.value[index] === 'A' ? 'B' : 'A';
		await db
			.update(settings)
			.set({ value: `${row.value.slice(0, index)}${replacement}${row.value.slice(index + 1)}` })
			.where(eq(settings.key, KOMETA_CONFIG_MUTATION_CHECKPOINT_SETTING_KEY));

		await expect(store.load()).rejects.toMatchObject({ code: 'checkpoint_corrupt' });
	});

	it('prepares idempotently, enforces exact CAS identity, and discards only prepared state', async () => {
		const store = createKometaConfigMutationCheckpointStore(db, {
			encryptionKey: () => Buffer.alloc(32, 23)
		});
		const expected = checkpoint();
		const other = checkpoint({ checkpointId: 'checkpoint-b', proofToken: 'proof-token-b' });

		await withControlLock(async (assertOwned) => {
			const lease = await assertOwned();
			await expect(store.prepare(expected, lease)).resolves.toEqual(expected);
			await expect(store.prepare(expected, lease)).resolves.toEqual(expected);
			await expect(store.prepare(other, lease)).rejects.toMatchObject({
				code: 'checkpoint_exists'
			});
			await expect(store.discard(other, lease)).rejects.toMatchObject({
				code: 'checkpoint_changed'
			});
			expect(await store.load()).toEqual(expected);
			await store.discard(expected, lease);
		});
		expect(await store.load()).toBeNull();
	});

	it('atomically commits every derived setting and retains completed proof until cleanup', async () => {
		const store = createKometaConfigMutationCheckpointStore(db, {
			encryptionKey: () => Buffer.alloc(32, 23)
		});
		const prepared = checkpoint();
		let completed!: KometaConfigMutationCheckpointV1;

		await withControlLock(async (assertOwned) => {
			const lease = await assertOwned();
			await store.prepare(prepared, lease);
			completed = await store.completeBundle(prepared, lease);
			expect(completed).toEqual({ ...prepared, status: 'completed' });
			// A response-lost retry observes the same completed proof and does not
			// duplicate or weaken the state commit.
			await expect(store.completeBundle(prepared, lease)).resolves.toEqual(completed);
			expect(await store.load()).toEqual(completed);
		});

		const rows = await db.select().from(settings);
		const values = new Map(rows.map((row) => [row.key, row.value]));
		expect(JSON.parse(values.get('kometaManagedLibraries')!)).toEqual(['1', '2']);
		expect(JSON.parse(values.get('kometaDefaultCollections')!)).toEqual({
			'1': ['seasonal'],
			'2': ['universe']
		});
		expect(JSON.parse(values.get('kometaManagedSettings')!)).toEqual({ cache: 'false' });
		expect(parseKometaLastApplied(values.get(kometaLastAppliedSettingKey(scope))!, scope)).toEqual(
			prepared.stateCommit.structured!.lastApplied
		);

		await withControlLock(async (assertOwned) => {
			const lease = await assertOwned();
			await store.finalizeCleanup(completed, lease);
			await store.finalizeCleanup(completed, lease);
		});
		expect(await store.load()).toBeNull();
	});

	it('rolls back every projection and leaves the checkpoint prepared on an in-transaction failure', async () => {
		const store = createKometaConfigMutationCheckpointStore(db, {
			encryptionKey: () => Buffer.alloc(32, 23)
		});
		const prepared = checkpoint();
		await withControlLock(async (assertOwned) => {
			await store.prepare(prepared, await assertOwned());
		});
		await databaseClient.execute(`
			CREATE TRIGGER fail_checkpoint_bundle
			BEFORE INSERT ON settings
			WHEN NEW.key = 'kometaManagedSettings'
			BEGIN
				SELECT RAISE(ABORT, 'forced checkpoint bundle failure');
			END
		`);

		try {
			await withControlLock(async (assertOwned) => {
				await expect(store.completeBundle(prepared, await assertOwned())).rejects.toThrow(
					/kometaManagedSettings/
				);
			});
		} finally {
			await databaseClient.execute('DROP TRIGGER IF EXISTS fail_checkpoint_bundle');
		}

		const rows = await db.select().from(settings);
		const derivedKeys = new Set([
			'kometaManagedLibraries',
			'kometaDefaultCollections',
			'kometaManagedSettings',
			kometaLastAppliedSettingKey(scope)
		]);
		expect(rows.filter((row) => derivedKeys.has(row.key))).toEqual([]);
		expect(await store.load()).toEqual(prepared);
	});

	it('does not write a bundle for a stale checkpoint or a stale/lost control lease', async () => {
		const store = createKometaConfigMutationCheckpointStore(db, {
			encryptionKey: () => Buffer.alloc(32, 23)
		});
		const prepared = checkpoint();
		const stale = checkpoint({ proofToken: 'different-proof' });
		let releasedLease!: KometaMigrationControlLease;

		await withControlLock(async (assertOwned) => {
			const lease = await assertOwned();
			releasedLease = lease;
			await store.prepare(prepared, lease);
			await expect(store.completeBundle(stale, lease)).rejects.toMatchObject({
				code: 'checkpoint_changed'
			});
		});

		await expect(store.completeBundle(prepared, releasedLease)).rejects.toMatchObject({
			code: 'lost'
		});
		await expect(
			store.discard(prepared, 'never-owned' as KometaMigrationControlLease)
		).rejects.toMatchObject({ code: 'lost' });
		const rows = await db.select().from(settings);
		expect(rows.some((row) => row.key === 'kometaManagedSettings')).toBe(false);
		expect(await store.load()).toEqual(prepared);
	});
});
