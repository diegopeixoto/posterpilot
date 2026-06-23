import { and, asc, desc, eq, gte, like, sql, type SQL } from 'drizzle-orm';
import { db } from './db';
import { appliedPosters, jobs, mediaItems, posterCandidates, type MediaItem } from './db/schema';
import { groupCandidatesBySet } from './posters/sets';

/** Sort orders offered by the library grid. */
export type LibrarySort = 'title' | 'year' | 'rating' | 'runtime' | 'recent';

export interface LibraryFilter {
	type?: 'movie' | 'show';
	missingPoster?: boolean;
	hasMediux?: boolean;
	/** Only items posterpilot has not applied a cover to (still on the Plex default). */
	unchanged?: boolean;
	/** Minimum TMDB rating (vote average). */
	minRating?: number;
	/** Restrict to items tagged with this genre. */
	genre?: string;
	sort?: LibrarySort;
	q?: string;
}

/** A correlated "most recent successful application" timestamp for an item. */
const lastAppliedAt = sql`(
	select max(ap.applied_at) from applied_posters ap
	where ap.media_item_id = ${mediaItems.id} and ap.status = 'success'
)`;

/** Build the ORDER BY clause for a library sort (nulls sort last for DESC orders). */
function orderFor(sort: LibrarySort | undefined): SQL {
	switch (sort) {
		case 'year':
			return desc(mediaItems.year);
		case 'rating':
			return desc(mediaItems.rating);
		case 'runtime':
			return desc(mediaItems.runtime);
		case 'recent':
			return sql`${lastAppliedAt} desc`;
		case 'title':
		default:
			return asc(mediaItems.title);
	}
}

/** List library items matching the given filters, ordered per the chosen sort. */
export async function listLibrary(filter: LibraryFilter = {}) {
	const conds: SQL[] = [];
	if (filter.type) conds.push(eq(mediaItems.type, filter.type));
	if (filter.hasMediux) conds.push(eq(mediaItems.hasMediux, true));
	if (filter.missingPoster) conds.push(sql`${mediaItems.currentPosterUrl} is null`);
	if (filter.unchanged)
		conds.push(
			sql`not exists (select 1 from applied_posters ap where ap.media_item_id = ${mediaItems.id} and ap.status = 'success')`
		);
	if (typeof filter.minRating === 'number' && Number.isFinite(filter.minRating))
		conds.push(gte(mediaItems.rating, filter.minRating));
	if (filter.genre)
		conds.push(
			sql`exists (select 1 from json_each(${mediaItems.genres}) where json_each.value = ${filter.genre})`
		);
	if (filter.q) conds.push(like(mediaItems.title, `%${filter.q}%`));
	return db
		.select()
		.from(mediaItems)
		.where(conds.length ? and(...conds) : undefined)
		.orderBy(orderFor(filter.sort));
}

/** Distinct genres present across the library, for the filter chips. */
export async function listGenres(): Promise<string[]> {
	const rows = await db.all<{ value: string }>(
		sql`select distinct json_each.value as value
			from media_items, json_each(media_items.genres)
			where media_items.genres is not null
			order by value`
	);
	return rows.map((r) => r.value);
}

/** The most recently changed item that has a backdrop, for the library spotlight. */
export async function getSpotlightItem(): Promise<MediaItem | null> {
	const rows = await db
		.select()
		.from(mediaItems)
		.where(
			and(
				sql`${mediaItems.backdropUrl} is not null`,
				sql`exists (select 1 from applied_posters ap where ap.media_item_id = ${mediaItems.id} and ap.status = 'success')`
			)
		)
		.orderBy(sql`${lastAppliedAt} desc`)
		.limit(1);
	return rows[0] ?? null;
}

async function count(where?: SQL): Promise<number> {
	const [row] = await db
		.select({ c: sql<number>`count(*)` })
		.from(mediaItems)
		.where(where);
	return row?.c ?? 0;
}

export interface LibraryStats {
	total: number;
	movies: number;
	shows: number;
	resolved: number;
	withMediux: number;
	appliedCount: number;
}

export async function getStats(): Promise<LibraryStats> {
	const [appliedRow] = await db
		.select({ c: sql<number>`count(distinct ${appliedPosters.mediaItemId})` })
		.from(appliedPosters)
		.where(eq(appliedPosters.status, 'success'));
	return {
		total: await count(),
		movies: await count(eq(mediaItems.type, 'movie')),
		shows: await count(eq(mediaItems.type, 'show')),
		resolved: await count(eq(mediaItems.resolved, true)),
		withMediux: await count(eq(mediaItems.hasMediux, true)),
		appliedCount: appliedRow?.c ?? 0
	};
}

export async function getMediaItem(id: number) {
	return (await db.select().from(mediaItems).where(eq(mediaItems.id, id)).limit(1))[0] ?? null;
}

export async function getItemDetail(id: number) {
	const item = await getMediaItem(id);
	if (!item) return null;
	const candidates = await db
		.select()
		.from(posterCandidates)
		.where(eq(posterCandidates.mediaItemId, id))
		.orderBy(posterCandidates.id);
	const history = await db
		.select()
		.from(appliedPosters)
		.where(eq(appliedPosters.mediaItemId, id))
		.orderBy(desc(appliedPosters.appliedAt))
		.limit(20);
	return { item, candidates, sets: groupCandidatesBySet(candidates), history };
}

export async function listJobs(limit = 50) {
	return db.select().from(jobs).orderBy(desc(jobs.id)).limit(limit);
}

export async function getJob(id: number) {
	return (await db.select().from(jobs).where(eq(jobs.id, id)).limit(1))[0] ?? null;
}

export async function activeJobCount(): Promise<number> {
	const [row] = await db
		.select({ c: sql<number>`count(*)` })
		.from(jobs)
		.where(sql`${jobs.status} in ('pending','running')`);
	return row?.c ?? 0;
}
