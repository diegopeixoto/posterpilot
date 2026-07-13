import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from '$lib/server/db/schema';
import {
	collectionMemberships,
	mediaCollections,
	mediaItems,
	serverInstances
} from '$lib/server/db/schema';
import type { ApplyPlanPayloadV1 } from '$lib/server/plans/apply-plan';
import {
	assertCollectionApplyContextFresh,
	CollectionApplyScopeError,
	loadCollectionApplyScope
} from './apply-scope';

let directory: string;
let client: Client;
let database: LibSQLDatabase<typeof schema>;

beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), 'posterpilot-collection-apply-scope-'));
	client = createClient({ url: `file:${join(directory, 'scope.db')}` });
	database = drizzle(client, { schema });
	await migrate(database, { migrationsFolder: './drizzle' });
});

afterAll(async () => {
	client.close();
	await rm(directory, { recursive: true, force: true });
});

beforeEach(async () => {
	await database.delete(collectionMemberships);
	await database.delete(mediaCollections);
	await database.delete(mediaItems);
	await database.delete(serverInstances);
	await database.insert(serverInstances).values([
		{ id: 'server-a', name: 'A', normalizedName: 'a', type: 'plex' },
		{ id: 'server-b', name: 'B', normalizedName: 'b', type: 'jellyfin' }
	]);
	const items = await database
		.insert(mediaItems)
		.values([
			{
				serverInstanceId: 'server-a',
				ratingKey: 'a-1',
				sectionKey: 'movies',
				type: 'movie',
				title: 'One'
			},
			{
				serverInstanceId: 'server-a',
				ratingKey: 'a-2',
				sectionKey: 'movies',
				type: 'movie',
				title: 'Two'
			}
		])
		.returning();
	await database.insert(mediaCollections).values({
		id: 'collection-a',
		serverInstanceId: 'server-a',
		source: 'tmdb',
		sourceId: '44',
		name: 'Saga'
	});
	await database.insert(collectionMemberships).values([
		{
			serverInstanceId: 'server-a',
			collectionId: 'collection-a',
			mediaItemId: items[1].id,
			source: 'tmdb',
			sourceMemberId: '2',
			availableLocally: true
		},
		{
			serverInstanceId: 'server-a',
			collectionId: 'collection-a',
			mediaItemId: items[0].id,
			source: 'tmdb',
			sourceMemberId: '1',
			availableLocally: true
		},
		{
			serverInstanceId: 'server-a',
			collectionId: 'collection-a',
			mediaItemId: null,
			source: 'tmdb',
			sourceMemberId: '3',
			availableLocally: false
		}
	]);
});

describe('collection apply scope', () => {
	it('freezes sorted local targets and all source-qualified memberships', async () => {
		const scope = await loadCollectionApplyScope(database, 'server-a', 'collection-a', {
			requireLocalMembers: true
		});
		expect(scope.itemIds).toEqual([...scope.itemIds].sort((left, right) => left - right));
		expect(scope.itemIds).toHaveLength(2);
		expect(scope.membershipFingerprint).toMatch(/^[a-f0-9]{64}$/);

		await database.insert(collectionMemberships).values({
			serverInstanceId: 'server-a',
			collectionId: 'collection-a',
			mediaItemId: null,
			source: 'tmdb',
			sourceMemberId: '4',
			availableLocally: false
		});
		const changed = await loadCollectionApplyScope(database, 'server-a', 'collection-a');
		expect(changed.itemIds).toEqual(scope.itemIds);
		expect(changed.membershipFingerprint).not.toBe(scope.membershipFingerprint);
	});

	it('never resolves a collection through the wrong server scope', async () => {
		await expect(loadCollectionApplyScope(database, 'server-b', 'collection-a')).rejects.toEqual(
			expect.objectContaining<Partial<CollectionApplyScopeError>>({
				code: 'collection_not_found'
			})
		);
	});

	it('rejects a frozen plan after membership changes', async () => {
		const scope = await loadCollectionApplyScope(database, 'server-a', 'collection-a');
		const payload = {
			context: {
				source: 'collection',
				collectionId: scope.collectionId,
				membershipFingerprint: scope.membershipFingerprint
			},
			scope: {
				serverInstanceIds: ['server-a'],
				targetItemIds: scope.itemIds
			}
		} as ApplyPlanPayloadV1;
		await expect(
			assertCollectionApplyContextFresh(database, payload, {
				collectionId: 'collection-a',
				serverInstanceId: 'server-a'
			})
		).resolves.toBeUndefined();
		await database.insert(collectionMemberships).values({
			serverInstanceId: 'server-a',
			collectionId: 'collection-a',
			mediaItemId: null,
			source: 'tmdb',
			sourceMemberId: 'new',
			availableLocally: false
		});
		await expect(assertCollectionApplyContextFresh(database, payload)).rejects.toMatchObject({
			code: 'plan_stale'
		});
	});
});
