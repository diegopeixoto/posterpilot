import { beforeEach, describe, expect, it, vi } from 'vitest';

// Real migrations against an in-memory database: these are SQL predicates, and the
// only honest test of a predicate is the engine running it. Shared-cache memory for
// the reason write-queue.ts documents.
vi.mock('$lib/server/db', async () => {
	const { createClient } = await import('@libsql/client');
	const { drizzle } = await import('drizzle-orm/libsql');
	const { migrate } = await import('drizzle-orm/libsql/migrator');
	const schema = await import('$lib/server/db/schema');
	const client = createClient({ url: 'file::memory:?cache=shared' });
	const db = drizzle(client, { schema });
	await migrate(db, { migrationsFolder: './drizzle' });
	return { db, databaseClient: client, migrateDb: async () => undefined };
});

import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { artworkCoverage, mediaItems, serverInstances } from '$lib/server/db/schema';
import { canonicalIdentityKey, type CoverageStatus } from '$lib/artwork-coverage';
import { coveredStatusesFor, statusesFor } from './store';
import {
	COVERAGE_SELECTIONS,
	coverageSelectionCondition,
	isCoverageSelection,
	loadCoverageOccurrenceCounts,
	loadItemCoverageSummaries,
	type CoverageSelection
} from './observations-query';

const NOW = new Date('2026-08-08T12:00:00.000Z');
const REVIEWED_AT = new Date('2026-08-01T09:00:00.000Z');

/** movie 105 in two libraries on two servers, show 105, and an unresolved item. */
const ITEMS = { movieA: 0, movieB: 0, show: 0, unresolved: 0 };

async function seed(): Promise<void> {
	for (const table of [artworkCoverage, mediaItems, serverInstances]) await db.delete(table);
	await db.insert(serverInstances).values([
		{ id: 'server-a', name: 'A', normalizedName: 'a', type: 'plex' },
		{ id: 'server-b', name: 'B', normalizedName: 'b', type: 'jellyfin' }
	]);
	const inserted = await db
		.insert(mediaItems)
		.values([
			{
				serverInstanceId: 'server-a',
				ratingKey: 'movie-105',
				sectionKey: 'movies',
				type: 'movie',
				title: 'Back to the Future',
				mediaType: 'movie',
				tmdbId: '105',
				reviewedAt: REVIEWED_AT
			},
			{
				serverInstanceId: 'server-b',
				ratingKey: 'movie-105',
				sectionKey: 'films',
				type: 'movie',
				title: 'Back to the Future',
				mediaType: 'movie',
				tmdbId: '105'
			},
			{
				serverInstanceId: 'server-a',
				ratingKey: 'show-105',
				sectionKey: 'shows',
				type: 'show',
				title: 'A show numbered 105',
				mediaType: 'tv',
				tmdbId: '105'
			},
			{
				serverInstanceId: 'server-a',
				ratingKey: 'unresolved',
				sectionKey: 'movies',
				type: 'movie',
				title: 'Unresolved'
			}
		])
		.returning({ id: mediaItems.id });
	ITEMS.movieA = inserted[0].id;
	ITEMS.movieB = inserted[1].id;
	ITEMS.show = inserted[2].id;
	ITEMS.unresolved = inserted[3].id;
}

async function cover(
	mediaItemId: number,
	serverInstanceId: string,
	destination: 'server' | 'kometa',
	status: CoverageStatus,
	kind: 'poster' | 'background' = 'poster'
): Promise<void> {
	const [item] = await db
		.select({
			sectionKey: mediaItems.sectionKey,
			mediaType: mediaItems.mediaType,
			tmdbId: mediaItems.tmdbId
		})
		.from(mediaItems)
		.where(eq(mediaItems.id, mediaItemId));
	await db.insert(artworkCoverage).values({
		serverInstanceId,
		mediaItemId,
		librarySectionKey: item.sectionKey,
		canonicalKey: canonicalIdentityKey(item.mediaType, item.tmdbId),
		destination,
		kind,
		status,
		evidenceSource: 'test',
		observedAt: NOW,
		updatedAt: NOW
	});
}

/** The library/review shape: an item scope plus one coverage predicate. */
async function select(selection: CoverageSelection, serverInstanceId = 'server-a') {
	const rows = await db
		.select({ id: mediaItems.id })
		.from(mediaItems)
		.where(
			and(
				eq(mediaItems.serverInstanceId, serverInstanceId),
				isNull(mediaItems.sourceRemovedAt),
				coverageSelectionCondition(selection)
			)
		)
		.orderBy(asc(mediaItems.id));
	return rows.map((row) => row.id);
}

beforeEach(seed);

describe('coverage selections', () => {
	it('accepts only the published selection vocabulary', () => {
		for (const selection of COVERAGE_SELECTIONS) expect(isCoverageSelection(selection)).toBe(true);
		expect(isCoverageSelection('applied_on_server')).toBe(false);
		expect(isCoverageSelection(undefined)).toBe(false);
	});

	it('derives its status lists from the shared contract rather than a literal', () => {
		// If these were hand-written they could drift from isCovered; asserting the
		// derivation is what keeps the SQL and the vocabulary the same definition.
		expect(coveredStatusesFor('server')).toEqual(['applied_on_server']);
		expect(coveredStatusesFor('kometa')).toEqual(['exported_to_kometa']);
		expect(statusesFor('kometa')).not.toContain('applied_on_server');
	});

	it('matches applied-on-this-server only for a verified server apply', async () => {
		await cover(ITEMS.movieA, 'server-a', 'server', 'applied_on_server');
		await cover(ITEMS.show, 'server-a', 'server', 'recorded_unverified');
		expect(await select('applied_on_this_server')).toEqual([ITEMS.movieA]);
	});

	it('never lets a Kometa export satisfy applied-on-this-server', async () => {
		await cover(ITEMS.movieA, 'server-a', 'kometa', 'exported_to_kometa');
		expect(await select('applied_on_this_server')).toEqual([]);
		expect(await select('exported_to_kometa')).toEqual([ITEMS.movieA]);
	});

	it('treats an item with no coverage rows at all as needing artwork', async () => {
		await cover(ITEMS.movieA, 'server-a', 'server', 'applied_on_server');
		await cover(ITEMS.show, 'server-a', 'kometa', 'exported_to_kometa');
		// Absence is an anti-join: the unresolved item has never been observed and has
		// no `missing` row to match, yet it is exactly what the filter is looking for.
		expect(await select('needs_artwork')).toEqual([ITEMS.unresolved]);
	});

	it('counts an item whose only evidence is missing or unknown as needing artwork', async () => {
		await cover(ITEMS.movieA, 'server-a', 'server', 'missing');
		await cover(ITEMS.show, 'server-a', 'server', 'externally_changed');
		expect(await select('needs_artwork')).toEqual([ITEMS.movieA, ITEMS.show, ITEMS.unresolved]);
	});

	it('matches unknown for indeterminate evidence at either destination', async () => {
		await cover(ITEMS.movieA, 'server-a', 'server', 'recorded_unverified');
		await cover(ITEMS.show, 'server-a', 'kometa', 'unknown');
		await cover(ITEMS.unresolved, 'server-a', 'server', 'missing');
		expect(await select('unknown')).toEqual([ITEMS.movieA, ITEMS.show]);
	});

	it('reports each destination and slot independently', async () => {
		await cover(ITEMS.movieA, 'server-a', 'server', 'applied_on_server', 'poster');
		await cover(ITEMS.movieA, 'server-a', 'server', 'missing', 'background');
		// One covered slot makes the item covered; it never collapses the other slot.
		expect(await select('applied_on_this_server')).toEqual([ITEMS.movieA]);
		const summaries = await loadItemCoverageSummaries(db, 'server-a', [ITEMS.movieA]);
		expect(summaries.get(ITEMS.movieA)?.server).toMatchObject({
			covered: 1,
			observed: 2,
			byStatus: expect.objectContaining({ applied_on_server: 1, missing: 1 })
		});
	});

	it('returns one row per item, not one per covered slot', async () => {
		await cover(ITEMS.movieA, 'server-a', 'server', 'applied_on_server', 'poster');
		await cover(ITEMS.movieA, 'server-a', 'server', 'applied_on_server', 'background');
		expect(await select('applied_on_this_server')).toEqual([ITEMS.movieA]);
	});

	it('does not mutate reviewedAt', async () => {
		await cover(ITEMS.movieA, 'server-a', 'server', 'applied_on_server');
		for (const selection of COVERAGE_SELECTIONS) await select(selection);
		await loadItemCoverageSummaries(db, 'server-a', [ITEMS.movieA]);
		await loadCoverageOccurrenceCounts(db, [
			{ mediaItemId: ITEMS.movieA, canonicalKey: 'movie:105' }
		]);

		const [row] = await db
			.select({ reviewedAt: mediaItems.reviewedAt })
			.from(mediaItems)
			.where(eq(mediaItems.id, ITEMS.movieA));
		// Workflow completion is the user's statement about their queue; destination
		// evidence is ours about the world. Reading one must never edit the other.
		expect(row.reviewedAt).toEqual(REVIEWED_AT);
	});
});

describe('item coverage summaries', () => {
	it('zero-fills every status the destination can hold', async () => {
		const summaries = await loadItemCoverageSummaries(db, 'server-a', [ITEMS.movieA]);
		const summary = summaries.get(ITEMS.movieA);
		expect(Object.keys(summary!.server.byStatus).sort()).toEqual([...statusesFor('server')].sort());
		expect(Object.keys(summary!.kometa.byStatus)).not.toContain('applied_on_server');
		expect(summary!.server).toMatchObject({ covered: 0, observed: 0 });
	});

	it('returns an entry for every requested id, not only those with rows', async () => {
		const summaries = await loadItemCoverageSummaries(db, 'server-a', [
			ITEMS.movieA,
			ITEMS.unresolved
		]);
		expect([...summaries.keys()].sort()).toEqual([ITEMS.movieA, ITEMS.unresolved].sort());
	});
});

describe('occurrence counts', () => {
	it('relates copies of one title across servers and libraries', async () => {
		await cover(ITEMS.movieA, 'server-a', 'server', 'applied_on_server');
		const counts = await loadCoverageOccurrenceCounts(db, [
			{ mediaItemId: ITEMS.movieA, canonicalKey: 'movie:105' }
		]);
		expect(counts.get(ITEMS.movieA)).toEqual({
			canonicalKey: 'movie:105',
			occurrences: 2,
			servers: 2,
			libraries: 2,
			coveredOccurrences: 1
		});
	});

	it('keeps a movie and a show sharing a number apart', async () => {
		const counts = await loadCoverageOccurrenceCounts(db, [
			{ mediaItemId: ITEMS.show, canonicalKey: 'tv:105' }
		]);
		expect(counts.get(ITEMS.show)).toMatchObject({ occurrences: 1, servers: 1, libraries: 1 });
	});

	it('leaves an unresolved copy standing alone', async () => {
		const counts = await loadCoverageOccurrenceCounts(db, [
			{ mediaItemId: ITEMS.unresolved, canonicalKey: null }
		]);
		// Never joined to another item by title or year — that is the guess the
		// canonical key exists to prevent.
		expect(counts.get(ITEMS.unresolved)).toEqual({
			canonicalKey: null,
			occurrences: 1,
			servers: 1,
			libraries: 1,
			coveredOccurrences: 0
		});
	});

	it('does not count a copy that left its library', async () => {
		await db
			.update(mediaItems)
			.set({ sourceRemovedAt: NOW })
			.where(eq(mediaItems.id, ITEMS.movieB));
		const counts = await loadCoverageOccurrenceCounts(db, [
			{ mediaItemId: ITEMS.movieA, canonicalKey: 'movie:105' }
		]);
		expect(counts.get(ITEMS.movieA)).toMatchObject({ occurrences: 1, servers: 1 });
	});

	it('matches the JS trim for a tmdb_id padded with non-space whitespace', async () => {
		// `canonicalIdentityKey` strips all Unicode whitespace; SQLite's bare trim()
		// strips only U+0020. The SQL twin must agree, or a tab-padded id silently
		// falls back to "one uncovered copy" while its twin is covered elsewhere.
		await db.update(mediaItems).set({ tmdbId: '105\t' }).where(eq(mediaItems.id, ITEMS.movieB));
		await cover(ITEMS.movieB, 'server-b', 'server', 'applied_on_server');

		const counts = await loadCoverageOccurrenceCounts(db, [
			{ mediaItemId: ITEMS.movieA, canonicalKey: 'movie:105' }
		]);
		expect(counts.get(ITEMS.movieA)).toMatchObject({
			occurrences: 2,
			servers: 2,
			coveredOccurrences: 1
		});
	});
});
