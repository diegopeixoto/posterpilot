import { and, asc, desc, eq, gte, like, lt, lte, sql, type SQL } from 'drizzle-orm';
import { db } from './db';
import {
	appliedPosters,
	childSelections,
	events,
	jobs,
	mediaItems,
	posterCandidates,
	type MediaItem
} from './db/schema';
import { groupByProvider, groupCandidatesBySet } from './posters/sets';
import type { PickFilter } from './fun-pick';

import { defaultSortDir, type LibrarySort, type SortDir } from '$lib/library-sort';

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
	dir?: SortDir;
	q?: string;
}

/** A correlated "most recent successful application" timestamp for an item. */
const lastAppliedAt = sql`(
	select max(ap.applied_at) from applied_posters ap
	where ap.media_item_id = ${mediaItems.id} and ap.status = 'success'
)`;

/** Membership test for a genre inside the item's JSON `genres` array. */
function genreCondition(genre: string): SQL {
	return sql`exists (select 1 from json_each(${mediaItems.genres}) where json_each.value = ${genre})`;
}

/** Build the ORDER BY clause for a library sort + direction. */
function orderFor(sort: LibrarySort | undefined, dir: SortDir | undefined): SQL {
	const d = dir ?? defaultSortDir(sort);
	const ascending = d === 'asc';
	switch (sort) {
		case 'year':
			return ascending ? asc(mediaItems.year) : desc(mediaItems.year);
		case 'rating':
			return ascending ? asc(mediaItems.rating) : desc(mediaItems.rating);
		case 'runtime':
			return ascending ? asc(mediaItems.runtime) : desc(mediaItems.runtime);
		case 'recent':
			return sql`${lastAppliedAt} ${sql.raw(ascending ? 'asc' : 'desc')}`;
		case 'added':
			// Items never re-synced since the column landed have no added_at; keep
			// them at the end in both directions rather than floating nulls first.
			return sql`${mediaItems.addedAt} ${sql.raw(ascending ? 'asc' : 'desc')} nulls last`;
		case 'title':
		default:
			return ascending ? asc(mediaItems.title) : desc(mediaItems.title);
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
	if (filter.genre) conds.push(genreCondition(filter.genre));
	if (filter.q) conds.push(like(mediaItems.title, `%${filter.q}%`));
	return db
		.select()
		.from(mediaItems)
		.where(conds.length ? and(...conds) : undefined)
		.orderBy(orderFor(filter.sort, filter.dir));
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

/**
 * Random library poster URLs for a decorative montage backdrop (e.g. the Kometa
 * hero). Uses the media server's own current posters; empty when the library is empty.
 */
export async function getMontagePosters(limit = 14): Promise<string[]> {
	const rows = await db
		.select({ url: mediaItems.currentPosterUrl })
		.from(mediaItems)
		.where(sql`${mediaItems.currentPosterUrl} is not null`)
		.orderBy(sql`random()`)
		.limit(limit);
	return rows.map((r) => r.url).filter((u): u is string => Boolean(u));
}

/**
 * Pick one library item uniformly at random under the Fun picker's filters.
 * Returns null when nothing matches. `ignored` items stay eligible — that flag
 * is a poster-management concept, not a watch-list one.
 */
export async function pickRandomItem(filter: PickFilter): Promise<MediaItem | null> {
	const conds: SQL[] = [];
	if (filter.type) conds.push(eq(mediaItems.type, filter.type));
	if (filter.genre) conds.push(genreCondition(filter.genre));
	if (filter.yearMin !== undefined) conds.push(gte(mediaItems.year, filter.yearMin));
	if (filter.yearMax !== undefined) conds.push(lte(mediaItems.year, filter.yearMax));
	if (filter.excludeWatched) conds.push(eq(mediaItems.watched, false));
	const rows = await db
		.select()
		.from(mediaItems)
		.where(conds.length ? and(...conds) : undefined)
		.orderBy(sql`random()`)
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

/** Mark an item as ignored (excluded from sync/auto-apply) or restore it. */
export async function setItemIgnored(id: number, ignored: boolean): Promise<void> {
	await db.update(mediaItems).set({ ignored }).where(eq(mediaItems.id, id));
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
	const childSelectionRows = await db
		.select()
		.from(childSelections)
		.where(eq(childSelections.mediaItemId, id));
	return {
		item,
		candidates,
		sets: groupCandidatesBySet(candidates),
		providerGroups: groupByProvider(candidates),
		history,
		childSelections: childSelectionRows
	};
}

export async function listJobs(limit = 50) {
	return db.select().from(jobs).orderBy(desc(jobs.id)).limit(limit);
}

export async function getJob(id: number) {
	return (await db.select().from(jobs).where(eq(jobs.id, id)).limit(1))[0] ?? null;
}

/** All pending/running jobs (newest first) for the dashboard's live progress list. */
export async function listActiveJobs() {
	return db
		.select()
		.from(jobs)
		.where(sql`${jobs.status} in ('pending','running')`)
		.orderBy(desc(jobs.id));
}

export async function activeJobCount(): Promise<number> {
	const [row] = await db
		.select({ c: sql<number>`count(*)` })
		.from(jobs)
		.where(sql`${jobs.status} in ('pending','running')`);
	return row?.c ?? 0;
}

export type EventLevelFilter = 'info' | 'warn' | 'error';

/**
 * List activity-log events newest-first. Filter by `level`, page with `limit`,
 * and continue from a prior page by passing the last seen id as `before` (an id
 * cursor — rows with a smaller id, i.e. older, are returned).
 */
export async function listEvents(
	opts: {
		level?: EventLevelFilter;
		limit?: number;
		before?: number;
	} = {}
) {
	const limit = opts.limit ?? 50;
	const conds: SQL[] = [];
	if (opts.level) conds.push(eq(events.level, opts.level));
	if (typeof opts.before === 'number') conds.push(lt(events.id, opts.before));
	return db
		.select()
		.from(events)
		.where(conds.length ? and(...conds) : undefined)
		.orderBy(desc(events.id))
		.limit(limit);
}

/** Delete every activity-log row (the Settings "Clear activity" action). */
export async function clearEvents(): Promise<void> {
	await db.delete(events);
}
