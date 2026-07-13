import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

function operation(
	id: string,
	input: { kind?: string; season?: number | null; episode?: number | null; url?: string } = {}
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
		selection: { url: input.url ?? `https://art.example/${id}.jpg` }
	};
}

function job(operations = [operation('poster')], overrides: Record<string, unknown> = {}) {
	return {
		id: 7,
		serverInstanceId,
		type: 'apply',
		status: 'completed',
		payload: { kind: 'apply', plan: { items: [{ operations }] } },
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
		selectedPosterUrl: 'https://art.example/poster.jpg'
	});
});

afterEach(() => {
	client.close();
	for (const suffix of ['', '-shm', '-wal']) rmSync(`${databasePath}${suffix}`, { force: true });
});

async function insertCompletedJob() {
	const operations = [
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
				reviewedAt: mediaItems.reviewedAt
			})
			.from(mediaItems)
			.where(eq(mediaItems.id, mediaItemId));
		expect(item).toMatchObject({ poster: null, background: null });
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
			.set({ selectedPosterUrl: 'https://art.example/newer.jpg' })
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

	it('does not let an idempotent replay skip newly staged review work', async () => {
		await insertCompletedJob();
		const complete = createApplyAndNextCompletionService(database);
		await complete({ serverInstanceId, mediaItemId, jobId: 7 });
		await database
			.update(mediaItems)
			.set({ selectedPosterUrl: 'https://art.example/new-review.jpg' })
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
