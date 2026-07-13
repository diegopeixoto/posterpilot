import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from '$lib/server/db/schema';
import {
	artworkRevisionGroups,
	artworkRevisions,
	artworkSnapshots,
	mediaCollections,
	mediaItems,
	operationPlans,
	serverInstances
} from '$lib/server/db/schema';
import { buildApplyPlanPayload } from '$lib/server/plans/apply-plan';
import { canonicalJsonDigest } from '$lib/server/plans/canonical-json';
import {
	decodeOperationPlanPayload,
	encodeOperationPlanPayload
} from '$lib/server/plans/operation-plan-payload';
import { createCollectionHistory } from './history';

let directory: string;
let client: Client;
let database: LibSQLDatabase<typeof schema>;
const PLAN_KEY = Buffer.alloc(32, 11);

function collectionPlan(mediaItemId: number) {
	const identity = {
		serverInstanceId: 'server-a',
		mediaItemId,
		librarySectionKey: 'movies',
		sourceId: 'source-1',
		type: 'movie' as const,
		tmdbId: '1',
		imdbId: null,
		tvdbId: null,
		mediaType: 'movie' as const,
		updatedAt: '2026-07-11T10:00:00.000Z',
		selectionUpdatedAt: '2026-07-11T10:00:00.000Z'
	};
	const selection = {
		selectionSource: 'stored' as const,
		sourceItem: { serverInstanceId: 'server-a', mediaItemId },
		slot: { kind: 'poster' as const, season: null, episode: null },
		candidateId: null,
		url: 'https://art.example/poster.jpg',
		provider: null,
		providerAssetId: null,
		setId: null,
		setAuthor: null,
		designFamily: null,
		language: null,
		discoveryRunId: null,
		resolvedTmdbId: '1',
		resolvedMediaType: 'movie' as const,
		stale: false,
		score: null,
		width: null,
		height: null,
		fingerprint: 'selection-fingerprint'
	};
	return buildApplyPlanPayload({
		plannedAt: '2026-07-11T10:00:00.000Z',
		context: {
			source: 'collection',
			collectionId: 'collection-a',
			membershipFingerprint: 'membership-fingerprint'
		},
		defaults: {
			configuredMethod: 'server',
			effectiveMethod: 'server',
			methodSource: 'explicit',
			selectionMode: 'stored',
			scoring: {
				providerPriority: [],
				weights: { providerWeights: {}, resolutionWeight: 0, aspectWeight: 0 }
			}
		},
		items: [
			{
				target: identity,
				selectionFrom: identity,
				discovery: {
					status: 'succeeded',
					runId: null,
					completedAt: null,
					resolvedTmdbId: '1',
					resolvedMediaType: 'movie',
					candidateIds: [],
					candidateCount: 0,
					fingerprint: 'discovery-fingerprint'
				},
				selections: [selection],
				destinationSlots: [
					{
						destination: 'server',
						slot: selection.slot,
						targetId: identity.sourceId,
						capability: 'supported',
						current: {
							url: null,
							fingerprint: null,
							artworkVersion: 0,
							observedAt: null,
							destinationFingerprint: 'server-current'
						},
						skipCode: null,
						parameters: {}
					}
				],
				itemSkip: null
			}
		]
	});
}

beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), 'posterpilot-collection-history-'));
	client = createClient({ url: `file:${join(directory, 'history.db')}` });
	database = drizzle(client, { schema });
	await migrate(database, { migrationsFolder: './drizzle' });
});

afterAll(async () => {
	client.close();
	await rm(directory, { recursive: true, force: true });
});

beforeEach(async () => {
	await database.delete(artworkRevisions);
	await database.delete(artworkRevisionGroups);
	await database.delete(artworkSnapshots);
	await database.delete(operationPlans);
	await database.delete(mediaCollections);
	await database.delete(mediaItems);
	await database.delete(serverInstances);
	await database.insert(serverInstances).values([
		{ id: 'server-a', name: 'A', normalizedName: 'a', type: 'plex' },
		{ id: 'server-b', name: 'B', normalizedName: 'b', type: 'plex' }
	]);
});

describe('collection revision history', () => {
	it('authorizes groups only through their frozen collection plan and server', async () => {
		const [item] = await database
			.insert(mediaItems)
			.values({
				serverInstanceId: 'server-a',
				ratingKey: 'source-1',
				sectionKey: 'movies',
				type: 'movie',
				title: 'One'
			})
			.returning();
		const [otherItem] = await database
			.insert(mediaItems)
			.values({
				serverInstanceId: 'server-a',
				ratingKey: 'source-2',
				sectionKey: 'movies',
				type: 'movie',
				title: 'Two'
			})
			.returning();
		await database.insert(mediaCollections).values({
			id: 'collection-a',
			serverInstanceId: 'server-a',
			source: 'tmdb',
			sourceId: '44',
			name: 'Saga'
		});
		const plan = collectionPlan(item.id);
		const canonical = canonicalJsonDigest(plan);
		await database.insert(operationPlans).values({
			id: 'plan-a',
			kind: 'artwork_apply',
			serverInstanceId: 'server-a',
			payload: encodeOperationPlanPayload(canonical.canonicalJson, PLAN_KEY),
			digest: canonical.digest,
			expiresAt: new Date('2026-07-12T10:00:00.000Z'),
			consumedAt: new Date('2026-07-11T10:01:00.000Z')
		});
		await database.insert(artworkRevisionGroups).values({
			id: 'group-a',
			serverInstanceId: 'server-a',
			operationPlanId: 'plan-a',
			kind: 'apply',
			initiator: 'user',
			outcome: 'success',
			summary: {
				collectionHistory: { collectionId: 'collection-a', targetItemIds: [item.id] }
			}
		});
		await database.insert(artworkSnapshots).values({
			id: 'snapshot-a',
			serverInstanceId: 'server-a',
			mediaItemId: item.id,
			destination: 'server',
			kind: 'poster',
			state: 'absent'
		});
		await database.insert(artworkRevisions).values({
			id: 'revision-a',
			groupId: 'group-a',
			serverInstanceId: 'server-a',
			mediaItemId: item.id,
			operationPlanId: 'plan-a',
			beforeSnapshotId: 'snapshot-a',
			action: 'apply',
			destination: 'server',
			kind: 'poster',
			outcome: 'success',
			verification: 'exact'
		});
		await database.insert(artworkRevisions).values({
			id: 'revision-outside-plan',
			groupId: 'group-a',
			serverInstanceId: 'server-a',
			mediaItemId: otherItem.id,
			operationPlanId: 'plan-a',
			action: 'apply',
			destination: 'server',
			kind: 'poster',
			outcome: 'success',
			verification: 'exact'
		});

		const history = createCollectionHistory(database, (payload) =>
			decodeOperationPlanPayload(payload, PLAN_KEY)
		);
		expect(await history.get('server-a', 'collection-a', 'group-a')).toMatchObject({
			id: 'group-a',
			operationPlanId: 'plan-a',
			revisionCount: 1,
			memberCount: 1,
			anchorItemId: item.id,
			revisions: [
				expect.objectContaining({
					id: 'revision-a',
					memberTitle: 'One',
					restorable: true,
					restored: false
				})
			]
		});
		expect(await history.getRevision('server-a', 'collection-a', 'revision-a')).toMatchObject({
			group: { id: 'group-a' },
			revision: { id: 'revision-a', mediaItemId: item.id, restorable: true }
		});
		expect(await history.getRevision('server-a', 'collection-other', 'revision-a')).toBeNull();
		expect(
			await history.getRevision('server-a', 'collection-a', 'revision-outside-plan')
		).toBeNull();
		expect(await history.get('server-a', 'collection-other', 'group-a')).toBeNull();
		expect(await history.get('server-b', 'collection-a', 'group-a')).toBeNull();
		expect(await history.list('server-a', 'collection-a')).toHaveLength(1);

		await database.delete(operationPlans);
		expect(await history.get('server-a', 'collection-a', 'group-a')).toMatchObject({
			id: 'group-a',
			operationPlanId: null,
			revisionCount: 1
		});
		expect(await history.list('server-a', 'collection-a')).toHaveLength(1);
	});
});
