import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { and, eq } from 'drizzle-orm';
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
const restagedSelectionUpdatedAt = new Date('2026-07-11T11:00:00.000Z');

function frozenIdentity(selectionUpdatedAt: unknown = plannedSelectionUpdatedAt) {
	return {
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
		selectionUpdatedAt
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
	selectionUpdatedAt: unknown = plannedSelectionUpdatedAt
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
						target: frozenIdentity(selectionUpdatedAt),
						selectionFrom: frozenIdentity(selectionUpdatedAt),
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
					job: job(operations, {}, selectionUpdatedAt),
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
				job: job(operations, {}, null),
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
		selectionUpdatedAt: new Date(plannedSelectionUpdatedAt)
	});
});

afterEach(() => {
	client.close();
	for (const suffix of ['', '-shm', '-wal']) rmSync(`${databasePath}${suffix}`, { force: true });
});

async function insertJob(operations: ReturnType<typeof operation>[]) {
	await database.insert(jobs).values({
		id: 7,
		serverInstanceId,
		type: 'apply',
		status: 'completed',
		payload: job(operations).payload,
		result: job(operations).result
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

async function insertCompletedJob() {
	const frozenOperations = [
		operation('poster', { url: 'https://art.example/poster.jpg' }),
		operation('episode', {
			kind: 'title_card',
			season: 1,
			episode: 2,
			url: 'https://art.example/episode.jpg'
		})
	];
	await database.insert(childSelections).values({
		serverInstanceId,
		mediaItemId,
		kind: 'title_card',
		season: 1,
		episode: 2,
		url: 'https://art.example/episode.jpg'
	});
	await insertJob(frozenOperations);
}

describe('Apply and next completion service', () => {
	it('atomically clears the exact staging, records completion, and is idempotent', async () => {
		await insertCompletedJob();
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
				selectionUpdatedAt: mediaItems.selectionUpdatedAt,
				reviewedAt: mediaItems.reviewedAt
			})
			.from(mediaItems)
			.where(eq(mediaItems.id, mediaItemId));
		expect(item).toMatchObject({ poster: null, background: null });
		expect(item.selectionUpdatedAt?.toISOString()).toBe('2026-07-11T12:00:00.000Z');
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
				selectionUpdatedAt: restagedSelectionUpdatedAt
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
			.set({ selectedPosterUrl: 'https://image.tmdb.org/t/p/w500/apply-next.jpg' })
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
			.set({ selectedPosterUrl: 'https://image.tmdb.org/t/p/w500/custom.jpg' })
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
				.set({ selectedPosterUrl: stagedUrl, selectionUpdatedAt: restagedSelectionUpdatedAt })
				.where(eq(mediaItems.id, mediaItemId));

			await expect(
				createApplyAndNextCompletionService(database)({ serverInstanceId, mediaItemId, jobId: 7 })
			).rejects.toMatchObject({ code: 'selection_changed' });
			const [item] = await database.select().from(mediaItems).where(eq(mediaItems.id, mediaItemId));
			expect(item.selectedPosterUrl).toBe(stagedUrl);
			expect(item.selectionUpdatedAt?.toISOString()).toBe(restagedSelectionUpdatedAt.toISOString());
			expect(await database.select().from(reviewEvents)).toEqual([]);
		}
	);

	it('preserves a child selection restaged with the same URL after the frozen plan', async () => {
		await insertCompletedJob();
		await database
			.update(mediaItems)
			.set({ selectionUpdatedAt: restagedSelectionUpdatedAt })
			.where(eq(mediaItems.id, mediaItemId));

		await expect(
			createApplyAndNextCompletionService(database)({ serverInstanceId, mediaItemId, jobId: 7 })
		).rejects.toMatchObject({ code: 'selection_changed' });
		const children = await database.select().from(childSelections);
		expect(children).toHaveLength(1);
		expect(children[0]?.url).toBe('https://art.example/episode.jpg');
		expect(await database.select().from(reviewEvents)).toEqual([]);
	});

	it('does not delete child selections when the completion compare-and-swap updates no row', async () => {
		const operations = [
			operation('poster', { url: 'https://art.example/poster.jpg' }),
			operation('episode', {
				kind: 'title_card',
				season: 1,
				episode: 2,
				url: 'https://art.example/episode.jpg'
			})
		];
		type Query = Promise<unknown[]> & {
			where: () => Query;
			limit: () => Query;
		};
		const query = (rows: unknown[]): Query => {
			const result = Promise.resolve(rows) as Query;
			result.where = () => result;
			result.limit = () => result;
			return result;
		};
		const returning = vi.fn().mockResolvedValue([]);
		const deleteSelections = vi.fn(() => {
			throw new Error('child selections must not be deleted after a failed compare-and-swap');
		});
		const fakeTransaction = {
			select: vi.fn(() => ({
				from: (table: unknown) => {
					if (table === mediaItems) {
						return query([
							{
								selectedPosterUrl: 'https://art.example/poster.jpg',
								selectedBackgroundUrl: null,
								selectionUpdatedAt: new Date(plannedSelectionUpdatedAt),
								state: 'selected'
							}
						]);
					}
					if (table === reviewEvents) return query([]);
					if (table === jobs) return query([job(operations)]);
					if (table === jobItemOutcomes) return query(outcomes(operations));
					if (table === childSelections) {
						return query([
							{
								id: 1,
								kind: 'title_card',
								season: 1,
								episode: 2,
								url: 'https://art.example/episode.jpg'
							}
						]);
					}
					throw new Error('unexpected table');
				}
			})),
			update: vi.fn(() => ({
				set: () => ({
					where: () => ({ returning })
				})
			})),
			delete: deleteSelections
		};
		const casMissDatabase = {
			transaction: (callback: (tx: typeof fakeTransaction) => unknown) => callback(fakeTransaction)
		} as unknown as LibSQLDatabase<typeof schema>;

		await expect(
			createApplyAndNextCompletionService(casMissDatabase)({
				serverInstanceId,
				mediaItemId,
				jobId: 7
			})
		).rejects.toMatchObject({ code: 'selection_changed' });
		expect(returning).toHaveBeenCalledOnce();
		expect(deleteSelections).not.toHaveBeenCalled();
	});

	it('does not let an idempotent replay skip newly staged review work', async () => {
		await insertCompletedJob();
		const complete = createApplyAndNextCompletionService(database);
		await complete({ serverInstanceId, mediaItemId, jobId: 7 });
		await database
			.update(mediaItems)
			.set({
				selectedPosterUrl: 'https://art.example/new-review.jpg',
				selectionUpdatedAt: restagedSelectionUpdatedAt
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
