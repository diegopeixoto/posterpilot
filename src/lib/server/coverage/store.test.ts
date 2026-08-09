import { beforeEach, describe, expect, it, vi } from 'vitest';

// The real migrations run against an in-memory database so these tests exercise the actual
// DDL — the destination/status CHECK, the three partial slot uniques, and the scope trigger
// — rather than a hand-written approximation of them.
//
// Shared-cache memory rather than plain `:memory:`, for the reason write-queue.ts documents:
// this client discards its native connection around `transaction()`, and a second connection
// to `:memory:` is a second, empty database.
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

import { and, eq, sql } from 'drizzle-orm';
import { databaseClient, db } from '$lib/server/db';
import {
	artworkCoverage,
	artworkRevisionGroups,
	artworkRevisions,
	mediaItems,
	serverInstances
} from '$lib/server/db/schema';
import {
	COVERAGE_DESTINATIONS,
	COVERAGE_STATUSES,
	isStatusValidForDestination
} from '$lib/artwork-coverage';
import {
	CoverageStoreError,
	coverageSlotCondition,
	coveredStatusesFor,
	createCoverageStore,
	statusesFor,
	type CoverageObservation
} from './store';

const OBSERVED = new Date('2026-08-01T10:00:00.000Z');
const NOW = new Date('2026-08-01T12:00:00.000Z');

const store = createCoverageStore(db, { clock: () => NOW });

/** movie 105 on server-a, movie 105 on server-b, show 105 on server-a, and an unresolved item. */
const ITEMS = {
	movieA: 0,
	movieB: 0,
	show: 0,
	unresolved: 0
};

async function seed(): Promise<void> {
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
				tmdbId: '105'
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
				title: 'Un-numbered show',
				mediaType: 'tv',
				tmdbId: '105'
			},
			{
				serverInstanceId: 'server-a',
				ratingKey: 'movie-unresolved',
				sectionKey: 'movies',
				type: 'movie',
				title: 'Back to the Future'
			}
		])
		.returning({ id: mediaItems.id });
	[ITEMS.movieA, ITEMS.movieB, ITEMS.show, ITEMS.unresolved] = inserted.map((row) => row.id);

	await db.insert(artworkRevisionGroups).values({
		id: 'group-1',
		serverInstanceId: 'server-a',
		kind: 'apply',
		initiator: 'user'
	});
	await db.insert(artworkRevisions).values({
		id: 'revision-1',
		groupId: 'group-1',
		serverInstanceId: 'server-a',
		mediaItemId: ITEMS.movieA,
		action: 'apply',
		destination: 'server',
		kind: 'poster',
		outcome: 'success',
		verification: 'exact'
	});
}

function observation(overrides: Partial<CoverageObservation> = {}): CoverageObservation {
	return {
		serverInstanceId: 'server-a',
		mediaItemId: ITEMS.movieA,
		destination: 'server',
		kind: 'poster',
		status: 'applied_on_server',
		evidenceSource: 'revision',
		evidenceRevisionId: 'revision-1',
		evidenceFingerprint: 'sha256:poster-v2',
		observedAt: OBSERVED,
		...overrides
	};
}

beforeEach(async () => {
	await db.delete(artworkCoverage);
	await db.delete(artworkRevisions);
	await db.delete(artworkRevisionGroups);
	await db.delete(mediaItems);
	await db.delete(serverInstances);
	await seed();
});

describe('recording evidence', () => {
	it('stamps occurrence provenance and canonical identity the caller never supplies', async () => {
		expect(await store.record([observation()])).toBe(1);

		const [row] = await db.select().from(artworkCoverage);
		expect(row).toMatchObject({
			serverInstanceId: 'server-a',
			mediaItemId: ITEMS.movieA,
			librarySectionKey: 'movies',
			canonicalKey: 'movie:105',
			destination: 'server',
			kind: 'poster',
			season: null,
			episode: null,
			status: 'applied_on_server',
			evidenceSource: 'revision',
			evidenceRevisionId: 'revision-1',
			evidenceFingerprint: 'sha256:poster-v2'
		});
		// Observation time is the reconciler's, not the write's: a replayed verification must
		// not claim it just happened.
		expect(row.observedAt.getTime()).toBe(OBSERVED.getTime());
		expect(row.updatedAt.getTime()).toBe(NOW.getTime());
	});

	it('leaves an unresolved occurrence without a canonical key so nothing relates it by title', async () => {
		await store.record([observation({ mediaItemId: ITEMS.unresolved })]);

		const [row] = await db
			.select()
			.from(artworkCoverage)
			.where(eq(artworkCoverage.mediaItemId, ITEMS.unresolved));
		expect(row.canonicalKey).toBeNull();
		// It shares a title and a library with the resolved copy and still gets no identity.
		expect(row.librarySectionKey).toBe('movies');
	});

	it('keeps a movie and a show with the same TMDB number as separate identities', async () => {
		await store.record([
			observation(),
			observation({ mediaItemId: ITEMS.show, kind: 'background' })
		]);

		const rows = await db
			.select({ id: artworkCoverage.mediaItemId, canonicalKey: artworkCoverage.canonicalKey })
			.from(artworkCoverage)
			.orderBy(artworkCoverage.mediaItemId);
		expect(rows).toEqual([
			{ id: ITEMS.movieA, canonicalKey: 'movie:105' },
			{ id: ITEMS.show, canonicalKey: 'tv:105' }
		]);
	});

	it('relates copies across servers and libraries while keeping each occurrence distinct', async () => {
		await store.record([
			observation(),
			observation({ serverInstanceId: 'server-b', mediaItemId: ITEMS.movieB })
		]);

		const copies = await db
			.select({
				server: artworkCoverage.serverInstanceId,
				library: artworkCoverage.librarySectionKey
			})
			.from(artworkCoverage)
			.where(eq(artworkCoverage.canonicalKey, 'movie:105'))
			.orderBy(artworkCoverage.serverInstanceId);
		expect(copies).toEqual([
			{ server: 'server-a', library: 'movies' },
			{ server: 'server-b', library: 'films' }
		]);
	});

	it('upserts one slot without disturbing the others', async () => {
		await store.record([
			observation(),
			observation({ kind: 'background', status: 'missing', evidenceSource: 'server_verification' }),
			observation({ kind: 'poster', season: 1, evidenceSource: 'server_verification' }),
			observation({
				kind: 'title_card',
				season: 1,
				episode: 2,
				evidenceSource: 'server_verification'
			})
		]);
		await store.record([
			observation({ status: 'externally_changed', evidenceSource: 'server_verification' })
		]);

		const rows = await store.getItemCoverage('server-a', ITEMS.movieA);
		expect(rows).toHaveLength(4);
		expect(rows.map((row) => [row.kind, row.season, row.episode, row.status])).toEqual([
			['background', null, null, 'missing'],
			['poster', null, null, 'externally_changed'],
			['poster', 1, null, 'applied_on_server'],
			['title_card', 1, 2, 'applied_on_server']
		]);
	});

	it('records the same slot independently per destination', async () => {
		await store.record([
			observation(),
			observation({
				destination: 'kometa',
				status: 'exported_to_kometa',
				evidenceSource: 'kometa_file',
				evidenceRevisionId: null
			})
		]);

		const rows = await store.getItemCoverage('server-a', ITEMS.movieA);
		expect(rows.map((row) => [row.destination, row.status])).toEqual([
			['kometa', 'exported_to_kometa'],
			['server', 'applied_on_server']
		]);
	});
});

describe('the write boundary', () => {
	it('rejects a Kometa export recorded as applied on a server, and the reverse', async () => {
		await expect(
			store.record([observation({ destination: 'server', status: 'exported_to_kometa' })])
		).rejects.toMatchObject({
			name: 'CoverageStoreError',
			code: 'invalid_status_for_destination'
		});
		await expect(
			store.record([observation({ destination: 'kometa', status: 'applied_on_server' })])
		).rejects.toMatchObject({ code: 'invalid_status_for_destination' });
		expect(await db.select().from(artworkCoverage)).toHaveLength(0);
	});

	it('rejects every invalid destination/status pairing at the table itself', async () => {
		// The store is not the only possible writer — a migration, a restore, or a manual fix
		// reaches the table directly. Prove the CHECK holds for all of them.
		const invalid = COVERAGE_DESTINATIONS.flatMap((destination) =>
			COVERAGE_STATUSES.filter((status) => !isStatusValidForDestination(destination, status)).map(
				(status) => [destination, status] as const
			)
		);
		expect(invalid).toEqual([
			['server', 'exported_to_kometa'],
			['kometa', 'applied_on_server'],
			['kometa', 'recorded_unverified'],
			['kometa', 'externally_changed']
		]);
		for (const [destination, status] of invalid) {
			await expect(rawInsert(ITEMS.movieA, destination, status)).rejects.toThrow(
				/CHECK constraint failed/
			);
		}
	});

	it('accepts every valid destination/status pairing', async () => {
		// One season per status so each lands in its own slot rather than replacing the last.
		let season = 0;
		for (const destination of COVERAGE_DESTINATIONS) {
			for (const status of statusesFor(destination)) {
				await store.record([
					observation({
						destination,
						status,
						season: ++season,
						evidenceSource: 'test',
						evidenceRevisionId: null
					})
				]);
			}
		}
		const rows = await store.getItemCoverage('server-a', ITEMS.movieA);
		expect(rows.map((row) => `${row.destination}:${row.status}`).sort()).toEqual(
			[
				...statusesFor('server').map((status) => `server:${status}`),
				...statusesFor('kometa').map((status) => `kometa:${status}`)
			].sort()
		);
	});

	it('refuses a status nobody can explain', async () => {
		await expect(store.record([observation({ evidenceSource: '  ' })])).rejects.toMatchObject({
			code: 'invalid_evidence'
		});
	});

	it('refuses an episode slot with no season, which the unique index could not hold', async () => {
		await expect(
			store.record([observation({ kind: 'title_card', episode: 3 })])
		).rejects.toMatchObject({ code: 'invalid_slot' });
	});

	it('refuses an occurrence that does not exist on the named server', async () => {
		await expect(
			store.record([observation({ serverInstanceId: 'server-b' })])
		).rejects.toMatchObject({ code: 'unknown_occurrence' });
		await expect(store.record([observation({ mediaItemId: 999_999 })])).rejects.toMatchObject({
			code: 'unknown_occurrence'
		});
	});

	it('validates the whole batch before writing any of it', async () => {
		await expect(
			store.record([
				observation(),
				observation({ kind: 'background', destination: 'kometa', status: 'applied_on_server' })
			])
		).rejects.toBeInstanceOf(CoverageStoreError);
		expect(await db.select().from(artworkCoverage)).toHaveLength(0);
	});
});

describe('rebuilding', () => {
	it('replaces a scope, dropping slots that are no longer observed', async () => {
		await store.record([
			observation(),
			observation({ kind: 'background', evidenceSource: 'server_verification' }),
			observation({ mediaItemId: ITEMS.show, kind: 'poster' })
		]);

		const result = await store.replace({ serverInstanceId: 'server-a', destination: 'server' }, [
			observation({ status: 'recorded_unverified', evidenceSource: 'revision' })
		]);

		expect(result).toEqual({ deleted: 3, written: 1 });
		const rows = await db.select().from(artworkCoverage);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ kind: 'poster', status: 'recorded_unverified' });
	});

	it('leaves evidence outside the rebuilt scope alone', async () => {
		await store.record([
			observation(),
			observation({ serverInstanceId: 'server-b', mediaItemId: ITEMS.movieB }),
			observation({
				destination: 'kometa',
				status: 'exported_to_kometa',
				evidenceSource: 'kometa_file',
				evidenceRevisionId: null
			})
		]);

		await store.replace({ serverInstanceId: 'server-a', destination: 'server' }, []);

		const remaining = await db
			.select({
				server: artworkCoverage.serverInstanceId,
				destination: artworkCoverage.destination
			})
			.from(artworkCoverage)
			.orderBy(artworkCoverage.serverInstanceId, artworkCoverage.destination);
		expect(remaining).toEqual([
			{ server: 'server-a', destination: 'kometa' },
			{ server: 'server-b', destination: 'server' }
		]);
	});

	it('rebuilds one library without blanking another', async () => {
		await store.record([observation(), observation({ mediaItemId: ITEMS.show, kind: 'poster' })]);

		await store.replace({ serverInstanceId: 'server-a', librarySectionKey: 'movies' }, []);

		const rows = await db
			.select({ library: artworkCoverage.librarySectionKey })
			.from(artworkCoverage);
		expect(rows).toEqual([{ library: 'shows' }]);
	});

	it('rebuilds a library an item moved into without colliding with its old-library rows', async () => {
		await store.record([observation()]);
		// The occurrence changes libraries after its coverage was written: its old
		// row keeps the previous section key, which a section-scoped delete cannot
		// reach, while the slot unique indexes ignore the section entirely.
		await db
			.update(mediaItems)
			.set({ sectionKey: 'films-4k' })
			.where(eq(mediaItems.id, ITEMS.movieA));

		const result = await store.replace(
			{ serverInstanceId: 'server-a', librarySectionKey: 'films-4k' },
			[observation({ evidenceFingerprint: 'sha256:poster-v3' })]
		);

		expect(result).toEqual({ deleted: 1, written: 1 });
		const rows = await db.select().from(artworkCoverage);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			librarySectionKey: 'films-4k',
			evidenceFingerprint: 'sha256:poster-v3'
		});
	});

	it('refuses observations that fall outside the scope being rebuilt', async () => {
		await expect(
			store.replace({ serverInstanceId: 'server-a', destination: 'kometa' }, [observation()])
		).rejects.toMatchObject({ code: 'scope_mismatch' });
		// The library is derived, not supplied, so this one is only detectable after resolving
		// the occurrence — an item the caller believes is in `movies` may have moved.
		await expect(
			store.replace({ serverInstanceId: 'server-a', librarySectionKey: 'movies' }, [
				observation({ mediaItemId: ITEMS.show })
			])
		).rejects.toMatchObject({ code: 'scope_mismatch' });
	});

	it('produces the same projection whether built incrementally or in one pass', async () => {
		const observations = [
			observation(),
			observation({ kind: 'background', status: 'missing', evidenceSource: 'server_verification' }),
			observation({ kind: 'poster', season: 2, evidenceSource: 'server_verification' })
		];
		for (const single of observations) await store.record([single]);
		const incremental = await store.getItemCoverage('server-a', ITEMS.movieA);

		await store.clear({ serverInstanceId: 'server-a' });
		await store.replace({ serverInstanceId: 'server-a' }, observations);
		const rebuilt = await store.getItemCoverage('server-a', ITEMS.movieA);

		// Row ids differ (a rebuild reinserts); everything that describes evidence must not.
		const shape = (rows: typeof incremental) => rows.map((row) => ({ ...row, id: 0 }));
		expect(shape(rebuilt)).toEqual(shape(incremental));
	});

	it('drops the projection entirely without touching its sources', async () => {
		await store.record([observation()]);

		expect(await store.clear({ serverInstanceId: 'server-a' })).toBe(1);
		expect(await db.select().from(artworkCoverage)).toHaveLength(0);
		// The revision that justified the dropped row is untouched; that is what makes the
		// projection safe to discard and recompute.
		expect(await db.select().from(artworkRevisions)).toHaveLength(1);
	});
});

describe('reads the indexes exist for', () => {
	it('counts a library by status, zero-filling the statuses that destination can hold', async () => {
		await store.record([
			observation(),
			observation({ kind: 'background', status: 'missing', evidenceSource: 'server_verification' }),
			observation({ mediaItemId: ITEMS.unresolved, status: 'unknown', evidenceRevisionId: null })
		]);

		const counts = await store.countByStatus({
			serverInstanceId: 'server-a',
			librarySectionKey: 'movies',
			destination: 'server'
		});
		expect(counts).toEqual({
			total: 3,
			byStatus: {
				applied_on_server: 1,
				recorded_unverified: 0,
				externally_changed: 0,
				missing: 1,
				unknown: 1
			}
		});
		// `exported_to_kometa` is absent by construction, not merely zero: it is not a status a
		// server destination can hold.
		expect(counts.byStatus).not.toHaveProperty('exported_to_kometa');
	});

	it('answers "which titles need artwork" as an anti-join against observed slots', async () => {
		await store.record([
			observation({ mediaItemId: ITEMS.show, kind: 'poster' }),
			observation({ mediaItemId: ITEMS.unresolved, status: 'missing', evidenceRevisionId: null })
		]);

		const uncovered = await db
			.select({ id: mediaItems.id })
			.from(mediaItems)
			.where(
				and(
					eq(mediaItems.serverInstanceId, 'server-a'),
					eq(mediaItems.sectionKey, 'movies'),
					noCoveredServerPoster()
				)
			)
			.orderBy(mediaItems.id);
		// A `missing` row and no row at all both mean "needs artwork" — only positive proof
		// excludes a title, which is what lets the projection store observed slots only.
		expect(uncovered.map((row) => row.id)).toEqual([ITEMS.movieA, ITEMS.unresolved]);
	});

	it('lists the stalest evidence first for re-reconciliation', async () => {
		await store.record([
			observation({ observedAt: new Date('2026-07-01T00:00:00.000Z') }),
			observation({
				kind: 'background',
				evidenceSource: 'server_verification',
				observedAt: new Date('2026-07-31T00:00:00.000Z')
			})
		]);

		const stale = await store.listStale({
			serverInstanceId: 'server-a',
			observedBefore: new Date('2026-07-15T00:00:00.000Z')
		});
		expect(stale.map((row) => row.kind)).toEqual(['poster']);
	});

	it('lists only evidence a sweep can advance, so pinned rows cannot starve the queue', async () => {
		await store.record([
			// Only root poster/background can be re-observed on a server, so this
			// episode row's observedAt can never move; listing it would park it at
			// the head of the oldest-first queue on every bounded pass.
			observation({
				kind: 'title_card',
				season: 1,
				episode: 1,
				status: 'recorded_unverified',
				evidenceSource: 'server_verification',
				observedAt: new Date('2026-06-01T00:00:00.000Z')
			}),
			observation({ observedAt: new Date('2026-07-01T00:00:00.000Z') }),
			// A kometa row is restamped from the files on every rebuild, so even a
			// child slot there is advanceable.
			observation({
				destination: 'kometa',
				status: 'exported_to_kometa',
				evidenceSource: 'kometa_file',
				evidenceRevisionId: null,
				observedAt: new Date('2026-06-15T00:00:00.000Z')
			})
		]);

		const stale = await store.listStale({
			serverInstanceId: 'server-a',
			observedBefore: new Date('2026-07-15T00:00:00.000Z')
		});
		expect(stale.map((row) => [row.destination, row.kind])).toEqual([
			['kometa', 'poster'],
			['server', 'poster']
		]);
	});
});

describe('derived vocabulary helpers', () => {
	it('derives the covered statuses per destination from the shared contract', () => {
		expect(coveredStatusesFor('server')).toEqual(['applied_on_server']);
		expect(coveredStatusesFor('kometa')).toEqual(['exported_to_kometa']);
	});

	it('addresses a root slot with NULL-aware equality', async () => {
		await store.record([
			observation(),
			observation({ kind: 'poster', season: 1, evidenceSource: 'server_verification' })
		]);

		const root = await db
			.select({ season: artworkCoverage.season })
			.from(artworkCoverage)
			.where(coverageSlotCondition({ kind: 'poster' }));
		expect(root).toEqual([{ season: null }]);
	});
});

/** Raw insert used to prove the table CHECK holds for a writer that bypasses the store. */
function rawInsert(mediaItemId: number, destination: string, status: string): Promise<unknown> {
	return databaseClient.execute({
		sql: `insert into artwork_coverage
			(server_instance_id, media_item_id, library_section_key, destination, kind, status,
			 evidence_source, observed_at, updated_at)
			values ('server-a', ?, 'movies', ?, 'poster', ?, 'manual', 0, 0)`,
		args: [mediaItemId, destination, status]
	});
}

/** The anti-join "no covered server poster for this occurrence" the library grid runs. */
function noCoveredServerPoster() {
	const covered = sql.raw(
		coveredStatusesFor('server')
			.map((status) => `'${status}'`)
			.join(', ')
	);
	return sql`not exists (
		select 1 from artwork_coverage
		where artwork_coverage.server_instance_id = ${mediaItems.serverInstanceId}
			and artwork_coverage.media_item_id = ${mediaItems.id}
			and artwork_coverage.destination = 'server'
			and artwork_coverage.kind = 'poster'
			and artwork_coverage.season is null
			and artwork_coverage.episode is null
			and artwork_coverage.status in (${covered})
	)`;
}
