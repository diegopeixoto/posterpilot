import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import { serverInstances, settings } from '$lib/server/db/schema';
import { decryptSecret, isEncrypted } from '$lib/server/secrets/crypto';
import { ACTIVE_SERVER_INSTANCE_KEY, createServerInstanceStore } from './store';
import { LEGACY_SERVER_INSTANCE_ID } from './legacy';

const KEY = Buffer.alloc(32, 7);
const NOW = new Date('2026-07-10T12:00:00.000Z');

let client: Client;
let database: LibSQLDatabase<typeof schema>;
let idCounter: number;
let databasePath: string;

beforeEach(async () => {
	databasePath = `/tmp/posterpilot-server-instances-${randomUUID()}.db`;
	client = createClient({ url: `file:${databasePath}` });
	database = drizzle(client, { schema });
	await client.executeMultiple(`
		PRAGMA foreign_keys = ON;
		CREATE TABLE server_instances (
			id text PRIMARY KEY NOT NULL,
			name text NOT NULL,
			normalized_name text NOT NULL,
			type text NOT NULL,
			base_url text,
			credential text,
			connection_settings text,
			capabilities text,
			enabled integer DEFAULT true NOT NULL,
			protected integer DEFAULT false NOT NULL,
			connection_status text DEFAULT 'unknown' NOT NULL,
			last_tested_at integer,
			disconnected_at integer,
			created_at integer NOT NULL,
			updated_at integer NOT NULL
		);
		CREATE UNIQUE INDEX server_instances_active_name_unique
			ON server_instances (normalized_name)
			WHERE enabled = 1 AND disconnected_at IS NULL;
		CREATE TABLE settings (
			key text PRIMARY KEY NOT NULL,
			value text NOT NULL
		);
		CREATE TABLE automation_schedules (
			id text PRIMARY KEY NOT NULL,
			server_instance_id text NOT NULL REFERENCES server_instances(id),
			enabled integer DEFAULT false NOT NULL,
			paused_at integer,
			next_run_at integer,
			updated_at integer NOT NULL
		);
		CREATE TABLE owned_record (
			id integer PRIMARY KEY,
			server_instance_id text NOT NULL REFERENCES server_instances(id)
		);
	`);
	idCounter = 0;
});

afterEach(() => {
	client.close();
	for (const suffix of ['', '-shm', '-wal']) rmSync(`${databasePath}${suffix}`, { force: true });
});

function store() {
	return createServerInstanceStore(database, KEY, {
		clock: () => new Date(NOW),
		generateId: () => `server-${++idCounter}`
	});
}

async function stored(id: string) {
	return (await database.select().from(serverInstances).where(eq(serverInstances.id, id)))[0];
}

async function activeSetting() {
	return (
		await database.select().from(settings).where(eq(settings.key, ACTIVE_SERVER_INSTANCE_KEY))
	)[0]?.value;
}

describe('server instance encrypted CRUD', () => {
	it('creates, lists, and reads an instance without exposing its credential', async () => {
		const created = await store().create({
			name: '  Home   Plex ',
			type: 'plex',
			baseUrl: 'http://PLEX.local:32400/',
			credential: 'top-secret-token',
			connectionSettings: { plexClientId: 'client-1' }
		});

		expect(created).toMatchObject({
			id: 'server-1',
			name: 'Home Plex',
			baseUrl: 'http://plex.local:32400',
			credentialSet: true,
			enabled: true
		});
		expect(created).not.toHaveProperty('credential');
		expect(await store().list()).toEqual([created]);
		expect(await store().get(created.id)).toEqual(created);

		const row = await stored(created.id);
		expect(row.credential).not.toContain('top-secret-token');
		expect(isEncrypted(row.credential!)).toBe(true);
		expect(decryptSecret(row.credential!, KEY)).toBe('top-secret-token');

		const connection = await store().getConnection(created.id, { requireEnabled: true });
		expect(connection.credential).toBe('top-secret-token');
		expect(connection.connectionSettings).toEqual({ plexClientId: 'client-1' });
	});

	it('preserves an encrypted credential on omitted or blank updates and clears only explicitly', async () => {
		const created = await store().create({
			name: 'Plex',
			type: 'plex',
			baseUrl: 'http://plex:32400',
			credential: 'original-token'
		});
		const originalCiphertext = (await stored(created.id)).credential;

		await store().update(created.id, { name: 'Living Room Plex' });
		expect((await stored(created.id)).credential).toBe(originalCiphertext);

		await store().update(created.id, { credential: '   ' });
		expect((await stored(created.id)).credential).toBe(originalCiphertext);

		await store().update(created.id, { credential: '********' });
		expect((await stored(created.id)).credential).toBe(originalCiphertext);

		await store().update(created.id, { credential: 'replacement-token' });
		expect((await store().getConnection(created.id)).credential).toBe('replacement-token');

		const cleared = await store().update(created.id, { clearCredential: true });
		expect(cleared.credentialSet).toBe(false);
		expect((await stored(created.id)).credential).toBeNull();
	});

	it('rejects ambiguous clear-and-replace requests', async () => {
		const created = await store().create({
			name: 'Plex',
			type: 'plex',
			baseUrl: 'http://plex:32400',
			credential: 'token'
		});
		await expect(
			store().update(created.id, { credential: 'replacement', clearCredential: true })
		).rejects.toMatchObject({ code: 'credential_update_conflict' });
		expect((await store().getConnection(created.id)).credential).toBe('token');
	});

	it('enforces normalized-name uniqueness only among enabled instances', async () => {
		await store().create({
			name: 'My Plex',
			type: 'plex',
			baseUrl: 'http://plex-a:32400',
			credential: 'a'
		});
		await expect(
			store().create({
				name: '  MY   PLEX ',
				type: 'plex',
				baseUrl: 'http://plex-b:32400',
				credential: 'b'
			})
		).rejects.toMatchObject({ code: 'duplicate_name' });

		const disabled = await store().create({
			name: 'my plex',
			type: 'plex',
			baseUrl: 'http://plex-c:32400',
			credential: 'c',
			enabled: false
		});
		await expect(store().update(disabled.id, { enabled: true })).rejects.toMatchObject({
			code: 'duplicate_name'
		});
	});

	it('refuses to remove a server that still owns scoped data', async () => {
		const created = await store().create({
			name: 'Plex',
			type: 'plex',
			baseUrl: 'http://plex:32400',
			credential: 'token'
		});
		await client.execute({
			sql: 'INSERT INTO owned_record (server_instance_id) VALUES (?)',
			args: [created.id]
		});

		await expect(store().remove(created.id)).rejects.toMatchObject({
			code: 'server_instance_in_use'
		});
		expect(await store().get(created.id)).not.toBeNull();
	});
});

describe('active server persistence', () => {
	it('resolves a fresh installation concurrently without opening write transactions', async () => {
		const active = await Promise.all(Array.from({ length: 12 }, () => store().getActive()));
		expect(active).toEqual(Array.from({ length: 12 }, () => null));
		expect(await activeSetting()).toBeUndefined();
	});

	it('selects the first server, persists explicit changes, and repairs a disabled active id', async () => {
		const first = await store().create({
			name: 'First',
			type: 'plex',
			baseUrl: 'http://first:32400',
			credential: 'first-token'
		});
		const second = await store().create({
			name: 'Second',
			type: 'jellyfin',
			baseUrl: 'http://second:8096',
			credential: 'second-token'
		});

		expect((await store().getActive())?.id).toBe(first.id);
		expect(await activeSetting()).toBe(first.id);
		expect((await store().setActive(second.id)).id).toBe(second.id);
		expect(await activeSetting()).toBe(second.id);

		await store().update(second.id, { enabled: false });
		expect((await store().getActive())?.id).toBe(first.id);
		expect(await activeSetting()).toBe(first.id);

		await store().remove(first.id);
		expect(await store().getActive()).toBeNull();
		expect(await activeSetting()).toBeUndefined();
	});

	it('rejects activating a disabled instance', async () => {
		const disabled = await store().create({
			name: 'Offline',
			type: 'emby',
			baseUrl: 'http://offline:8096',
			credential: 'token',
			enabled: false
		});
		await expect(store().setActive(disabled.id)).rejects.toMatchObject({
			code: 'server_instance_disabled'
		});
	});

	it('disconnects without deleting history, clears the credential, and repairs active selection', async () => {
		const first = await store().create({
			name: 'First',
			type: 'plex',
			baseUrl: 'http://first:32400',
			credential: 'first-token'
		});
		const fallback = await store().create({
			name: 'Fallback',
			type: 'emby',
			baseUrl: 'http://fallback:8096',
			credential: 'fallback-key'
		});

		const disconnected = await store().disconnect(first.id);
		expect(disconnected).toMatchObject({
			id: first.id,
			enabled: false,
			credentialSet: false,
			connectionStatus: 'disabled',
			disconnectedAt: NOW
		});
		expect((await stored(first.id)).credential).toBeNull();
		expect((await store().list()).map((server) => server.id)).toContain(first.id);
		expect((await store().getActive())?.id).toBe(fallback.id);
		expect(await activeSetting()).toBe(fallback.id);
	});
});

describe('legacy configuration materialization', () => {
	it('creates one encrypted protected default, makes it active, and is byte-idempotent', async () => {
		const connection = {
			type: 'plex' as const,
			baseUrl: 'http://plex:32400/',
			credential: 'legacy-token',
			connectionSettings: { plexClientId: 'legacy-client' }
		};
		const materialized = await store().materializeLegacy(connection);
		expect(materialized).toMatchObject({
			id: LEGACY_SERVER_INSTANCE_ID,
			protected: true,
			enabled: true,
			credentialSet: true
		});
		expect(await activeSetting()).toBe(LEGACY_SERVER_INSTANCE_ID);

		const firstRow = await stored(LEGACY_SERVER_INSTANCE_ID);
		expect(isEncrypted(firstRow.credential!)).toBe(true);
		expect(decryptSecret(firstRow.credential!, KEY)).toBe('legacy-token');

		await store().materializeLegacy(connection);
		const secondRow = await stored(LEGACY_SERVER_INSTANCE_ID);
		expect(secondRow.credential).toBe(firstRow.credential);
		expect(secondRow.updatedAt).toEqual(firstRow.updatedAt);
		expect(await store().list()).toHaveLength(1);
	});

	it('creates no placeholder for an unconfigured fresh installation', async () => {
		expect(
			await store().materializeLegacy({
				type: 'plex',
				baseUrl: 'http://plex:32400',
				credential: null,
				connectionSettings: null
			})
		).toBeNull();
		expect(await store().list()).toEqual([]);
		expect(await activeSetting()).toBeUndefined();
	});

	it('upgrades a migration-seeded plaintext row without overriding another valid active server', async () => {
		const other = await store().create({
			name: 'Other',
			type: 'jellyfin',
			baseUrl: 'http://other:8096',
			credential: 'other-key'
		});
		await database.insert(serverInstances).values({
			id: LEGACY_SERVER_INSTANCE_ID,
			name: 'Migrated default',
			normalizedName: 'migrated default',
			type: 'plex',
			baseUrl: 'http://old:32400',
			credential: 'legacy-plaintext-token',
			enabled: true,
			protected: false,
			connectionStatus: 'unknown',
			createdAt: NOW,
			updatedAt: NOW
		});

		const materialized = await store().materializeLegacy({
			type: 'plex',
			baseUrl: 'http://new:32400',
			credential: 'legacy-plaintext-token',
			connectionSettings: null
		});
		const row = await stored(LEGACY_SERVER_INSTANCE_ID);
		expect(materialized).toMatchObject({ protected: true, baseUrl: 'http://new:32400' });
		expect(isEncrypted(row.credential!)).toBe(true);
		expect(decryptSecret(row.credential!, KEY)).toBe('legacy-plaintext-token');
		expect((await store().getActive())?.id).toBe(other.id);
	});

	it('prevents deletion of the protected legacy instance', async () => {
		await store().materializeLegacy({
			type: 'emby',
			baseUrl: 'http://emby:8096',
			credential: 'emby-key',
			connectionSettings: null
		});
		await expect(store().remove(LEGACY_SERVER_INSTANCE_ID)).rejects.toMatchObject({
			code: 'server_instance_protected'
		});
	});
});

describe('credential failure isolation', () => {
	it('returns a locale-neutral error without leaking an undecryptable stored value', async () => {
		const created = await store().create({
			name: 'Plex',
			type: 'plex',
			baseUrl: 'http://plex:32400',
			credential: 'token'
		});
		await database
			.update(serverInstances)
			.set({ credential: 'enc:v1:not-valid-ciphertext' })
			.where(eq(serverInstances.id, created.id));

		await expect(store().getConnection(created.id)).rejects.toMatchObject({
			code: 'credential_unavailable',
			message: 'credential_unavailable'
		});
	});
});
