import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import { createDatabaseArtworkLockStore } from './artwork-locks-store';

const MIGRATION = readFileSync(
	new URL('../../../../drizzle/0013_same_starfox.sql', import.meta.url),
	'utf8'
).replaceAll('--> statement-breakpoint', '');

let client: Client;

beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	await client.executeMultiple(`
		CREATE TABLE server_instances (id text PRIMARY KEY NOT NULL);
		INSERT INTO server_instances (id) VALUES ('server-1'), ('server-2');
		${MIGRATION}
	`);
});

afterEach(() => client.close());

describe('database artwork lock store', () => {
	const poster = { serverInstanceId: 'server-1', targetId: 'item-1', kind: 'poster' } as const;

	it('counts holds per slot and slots per target, and forgets a slot with its last hold', async () => {
		const store = createDatabaseArtworkLockStore(drizzle(client, { schema }));

		await store.add(poster);
		await store.add(poster);
		await store.add({ ...poster, kind: 'background' });
		await store.add({ ...poster, serverInstanceId: 'server-2' });

		expect(await store.holds(poster)).toBe(2);
		expect(await store.countForTarget('server-1', 'item-1')).toBe(2);

		await store.release(poster);
		expect(await store.holds(poster)).toBe(1);
		expect(await store.countForTarget('server-1', 'item-1')).toBe(2);

		await store.release(poster);
		await store.release(poster);

		expect(await store.holds(poster)).toBe(0);
		expect(await store.countForTarget('server-1', 'item-1')).toBe(1);
		expect(await store.countForTarget('server-2', 'item-1')).toBe(1);
	});
});
