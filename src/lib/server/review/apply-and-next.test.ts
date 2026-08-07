import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { and, eq, sql } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema';
import {
	childSelections,
	jobItemOutcomes,
	jobs,
	mediaItems,
	reviewEvents,
	serverInstances
} from '$lib/server/db/schema';
import {
	ApplyAndNextError,
	createApplyAndNextCompletionService,
	validateApplyAndNextCompletion
} from './apply-and-next';

const serverInstanceId = 'server-a';
const mediaItemId = 1;
const plannedSelectionUpdatedAt = '2026-07-11T10:00:00.000Z';
const plannedSelectionRevision = 3;

interface FrozenVersionFixture {
	selectionUpdatedAt?: unknown;
	selectionRevision?: unknown;
	omitSelectionRevision?: boolean;
}

function frozenIdentity(version: FrozenVersionFixture = {}) {
	const identity = {
		serverInstanceId,
		mediaItemId,
		librarySectionKey: 'movies',
		sourceId: 'item-1',
		type: 'movie' as const,
		tmdbId: '1',
		imdbId: null,
		tvdbId: null,
		mediaType: 'movie' as const,
		updatedAt: '2026-07-11T09:00:00.000Z',
		selectionUpdatedAt: Object.hasOwn(version, 'selectionUpdatedAt')
			? version.selectionUpdatedAt
			: plannedSelectionUpdatedAt
	};
	if (version.omitSelectionRevision) return identity;
	return {
		...identity,
		selectionRevision: Object.hasOwn(version, 'selectionRevision')
			? version.selectionRevision
			: plannedSelectionRevision
	};
}

function operation(
	id: string,
	input: {
		kind?: string;
		season?: number | null;
		episode?: number | null;
		url?: string;
		provider?: string | null;
	} = {}
) {
	return {
		id,
		target: { serverInstanceId, mediaItemId },
		destination: 'server' as const,
		slot: {
			kind: input.kind ?? 'poster',
			season: input.season ?? null,
			episode: input.episode ?? null
		},
		selection: {
			url: input.url ?? `https://art.example/${id}.jpg`,
			provider: input.provider ?? null
		}
	};
}

function job(
	operations = [operation('poster')],
	overrides: Record<string, unknown> = {},
	version: FrozenVersionFixture = {}
) {
	return {
		id: 7,
		serverInstanceId,
		type: 'apply',
		status: 'completed',
		payload: {
			kind: 'apply',
			planId: 'plan-7',
			digest: 'digest-7',
			plan: {
				version: 1,
				type: 'artwork_apply',
				plannedAt: '2026-07-11T10:30:00.000Z',
				items: [
					{
						target: frozenIdentity(version),
						selectionFrom: frozenIdentity(version),
						operations
					}
				]
			}
		},
		result: {
			summary: {
				operationCount: operations.length,
				succeeded: operations.length,
				failed: 0,
				skipped: 0
			}
		},
		...overrides
	};
}

function outcomes(operations = [operation('poster')]) {
	return operations.map((entry, index) => ({
		serverInstanceId,
		mediaItemId,
		status: 'success',
		result: {
			operationId: entry.id,
			verification: index === 0 ? 'exact' : 'best_effort'
		}
	}));
}

describe('Apply and next verification', () => {
	it('accepts only a complete exact single-item operation set', () => {
		const operations = [
			operation('poster'),
			operation('episode', {
				kind: 'title_card',
				season: 1,
				episode: 2
			})
		];
		expect(
			validateApplyAndNextCompletion({
				serverInstanceId,
				mediaItemId,
				job: job(operations),
				outcomes: outcomes(operations)
			})
		).toHaveLength(2);
	});

	it('rejects terminal-looking jobs with skips, failures, or unavailable verification', () => {
		const operations = [operation('poster')];
		const base = {
			serverInstanceId,
			mediaItemId,
			job: job(operations),
			outcomes: outcomes(operations)
		};
		expect(() =>
			validateApplyAndNextCompletion({
				...base,
				job: job(operations, {
					result: {
						summary: { operationCount: 1, succeeded: 1, failed: 0, skipped: 1 }
					}
				})
			})
		).toThrowError('job_not_verified');
		expect(() =>
			validateApplyAndNextCompletion({
				...base,
				job: job(operations, { status: 'partial_failed' })
			})
		).toThrowError('job_not_completed');
		expect(() =>
			validateApplyAndNextCompletion({
				...base,
				outcomes: [
					{
						...outcomes(operations)[0],
						result: { operationId: 'poster', verification: 'unavailable' }
					}
				]
			})
		).toThrowError('job_not_verified');
	});

	it.each([42, '2026-07-11T10:00:00Z', 'not-a-date'])(
		'rejects a non-canonical frozen selection timestamp (%s)',
		(selectionUpdatedAt) => {
			const operations = [operation('poster')];
			expect(() =>
				validateApplyAndNextCompletion({
					serverInstanceId,
					mediaItemId,
					job: job(operations, {}, { selectionUpdatedAt }),
					outcomes: outcomes(operations)
				})
			).toThrowError('job_not_verified');
		}
	);

	it('accepts a null frozen selection timestamp for legacy plans', () => {
		const operations = [operation('poster')];
		expect(
			validateApplyAndNextCompletion({
				serverInstanceId,
				mediaItemId,
				job: job(operations, {}, { selectionUpdatedAt: null }),
				outcomes: outcomes(operations)
			})
		).toHaveLength(1);
	});

	it.each([null, '3', -1, 1.5, undefined])(
		'rejects an invalid frozen selection revision (%s)',
		(selectionRevision) => {
			const operations = [operation('poster')];
			expect(() =>
				validateApplyAndNextCompletion({
					serverInstanceId,
					mediaItemId,
					job: job(operations, {}, { selectionRevision }),
					outcomes: outcomes(operations)
				})
			).toThrowError('job_not_verified');
		}
	);

	it('accepts an omitted selection revision as a legacy revision zero', () => {
		const operations = [operation('poster')];
		expect(
			validateApplyAndNextCompletion({
				serverInstanceId,
				mediaItemId,
				job: job(operations, {}, { omitSelectionRevision: true }),
				outcomes: outcomes(operations)
			})
		).toHaveLength(1);
	});
});

let client: Client;
let database: LibSQLDatabase<typeof schema>;
let databasePath: string;

beforeEach(async () => {
	databasePath = `/tmp/posterpilot-apply-next-${randomUUID()}.db`;
	client = createClient({ url: `file:${databasePath}` });
	database = drizzle(client, { schema });
	await migrate(database, { migrationsFolder: './drizzle' });
	await database.insert(serverInstances).values({
		id: serverInstanceId,
		name: 'Server A',
		normalizedName: 'server a',
		type: 'plex'
	});
	await database.insert(mediaItems).values({
		id: mediaItemId,
		serverInstanceId,
		ratingKey: 'item-1',
		sectionKey: 'movies',
		type: 'movie',
		title: 'Example',
		resolved: true,
		selectedPosterUrl: 'https://art.example/poster.jpg',
		selectedPosterCandidateId: 101,
		selectedPosterProvider: 'mediux',
		selectionUpdatedAt: new Date(plannedSelectionUpdatedAt),
		selectionRevision: plannedSelectionRevision
	});
});

afterEach(() => {
	client.close();
	for (const suffix of ['', '-shm', '-wal']) rmSync(`${databasePath}${suffix}`, { force: true });
});

async function insertJob(
	operations: ReturnType<typeof operation>[],
	version: FrozenVersionFixture = {}
) {
	const frozenJob = job(operations, {}, version);
	await database.insert(jobs).values({
		id: 7,
		serverInstanceId,
		type: 'apply',
		status: 'completed',
		payload: frozenJob.payload,
		result: frozenJob.result
	});
	await database.insert(jobItemOutcomes).values(
		outcomes(operations).map((outcome) => ({
			jobId: 7,
			serverInstanceId,
			mediaItemId,
			status: outcome.status as 'success',
			result: outcome.result
		}))
	);
}

async function insertCompletedJob(
	input: { includeBackground?: boolean; version?: FrozenVersionFixture } = {}
) {
	const frozenOperations = [
		operation('poster', { url: 'https://art.example/poster.jpg', provider: 'mediux' }),
		...(input.includeBackground
			? [
					operation('background', {
						kind: 'background',
						url: 'https://art.example/background.jpg',
						provider: 'fanarttv'
					})
				]
			: []),
		operation('episode', {
			kind: 'title_card',
			season: 1,
			episode: 2,
			url: 'https://art.example/episode.jpg',
			provider: 'mediux'
		})
	];
	await database.insert(childSelections).values({
		serverInstanceId,
		mediaItemId,
		kind: 'title_card',
		season: 1,
		episode: 2,
		url: 'https://art.example/episode.jpg',
		provider: 'mediux'
	});
	if (input.includeBackground) {
		await database
			.update(mediaItems)
			.set({
				selectedBackgroundUrl: 'https://art.example/background.jpg',
				selectedBackgroundCandidateId: 202,
				selectedBackgroundProvider: 'fanarttv'
			})
			.where(eq(mediaItems.id, mediaItemId));
	}
	await insertJob(frozenOperations, input.version);
}

describe('Apply and next completion service', () => {
	it('atomically clears the exact staging, records completion, and is idempotent', async () => {
		await insertCompletedJob({ includeBackground: true });
		const complete = createApplyAndNextCompletionService(
			database,
			() => new Date('2026-07-11T12:00:00.000Z')
		);
		const first = await complete({ serverInstanceId, mediaItemId, jobId: 7 });
		expect(first.state).toBe('completed');
		const [item] = await database
			.select({
				poster: mediaItems.selectedPosterUrl,
				background: mediaItems.selectedBackgroundUrl,
				posterCandidateId: mediaItems.selectedPosterCandidateId,
				backgroundCandidateId: mediaItems.selectedBackgroundCandidateId,
				posterProvider: mediaItems.selectedPosterProvider,
				backgroundProvider: mediaItems.selectedBackgroundProvider,
				selectionUpdatedAt: mediaItems.selectionUpdatedAt,
				selectionRevision: mediaItems.selectionRevision,
				updatedAt: mediaItems.updatedAt,
				reviewedAt: mediaItems.reviewedAt
			})
			.from(mediaItems)
			.where(eq(mediaItems.id, mediaItemId));
		expect(item).toMatchObject({
			poster: null,
			background: null,
			posterCandidateId: null,
			backgroundCandidateId: null,
			posterProvider: null,
			backgroundProvider: null,
			selectionRevision: plannedSelectionRevision + 1
		});
		expect(item.selectionUpdatedAt?.toISOString()).toBe('2026-07-11T12:00:00.000Z');
		expect(item.updatedAt?.toISOString()).toBe('2026-07-11T12:00:00.000Z');
		expect(item.reviewedAt?.toISOString()).toBe('2026-07-11T12:00:00.000Z');
		expect(await database.select().from(childSelections)).toEqual([]);
		expect(await database.select().from(reviewEvents)).toHaveLength(1);

		const second = await complete({ serverInstanceId, mediaItemId, jobId: 7 });
		expect(second).toEqual(first);
		expect(await database.select().from(reviewEvents)).toHaveLength(1);
	});

	it('keeps all staging intact when it changed after the frozen plan', async () => {
		await insertCompletedJob();
		await database
			.update(mediaItems)
			.set({
				selectedPosterUrl: 'https://art.example/newer.jpg',
				selectedPosterCandidateId: null,
				selectedPosterProvider: 'custom',
				selectionUpdatedAt: new Date(plannedSelectionUpdatedAt),
				selectionRevision: sql`${mediaItems.selectionRevision} + 1`
			})
			.where(
				and(eq(mediaItems.serverInstanceId, serverInstanceId), eq(mediaItems.id, mediaItemId))
			);
		const complete = createApplyAndNextCompletionService(database);
		await expect(complete({ serverInstanceId, mediaItemId, jobId: 7 })).rejects.toBeInstanceOf(
			ApplyAndNextError
		);
		const [item] = await database.select().from(mediaItems).where(eq(mediaItems.id, mediaItemId));
		expect(item.selectedPosterUrl).toBe('https://art.example/newer.jpg');
		expect(await database.select().from(childSelections)).toHaveLength(1);
		expect(await database.select().from(reviewEvents)).toEqual([]);
	});

	it('accepts a legacy TMDB preview size as the frozen canonical selection', async () => {
		const operations = [
			operation('poster', {
				url: 'https://image.tmdb.org/t/p/original/apply-next.jpg',
				provider: 'tmdb'
			})
		];
		await database
			.update(mediaItems)
			.set({
				selectedPosterUrl: 'https://image.tmdb.org/t/p/w500/apply-next.jpg',
				selectedPosterCandidateId: null,
				selectedPosterProvider: 'tmdb'
			})
			.where(eq(mediaItems.id, mediaItemId));
		await insertJob(operations);

		await expect(
			createApplyAndNextCompletionService(database)({ serverInstanceId, mediaItemId, jobId: 7 })
		).resolves.toMatchObject({ state: 'completed' });
		const [item] = await database.select().from(mediaItems).where(eq(mediaItems.id, mediaItemId));
		expect(item.selectedPosterUrl).toBeNull();
	});

	it('does not canonicalize a custom TMDB-shaped staging URL during completion', async () => {
		const operations = [
			operation('poster', {
				url: 'https://image.tmdb.org/t/p/original/custom.jpg',
				provider: 'custom'
			})
		];
		await database
			.update(mediaItems)
			.set({
				selectedPosterUrl: 'https://image.tmdb.org/t/p/w500/custom.jpg',
				selectedPosterCandidateId: null,
				selectedPosterProvider: 'custom'
			})
			.where(eq(mediaItems.id, mediaItemId));
		await insertJob(operations);

		await expect(
			createApplyAndNextCompletionService(database)({ serverInstanceId, mediaItemId, jobId: 7 })
		).rejects.toMatchObject({ code: 'selection_changed' });
		const [item] = await database.select().from(mediaItems).where(eq(mediaItems.id, mediaItemId));
		expect(item.selectedPosterUrl).toBe('https://image.tmdb.org/t/p/w500/custom.jpg');
	});

	it.each([
		{
			name: 'an equivalent TMDB preview size',
			plannedUrl: 'https://image.tmdb.org/t/p/original/restaged.jpg',
			provider: 'tmdb',
			stagedUrl: 'https://image.tmdb.org/t/p/w780/restaged.jpg'
		},
		{
			name: 'the same custom URL',
			plannedUrl: 'https://art.example/restaged.jpg',
			provider: 'custom',
			stagedUrl: 'https://art.example/restaged.jpg'
		}
	])(
		'preserves $name restaged after the frozen plan',
		async ({ plannedUrl, provider, stagedUrl }) => {
			const operations = [operation('poster', { url: plannedUrl, provider })];
			await insertJob(operations);
			await database
				.update(mediaItems)
				.set({
					selectedPosterUrl: stagedUrl,
					selectedPosterCandidateId: null,
					selectedPosterProvider: provider,
					selectionUpdatedAt: new Date(plannedSelectionUpdatedAt),
					selectionRevision: sql`${mediaItems.selectionRevision} + 1`
				})
				.where(eq(mediaItems.id, mediaItemId));

			await expect(
				createApplyAndNextCompletionService(database)({ serverInstanceId, mediaItemId, jobId: 7 })
			).rejects.toMatchObject({ code: 'selection_changed' });
			const [item] = await database.select().from(mediaItems).where(eq(mediaItems.id, mediaItemId));
			expect(item.selectedPosterUrl).toBe(stagedUrl);
			expect(item.selectionUpdatedAt?.toISOString()).toBe(plannedSelectionUpdatedAt);
			expect(item.selectionRevision).toBe(plannedSelectionRevision + 1);
			expect(await database.select().from(reviewEvents)).toEqual([]);
		}
	);

	it('preserves matching root and child staging after two restages at the same clock value', async () => {
		await insertCompletedJob();
		const sameClock = new Date(plannedSelectionUpdatedAt);
		await database
			.update(mediaItems)
			.set({
				selectedPosterUrl: 'https://art.example/poster.jpg',
				selectedPosterCandidateId: 101,
				selectedPosterProvider: 'mediux',
				selectionUpdatedAt: sameClock,
				selectionRevision: sql`${mediaItems.selectionRevision} + 1`
			})
			.where(eq(mediaItems.id, mediaItemId));
		await database.transaction(async (tx) => {
			await tx
				.update(childSelections)
				.set({
					url: 'https://art.example/episode.jpg',
					provider: 'mediux',
					updatedAt: sameClock
				})
				.where(
					and(
						eq(childSelections.serverInstanceId, serverInstanceId),
						eq(childSelections.mediaItemId, mediaItemId)
					)
				);
			await tx
				.update(mediaItems)
				.set({
					selectionUpdatedAt: sameClock,
					selectionRevision: sql`${mediaItems.selectionRevision} + 1`
				})
				.where(eq(mediaItems.id, mediaItemId));
		});

		await expect(
			createApplyAndNextCompletionService(database)({ serverInstanceId, mediaItemId, jobId: 7 })
		).rejects.toMatchObject({ code: 'selection_changed' });
		const [item] = await database.select().from(mediaItems).where(eq(mediaItems.id, mediaItemId));
		expect(item).toMatchObject({
			selectedPosterUrl: 'https://art.example/poster.jpg',
			selectedPosterCandidateId: 101,
			selectedPosterProvider: 'mediux',
			selectionRevision: plannedSelectionRevision + 2
		});
		expect(item.selectionUpdatedAt?.toISOString()).toBe(plannedSelectionUpdatedAt);
		const children = await database.select().from(childSelections);
		expect(children).toHaveLength(1);
		expect(children[0]).toMatchObject({
			url: 'https://art.example/episode.jpg',
			provider: 'mediux'
		});
		expect(await database.select().from(reviewEvents)).toEqual([]);
	});

	it('accepts a revisionless legacy plan only while the current revision is zero', async () => {
		const operations = [
			operation('poster', { url: 'https://art.example/poster.jpg', provider: 'mediux' })
		];
		await database
			.update(mediaItems)
			.set({
				selectionRevision: 0,
				selectionUpdatedAt: new Date(plannedSelectionUpdatedAt)
			})
			.where(eq(mediaItems.id, mediaItemId));
		await insertJob(operations, { omitSelectionRevision: true });

		await expect(
			createApplyAndNextCompletionService(
				database,
				() => new Date('2026-07-11T12:00:00.000Z')
			)({ serverInstanceId, mediaItemId, jobId: 7 })
		).resolves.toMatchObject({ state: 'completed' });
		const [item] = await database.select().from(mediaItems).where(eq(mediaItems.id, mediaItemId));
		expect(item.selectedPosterUrl).toBeNull();
		expect(item.selectionRevision).toBe(1);
	});

	it('preserves matching staging when a revisionless legacy timestamp changed', async () => {
		const operations = [
			operation('poster', { url: 'https://art.example/poster.jpg', provider: 'mediux' })
		];
		const restagedAt = new Date('2026-07-11T09:30:00.000Z');
		await database
			.update(mediaItems)
			.set({ selectionRevision: 0, selectionUpdatedAt: restagedAt })
			.where(eq(mediaItems.id, mediaItemId));
		await insertJob(operations, { omitSelectionRevision: true });

		await expect(
			createApplyAndNextCompletionService(database)({ serverInstanceId, mediaItemId, jobId: 7 })
		).rejects.toMatchObject({ code: 'selection_changed' });
		const [item] = await database.select().from(mediaItems).where(eq(mediaItems.id, mediaItemId));
		expect(item).toMatchObject({
			selectedPosterUrl: 'https://art.example/poster.jpg',
			selectedPosterCandidateId: 101,
			selectedPosterProvider: 'mediux',
			selectionRevision: 0
		});
		expect(item.selectionUpdatedAt?.toISOString()).toBe(restagedAt.toISOString());
		expect(await database.select().from(reviewEvents)).toEqual([]);
	});

	it('accepts a revisionless legacy plan when both timestamps are null', async () => {
		const operations = [
			operation('poster', { url: 'https://art.example/poster.jpg', provider: 'mediux' })
		];
		await database
			.update(mediaItems)
			.set({ selectionRevision: 0, selectionUpdatedAt: null })
			.where(eq(mediaItems.id, mediaItemId));
		await insertJob(operations, {
			omitSelectionRevision: true,
			selectionUpdatedAt: null
		});

		await expect(
			createApplyAndNextCompletionService(database)({ serverInstanceId, mediaItemId, jobId: 7 })
		).resolves.toMatchObject({ state: 'completed' });
		const [item] = await database.select().from(mediaItems).where(eq(mediaItems.id, mediaItemId));
		expect(item.selectedPosterUrl).toBeNull();
		expect(item.selectionRevision).toBe(1);
	});

	it('uses an explicitly frozen revision zero alone when a versioned timestamp differs', async () => {
		const operations = [
			operation('poster', { url: 'https://art.example/poster.jpg', provider: 'mediux' })
		];
		await database
			.update(mediaItems)
			.set({
				selectionRevision: 0,
				selectionUpdatedAt: new Date('2026-07-11T09:30:00.000Z')
			})
			.where(eq(mediaItems.id, mediaItemId));
		await insertJob(operations, { selectionRevision: 0 });

		await expect(
			createApplyAndNextCompletionService(database)({ serverInstanceId, mediaItemId, jobId: 7 })
		).resolves.toMatchObject({ state: 'completed' });
		const [item] = await database.select().from(mediaItems).where(eq(mediaItems.id, mediaItemId));
		expect(item.selectedPosterUrl).toBeNull();
		expect(item.selectionRevision).toBe(1);
	});

	it('rejects a revisionless legacy plan once the current revision has advanced', async () => {
		await insertCompletedJob({ version: { omitSelectionRevision: true } });

		await expect(
			createApplyAndNextCompletionService(database)({ serverInstanceId, mediaItemId, jobId: 7 })
		).rejects.toMatchObject({ code: 'selection_changed' });
		const [item] = await database.select().from(mediaItems).where(eq(mediaItems.id, mediaItemId));
		expect(item).toMatchObject({
			selectedPosterUrl: 'https://art.example/poster.jpg',
			selectedPosterCandidateId: 101,
			selectedPosterProvider: 'mediux',
			selectionRevision: plannedSelectionRevision
		});
		expect(await database.select().from(childSelections)).toHaveLength(1);
		expect(await database.select().from(reviewEvents)).toEqual([]);
	});

	it('does not let an idempotent replay skip newly staged review work', async () => {
		await insertCompletedJob();
		const complete = createApplyAndNextCompletionService(database);
		await complete({ serverInstanceId, mediaItemId, jobId: 7 });
		await database
			.update(mediaItems)
			.set({
				selectedPosterUrl: 'https://art.example/new-review.jpg',
				selectedPosterCandidateId: null,
				selectedPosterProvider: 'custom',
				selectionUpdatedAt: new Date('2026-07-11T13:00:00.000Z'),
				selectionRevision: sql`${mediaItems.selectionRevision} + 1`
			})
			.where(
				and(eq(mediaItems.serverInstanceId, serverInstanceId), eq(mediaItems.id, mediaItemId))
			);

		await expect(complete({ serverInstanceId, mediaItemId, jobId: 7 })).rejects.toMatchObject({
			code: 'selection_changed'
		});
		const [item] = await database.select().from(mediaItems).where(eq(mediaItems.id, mediaItemId));
		expect(item.selectedPosterUrl).toBe('https://art.example/new-review.jpg');
		expect(await database.select().from(reviewEvents)).toHaveLength(1);
	});
});
