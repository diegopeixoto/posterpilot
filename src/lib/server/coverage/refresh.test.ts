import { beforeEach, describe, expect, it, vi } from 'vitest';

// The module-level singleton in refresh.ts reaches the real config and filesystem;
// every test drives an injected refresher instead, so the ambient env is only here
// to let the module load.
vi.mock('$env/dynamic/private', () => ({ env: {} }));

// Real migrations against an in-memory database so the refresher writes through the
// actual DDL — the destination/status CHECK and the three partial slot uniques.
//
// Shared-cache memory rather than plain `:memory:`, for the reason write-queue.ts
// documents: this client discards its native connection around `transaction()`, and a
// second connection to `:memory:` is a second, empty database.
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

// Hoisted so the factory can close over it: `vi.mock` runs before the module body.
const { logEvent } = vi.hoisted(() => ({ logEvent: vi.fn(async () => undefined) }));
vi.mock('$lib/server/events', () => ({ logEvent, pruneEvents: async () => undefined }));

import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	artworkCoverage,
	artworkRevisionGroups,
	artworkRevisions,
	artworkSlotStates,
	mediaItems,
	serverInstances
} from '$lib/server/db/schema';
import { createCoverageStore } from './store';
import { createCoverageRefresher } from './refresh';

const NOW = new Date('2026-08-08T12:00:00.000Z');
const APPLIED_AT = new Date('2026-08-08T10:00:00.000Z');

const store = createCoverageStore(db, { clock: () => NOW });

const ITEMS = { movie: 0, show: 0, untouched: 0 };
const files = new Map<string, string>();

/** A refresher over the migrated in-memory database and an in-memory Kometa directory. */
function refresher() {
	return createCoverageRefresher({
		database: db,
		store,
		clock: () => NOW,
		loadKometaDirectory: async () => '/kometa',
		readMetadataFile: (path) => files.get(path) ?? null
	});
}

async function reset(): Promise<void> {
	for (const table of [
		artworkCoverage,
		artworkRevisions,
		artworkRevisionGroups,
		artworkSlotStates,
		mediaItems,
		serverInstances
	]) {
		await db.delete(table);
	}
	files.clear();
	logEvent.mockClear();

	await db
		.insert(serverInstances)
		.values([{ id: 'server-a', name: 'A', normalizedName: 'a', type: 'plex' }]);
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
				tmdbId: '105'
			},
			{
				serverInstanceId: 'server-a',
				ratingKey: 'show-105',
				sectionKey: 'shows',
				type: 'show',
				title: 'A show numbered 105',
				mediaType: 'tv',
				tmdbId: '105',
				tvdbId: '9105'
			},
			{
				serverInstanceId: 'server-a',
				ratingKey: 'movie-900',
				sectionKey: 'movies',
				type: 'movie',
				title: 'Never touched',
				mediaType: 'movie',
				tmdbId: '900'
			}
		])
		.returning({ id: mediaItems.id });
	ITEMS.movie = inserted[0].id;
	ITEMS.show = inserted[1].id;
	ITEMS.untouched = inserted[2].id;

	await db.insert(artworkRevisionGroups).values({
		id: 'group-1',
		serverInstanceId: 'server-a',
		kind: 'apply',
		initiator: 'user',
		outcome: 'success',
		createdAt: APPLIED_AT,
		completedAt: APPLIED_AT
	});
}

interface RevisionSeed {
	id: string;
	mediaItemId: number;
	destination: 'server' | 'kometa';
	action?: 'apply' | 'undo';
	kind?: 'poster' | 'background';
	outcome?: 'success' | 'failed';
	proposedFingerprint?: string | null;
	provenance?: Record<string, unknown> | null;
}

async function seedRevision(seed: RevisionSeed): Promise<void> {
	await db.insert(artworkRevisions).values({
		id: seed.id,
		groupId: 'group-1',
		serverInstanceId: 'server-a',
		mediaItemId: seed.mediaItemId,
		action: seed.action ?? 'apply',
		destination: seed.destination,
		kind: seed.kind ?? 'poster',
		outcome: seed.outcome ?? 'success',
		verification: 'exact',
		proposedFingerprint: seed.proposedFingerprint ?? null,
		provenance: seed.provenance ?? null,
		createdAt: APPLIED_AT,
		completedAt: APPLIED_AT
	});
}

async function seedSlotState(
	mediaItemId: number,
	currentFingerprint: string | null
): Promise<void> {
	await db.insert(artworkSlotStates).values({
		serverInstanceId: 'server-a',
		mediaItemId,
		kind: 'poster',
		currentFingerprint,
		lastVerifiedAt: APPLIED_AT,
		updatedAt: APPLIED_AT
	});
}

function coverageRows() {
	return db.select().from(artworkCoverage).orderBy(artworkCoverage.id);
}

beforeEach(reset);

describe('server coverage refresh', () => {
	it('reports a matching fingerprint as applied and stamps the observation time', async () => {
		await seedRevision({
			id: 'revision-1',
			mediaItemId: ITEMS.movie,
			destination: 'server',
			proposedFingerprint: 'sha-a'
		});
		await seedSlotState(ITEMS.movie, 'sha-a');

		const results = await refresher().refreshServerCoverage({ serverInstanceId: 'server-a' });

		expect(results).toEqual([{ destination: 'server', occurrences: 1, deleted: 0, written: 1 }]);
		const [row] = await coverageRows();
		expect(row).toMatchObject({
			mediaItemId: ITEMS.movie,
			librarySectionKey: 'movies',
			canonicalKey: 'movie:105',
			destination: 'server',
			kind: 'poster',
			status: 'applied_on_server',
			evidenceSource: 'server_verified_match',
			evidenceRevisionId: 'revision-1'
		});
		expect(row.observedAt).toEqual(APPLIED_AT);
	});

	it('reports a changed fingerprint as externally changed rather than staying green', async () => {
		await seedRevision({
			id: 'revision-1',
			mediaItemId: ITEMS.movie,
			destination: 'server',
			proposedFingerprint: 'sha-a'
		});
		await seedSlotState(ITEMS.movie, 'sha-b');

		await refresher().refreshServerCoverage({ serverInstanceId: 'server-a' });

		expect((await coverageRows())[0]).toMatchObject({
			status: 'externally_changed',
			evidenceSource: 'server_fingerprint_mismatch'
		});
	});

	it('writes nothing for an occurrence with no evidence at all', async () => {
		await refresher().refreshServerCoverage({ serverInstanceId: 'server-a' });
		// Absence is an anti-join, not a row: materializing `missing` for every slot of
		// every item would dwarf the evidence it surrounds.
		expect(await coverageRows()).toHaveLength(0);
	});

	it('withdraws a claim after an undo instead of reporting artwork we removed', async () => {
		await seedRevision({
			id: 'revision-1',
			mediaItemId: ITEMS.movie,
			destination: 'server',
			proposedFingerprint: 'sha-a'
		});
		await seedSlotState(ITEMS.movie, 'sha-a');
		const refresh = refresher();
		await refresh.refreshServerCoverage({ serverInstanceId: 'server-a' });
		expect((await coverageRows())[0]).toMatchObject({ status: 'applied_on_server' });

		await seedRevision({
			id: 'revision-2',
			mediaItemId: ITEMS.movie,
			destination: 'server',
			action: 'undo'
		});
		await refresh.refreshServerCoverage({
			serverInstanceId: 'server-a',
			mediaItemIds: [ITEMS.movie]
		});

		expect((await coverageRows())[0]).toMatchObject({
			status: 'missing',
			evidenceSource: 'server_no_revision'
		});
	});

	it('drops coverage for a copy that left its library', async () => {
		await seedRevision({
			id: 'revision-1',
			mediaItemId: ITEMS.movie,
			destination: 'server',
			proposedFingerprint: 'sha-a'
		});
		await seedSlotState(ITEMS.movie, 'sha-a');
		const refresh = refresher();
		await refresh.refreshServerCoverage({ serverInstanceId: 'server-a' });

		await db.update(mediaItems).set({ sourceRemovedAt: NOW }).where(eq(mediaItems.id, ITEMS.movie));
		await refresh.refreshServerCoverage({
			serverInstanceId: 'server-a',
			mediaItemIds: [ITEMS.movie]
		});

		// The evidence query skips removed items, so the scoped replace deletes their
		// rows and writes nothing back — the server no longer serves that copy.
		expect(await coverageRows()).toHaveLength(0);
	});

	it('rebuilds only the named library', async () => {
		await seedRevision({
			id: 'revision-1',
			mediaItemId: ITEMS.movie,
			destination: 'server',
			proposedFingerprint: 'sha-a'
		});
		await seedRevision({
			id: 'revision-2',
			mediaItemId: ITEMS.show,
			destination: 'server',
			proposedFingerprint: 'sha-b'
		});
		const refresh = refresher();
		await refresh.refreshServerCoverage({ serverInstanceId: 'server-a' });
		expect(await coverageRows()).toHaveLength(2);

		await refresh.refreshServerCoverage({
			serverInstanceId: 'server-a',
			librarySectionKey: 'movies'
		});
		expect((await coverageRows()).map((row) => row.mediaItemId).sort()).toEqual(
			[ITEMS.movie, ITEMS.show].sort()
		);
	});
});

describe('kometa coverage refresh', () => {
	const MOVIES = '/kometa/posterpilot-movies.yml';

	it('reports a typed export without ever claiming a server applied it', async () => {
		await seedRevision({ id: 'revision-1', mediaItemId: ITEMS.movie, destination: 'kometa' });
		files.set(MOVIES, 'metadata:\n  105:\n    url_poster: https://example.test/a.jpg\n');

		await refresher().refreshKometaCoverage({ serverInstanceId: 'server-a' });

		const rows = await coverageRows();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			destination: 'kometa',
			status: 'exported_to_kometa',
			evidenceSource: 'kometa_typed_export'
		});
		// The exclusion the UI's honesty rests on: a YAML line is not artwork on Plex.
		expect(rows[0].status).not.toBe('applied_on_server');
		// The fingerprint reaches the client, so it must be a hash and not the URL.
		expect(rows[0].evidenceFingerprint).not.toContain('example.test');
	});

	it('reports an absent file as missing and an unparseable one as unknown', async () => {
		await seedRevision({ id: 'revision-1', mediaItemId: ITEMS.movie, destination: 'kometa' });
		const refresh = refresher();

		await refresh.refreshKometaCoverage({ serverInstanceId: 'server-a' });
		expect((await coverageRows())[0]).toMatchObject({
			status: 'missing',
			evidenceSource: 'kometa_no_entry'
		});

		// Two entries under one logical key: the file cannot be read reliably, and
		// reporting `missing` from that would mark an exported library uncovered.
		files.set(MOVIES, "metadata:\n  105:\n    url_poster: a\n  '105':\n    url_poster: b\n");
		await refresh.refreshKometaCoverage({ serverInstanceId: 'server-a' });
		expect((await coverageRows())[0]).toMatchObject({
			status: 'unknown',
			evidenceSource: 'kometa_file_unreadable'
		});
	});

	it('produces unknown rather than missing when the directory cannot be read', async () => {
		await seedRevision({ id: 'revision-1', mediaItemId: ITEMS.movie, destination: 'kometa' });
		const refresh = createCoverageRefresher({
			database: db,
			store,
			clock: () => NOW,
			loadKometaDirectory: async () => '/kometa',
			readMetadataFile: () => {
				throw new Error('EACCES');
			}
		});

		await refresh.refreshKometaCoverage({ serverInstanceId: 'server-a' });
		expect((await coverageRows())[0]).toMatchObject({
			status: 'unknown',
			evidenceSource: 'kometa_file_unreadable'
		});
	});

	it('leaves the projection alone when no Kometa directory resolves', async () => {
		await seedRevision({ id: 'revision-1', mediaItemId: ITEMS.movie, destination: 'kometa' });
		files.set(MOVIES, 'metadata:\n  105:\n    url_poster: https://example.test/a.jpg\n');
		const withDirectory = refresher();
		await withDirectory.refreshKometaCoverage({ serverInstanceId: 'server-a' });
		expect(await coverageRows()).toHaveLength(1);

		const withoutDirectory = createCoverageRefresher({
			database: db,
			store,
			clock: () => NOW,
			loadKometaDirectory: async () => null,
			readMetadataFile: () => null
		});
		expect(await withoutDirectory.refreshKometaCoverage({ serverInstanceId: 'server-a' })).toEqual(
			[]
		);
		// Deleting evidence because we could not look is the same mistake as reporting
		// `missing` for an unreadable file.
		expect(await coverageRows()).toHaveLength(1);
	});

	it('keeps a movie and a show sharing a TMDB number in separate files and identities', async () => {
		await seedRevision({ id: 'revision-1', mediaItemId: ITEMS.movie, destination: 'kometa' });
		await seedRevision({ id: 'revision-2', mediaItemId: ITEMS.show, destination: 'kometa' });
		files.set(MOVIES, 'metadata:\n  105:\n    url_poster: https://example.test/a.jpg\n');
		files.set('/kometa/posterpilot-shows.yml', 'metadata:\n  9105:\n    url_poster: b\n');

		await refresher().refreshKometaCoverage({ serverInstanceId: 'server-a' });

		const rows = await coverageRows();
		expect(rows.map((row) => [row.canonicalKey, row.status]).sort()).toEqual([
			['movie:105', 'exported_to_kometa'],
			['tv:105', 'exported_to_kometa']
		]);
	});

	it('reports absence for an item Kometa carries no identifier for', async () => {
		await db
			.update(mediaItems)
			.set({ tmdbId: null, imdbId: null })
			.where(eq(mediaItems.id, ITEMS.movie));
		await seedRevision({ id: 'revision-1', mediaItemId: ITEMS.movie, destination: 'kometa' });

		await refresher().refreshKometaCoverage({ serverInstanceId: 'server-a' });

		expect((await coverageRows())[0]).toMatchObject({
			status: 'missing',
			evidenceSource: 'kometa_unidentified',
			canonicalKey: null
		});
	});
});

describe('refreshCoverageAfter', () => {
	it('never fails the operation that triggered it, and says so in the log', async () => {
		const failing = createCoverageRefresher({
			database: {
				select: () => {
					throw new Error('database is locked');
				}
			} as never,
			store,
			clock: () => NOW,
			loadKometaDirectory: async () => '/kometa',
			readMetadataFile: () => null
		});

		await expect(
			failing.refreshCoverageAfter('apply', { serverInstanceId: 'server-a', mediaItemIds: [1] })
		).resolves.toBe(false);
		expect(logEvent).toHaveBeenCalledWith(
			'warn',
			'coverage',
			expect.any(String),
			expect.objectContaining({ code: 'coverage_reconciliation_failed', trigger: 'apply' })
		);
	});

	it('reports success when the refresh completed', async () => {
		await expect(
			refresher().refreshCoverageAfter('sync', { serverInstanceId: 'server-a' })
		).resolves.toBe(true);
	});
});

describe('stale reads', () => {
	it('re-observes an occurrence whose evidence has aged out', async () => {
		await seedRevision({
			id: 'revision-1',
			mediaItemId: ITEMS.movie,
			destination: 'server',
			proposedFingerprint: 'sha-a'
		});
		await seedSlotState(ITEMS.movie, 'sha-a');
		const refresh = refresher();
		await refresh.refreshServerCoverage({ serverInstanceId: 'server-a' });
		expect((await coverageRows())[0]).toMatchObject({ status: 'applied_on_server' });

		// Someone re-postered the title directly on the server. Nothing tells us; only
		// re-observing stale evidence does.
		await db
			.update(artworkSlotStates)
			.set({ currentFingerprint: 'sha-b' })
			.where(eq(artworkSlotStates.mediaItemId, ITEMS.movie));

		const rows = await refresh.readItemCoverage('server-a', ITEMS.movie, { maxAgeMs: 60_000 });
		expect(rows[0]).toMatchObject({ status: 'externally_changed' });
	});

	it('does not write for an occurrence that has no evidence to be stale', async () => {
		const rows = await refresher().readItemCoverage('server-a', ITEMS.untouched, { maxAgeMs: 0 });
		expect(rows).toEqual([]);
		expect(await coverageRows()).toHaveLength(0);
	});

	it('walks only the oldest rows on a server', async () => {
		await seedRevision({
			id: 'revision-1',
			mediaItemId: ITEMS.movie,
			destination: 'server',
			proposedFingerprint: 'sha-a'
		});
		await seedSlotState(ITEMS.movie, 'sha-a');
		const refresh = refresher();
		await refresh.refreshServerCoverage({ serverInstanceId: 'server-a' });

		expect(
			await refresh.refreshStaleCoverage({ serverInstanceId: 'server-a', limit: 10 })
		).toHaveLength(2);
		expect(
			await refresh.refreshStaleCoverage({
				serverInstanceId: 'server-a',
				staleBefore: new Date(0)
			})
		).toEqual([]);
	});
});
