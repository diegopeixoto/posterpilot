import {
	and,
	asc,
	desc,
	eq,
	gt,
	gte,
	isNotNull,
	isNull,
	inArray,
	like,
	lt,
	lte,
	notInArray,
	or,
	sql,
	type SQL
} from 'drizzle-orm';
import { db } from './db';
import {
	appliedPosters,
	artworkSlotStates,
	childSelections,
	events,
	jobItemOutcomes,
	jobs,
	mediaItems,
	posterCandidates,
	type MediaItem
} from './db/schema';
import { groupByProvider, groupCandidatesBySet } from './posters/sets';
import { rankFunItems, type PickFilter } from './fun-pick';
import {
	buildPublicJobProgress,
	type PublicJobRow,
	type PublicOutcomeRow
} from './jobs/public-progress';
import { jobServerScopeCondition } from './jobs/scope';

import { defaultSortDir, type LibrarySort, type SortDir } from '$lib/library-sort';
import { isTerminalJobStatus } from '$lib/job-progress';

export interface LibraryFilter {
	serverInstanceId?: string;
	type?: 'movie' | 'show';
	ignored?: 'active' | 'ignored';
	missingPoster?: boolean;
	hasCandidates?: boolean;
	hasMediux?: boolean;
	/** Only items PosterPilot has not changed from the media server's current artwork. */
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
/** Default number of items in a library page. */
export const LIBRARY_PAGE_SIZE = 60;

/** Credentials-safe projection serialized to the library grid and paging API. */
export interface LibraryListItem {
	id: number;
	title: string;
	year: number | null;
	type: MediaItem['type'];
	rating: number | null;
	ignored: boolean;
	hasCandidates: boolean;
	hasPoster: boolean;
	hasStagedPoster: boolean;
	posterVersion: string;
}

export interface LibrarySpotlightItem {
	id: number;
	title: string;
	year: number | null;
	backdropUrl: string;
}

/** Credentials-safe item projection shared by the FUN picker and session planner. */
export interface FunChoiceItem {
	id: number;
	title: string;
	year: number | null;
	type: MediaItem['type'];
	overview: string | null;
	tagline: string | null;
	genres: string[] | null;
	runtime: number | null;
	rating: number | null;
	hasPoster: boolean;
	posterVersion: string;
}

/** Minimal credentials-safe row serialized into the Poster Match selector. */
export interface PosterMatchItem {
	id: number;
	title: string;
	year: number | null;
}

/** Build the shared WHERE conditions for a library filter (used by list + count). */
function libraryConds(filter: LibraryFilter): SQL[] {
	const conds: SQL[] = [isNull(mediaItems.sourceRemovedAt)];
	if (filter.serverInstanceId) conds.push(eq(mediaItems.serverInstanceId, filter.serverInstanceId));
	if (filter.type) conds.push(eq(mediaItems.type, filter.type));
	if (filter.ignored === 'active') conds.push(eq(mediaItems.ignored, false));
	if (filter.ignored === 'ignored') conds.push(eq(mediaItems.ignored, true));
	if (filter.hasCandidates) conds.push(eq(mediaItems.hasCandidates, true));
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
	return conds;
}

/**
 * List library items matching `filter`. When `page` is given, returns just that
 * window (offset-based) so large libraries don't ship every row into one payload;
 * omit `page` to get the full result (used by non-UI callers). Ordering is stable
 * (the sort column plus an `id` tiebreaker) so paging can't skip or repeat a row.
 */
export async function listLibrary(
	filter: LibraryFilter = {},
	page?: { limit: number; offset: number }
): Promise<LibraryListItem[]> {
	const conds = libraryConds(filter);
	const q = db
		.select({
			id: mediaItems.id,
			title: mediaItems.title,
			year: mediaItems.year,
			type: mediaItems.type,
			rating: mediaItems.rating,
			ignored: mediaItems.ignored,
			hasCandidates: mediaItems.hasCandidates,
			hasPoster: sql<number>`case when ${mediaItems.currentPosterUrl} is null then 0 else 1 end`,
			hasStagedPoster: sql<number>`case when ${mediaItems.selectedPosterUrl} is null then 0 else 1 end`,
			currentPosterFingerprint: mediaItems.currentPosterFingerprint,
			artworkVersion: mediaItems.artworkVersion
		})
		.from(mediaItems)
		.where(conds.length ? and(...conds) : undefined)
		.orderBy(orderFor(filter.sort, filter.dir), asc(mediaItems.id));
	const rows = page ? await q.limit(page.limit).offset(page.offset) : await q;
	return rows.map((row) => ({
		id: row.id,
		title: row.title,
		year: row.year,
		type: row.type,
		rating: row.rating,
		ignored: row.ignored,
		hasCandidates: row.hasCandidates,
		hasPoster: row.hasPoster === 1,
		hasStagedPoster: row.hasStagedPoster === 1,
		posterVersion: row.currentPosterFingerprint ?? String(row.artworkVersion)
	}));
}

/** Count library items matching `filter` (for pagination totals). */
export async function countLibrary(filter: LibraryFilter = {}): Promise<number> {
	const conds = libraryConds(filter);
	const rows = await db
		.select({ c: sql<number>`count(*)` })
		.from(mediaItems)
		.where(conds.length ? and(...conds) : undefined);
	return rows[0]?.c ?? 0;
}

/** Materialize the complete deterministic result id set without serializing full rows. */
export async function listLibraryIds(filter: LibraryFilter = {}): Promise<number[]> {
	const conds = libraryConds(filter);
	const rows = await db
		.select({ id: mediaItems.id })
		.from(mediaItems)
		.where(conds.length ? and(...conds) : undefined)
		.orderBy(orderFor(filter.sort, filter.dir), asc(mediaItems.id));
	return rows.map((row) => row.id);
}

/** Distinct genres present across the library, for the filter chips. */
export async function listGenres(serverInstanceId?: string): Promise<string[]> {
	const rows = await db.all<{ value: string }>(
		sql`select distinct json_each.value as value
			from media_items, json_each(media_items.genres)
			where media_items.genres is not null
				and media_items.source_removed_at is null
				${serverInstanceId ? sql`and media_items.server_instance_id = ${serverInstanceId}` : sql``}
			order by value`
	);
	return rows.map((r) => r.value);
}

/** The most recently changed item that has a backdrop, for the library spotlight. */
export async function getSpotlightItem(
	serverInstanceId?: string
): Promise<LibrarySpotlightItem | null> {
	const conds = [
		isNull(mediaItems.sourceRemovedAt),
		sql`${mediaItems.backdropUrl} is not null`,
		sql`exists (select 1 from applied_posters ap where ap.media_item_id = ${mediaItems.id} and ap.status = 'success')`
	];
	if (serverInstanceId) conds.push(eq(mediaItems.serverInstanceId, serverInstanceId));
	const rows = await db
		.select({
			id: mediaItems.id,
			title: mediaItems.title,
			year: mediaItems.year,
			backdropUrl: mediaItems.backdropUrl
		})
		.from(mediaItems)
		.where(and(...conds))
		.orderBy(sql`${lastAppliedAt} desc`)
		.limit(1);
	const row = rows[0];
	return row?.backdropUrl ? { ...row, backdropUrl: row.backdropUrl } : null;
}

/**
 * Random library poster URLs for a decorative montage backdrop (e.g. the Kometa
 * hero). Uses the media server's own current posters; empty when the library is empty.
 */
export async function getMontagePosters(
	limit = 14,
	serverInstanceId?: string
): Promise<Array<{ id: number; version: string }>> {
	const where = serverInstanceId
		? and(
				eq(mediaItems.serverInstanceId, serverInstanceId),
				isNull(mediaItems.sourceRemovedAt),
				isNotNull(mediaItems.currentPosterUrl)
			)
		: and(isNull(mediaItems.sourceRemovedAt), isNotNull(mediaItems.currentPosterUrl));
	const rows = await db
		.select({
			id: mediaItems.id,
			fingerprint: mediaItems.currentPosterFingerprint,
			artworkVersion: mediaItems.artworkVersion
		})
		.from(mediaItems)
		.where(where)
		.orderBy(sql`random()`)
		.limit(limit);
	return rows.map((row) => ({
		id: row.id,
		version: row.fingerprint ?? String(row.artworkVersion)
	}));
}

/** Build the complete reusable FUN predicate. Ignored items intentionally remain eligible. */
function funConds(filter: PickFilter, now = new Date()): SQL[] {
	const conds: SQL[] = [isNull(mediaItems.sourceRemovedAt)];
	if (filter.serverInstanceId) conds.push(eq(mediaItems.serverInstanceId, filter.serverInstanceId));
	if (filter.librarySectionKey) conds.push(eq(mediaItems.sectionKey, filter.librarySectionKey));
	if (filter.type) conds.push(eq(mediaItems.type, filter.type));
	if (filter.genre) conds.push(genreCondition(filter.genre));
	if (filter.yearMin !== undefined) conds.push(gte(mediaItems.year, filter.yearMin));
	if (filter.yearMax !== undefined) conds.push(lte(mediaItems.year, filter.yearMax));
	if (filter.runtimeMin !== undefined) conds.push(gte(mediaItems.runtime, filter.runtimeMin));
	if (filter.runtimeMax !== undefined) conds.push(lte(mediaItems.runtime, filter.runtimeMax));
	if (filter.ratingMin !== undefined) conds.push(gte(mediaItems.rating, filter.ratingMin));
	if (filter.addedWithinDays !== undefined) {
		conds.push(
			gte(
				mediaItems.addedAt,
				new Date(now.getTime() - filter.addedWithinDays * 24 * 60 * 60 * 1000)
			)
		);
	}
	if (filter.excludeWatched) conds.push(eq(mediaItems.watched, false));
	if (filter.excludeItemIds.length) conds.push(notInArray(mediaItems.id, filter.excludeItemIds));
	return conds;
}

/** Count all eligible rows for honest zero/one/many choice messaging. */
export async function countFunEligible(
	filter: PickFilter,
	now = new Date(),
	options: { requireRuntime?: boolean } = {}
): Promise<number> {
	const conds = funConds(filter, now);
	if (options.requireRuntime) conds.push(gt(mediaItems.runtime, 0));
	const [row] = await db
		.select({ count: sql<number>`count(*)` })
		.from(mediaItems)
		.where(conds.length ? and(...conds) : undefined);
	return row?.count ?? 0;
}

/**
 * Return up to three distinct, reproducible FUN choices. Ranking is performed over
 * an id-ordered frozen candidate set so a shared seed produces the same result while
 * the underlying eligible library state is unchanged.
 */
export async function pickFunChoices(
	filter: PickFilter,
	seed: string,
	now = new Date()
): Promise<FunChoiceItem[]> {
	const eligible = await listFunEligibleItems(filter, now);
	return rankFunItems(eligible, seed).slice(0, filter.count);
}

/** Full deterministic-id-ordered eligible set for bracket/session experiments. */
export async function listFunEligibleItems(
	filter: PickFilter,
	now = new Date(),
	options: { requireRuntime?: boolean } = {}
): Promise<FunChoiceItem[]> {
	const conds = funConds(filter, now);
	if (options.requireRuntime) conds.push(gt(mediaItems.runtime, 0));
	const rows = await db
		.select({
			id: mediaItems.id,
			title: mediaItems.title,
			year: mediaItems.year,
			type: mediaItems.type,
			overview: mediaItems.overview,
			tagline: mediaItems.tagline,
			genres: mediaItems.genres,
			runtime: mediaItems.runtime,
			rating: mediaItems.rating,
			hasPoster: sql<number>`case when ${mediaItems.currentPosterUrl} is null then 0 else 1 end`,
			currentPosterFingerprint: mediaItems.currentPosterFingerprint,
			artworkVersion: mediaItems.artworkVersion
		})
		.from(mediaItems)
		.where(conds.length ? and(...conds) : undefined)
		.orderBy(asc(mediaItems.id));
	return rows.map((row) => ({
		id: row.id,
		title: row.title,
		year: row.year,
		type: row.type,
		overview: row.overview,
		tagline: row.tagline,
		genres: row.genres,
		runtime: row.runtime,
		rating: row.rating,
		hasPoster: row.hasPoster === 1,
		posterVersion: row.currentPosterFingerprint ?? String(row.artworkVersion)
	}));
}

/** Resolve exact ordered ids from a shared result without drawing replacements. */
export async function listFunItemsByIds(
	itemIds: number[],
	serverInstanceId: string
): Promise<FunChoiceItem[]> {
	const exactIds = [...new Set(itemIds)]
		.filter((id) => Number.isSafeInteger(id) && id > 0)
		.slice(0, 3);
	if (!serverInstanceId || exactIds.length === 0) return [];
	const rows = await db
		.select({
			id: mediaItems.id,
			title: mediaItems.title,
			year: mediaItems.year,
			type: mediaItems.type,
			overview: mediaItems.overview,
			tagline: mediaItems.tagline,
			genres: mediaItems.genres,
			runtime: mediaItems.runtime,
			rating: mediaItems.rating,
			hasPoster: sql<number>`case when ${mediaItems.currentPosterUrl} is null then 0 else 1 end`,
			currentPosterFingerprint: mediaItems.currentPosterFingerprint,
			artworkVersion: mediaItems.artworkVersion
		})
		.from(mediaItems)
		.where(
			and(
				eq(mediaItems.serverInstanceId, serverInstanceId),
				isNull(mediaItems.sourceRemovedAt),
				inArray(mediaItems.id, exactIds)
			)
		);
	const byId = new Map(
		rows.map((row) => [
			row.id,
			{
				id: row.id,
				title: row.title,
				year: row.year,
				type: row.type,
				overview: row.overview,
				tagline: row.tagline,
				genres: row.genres,
				runtime: row.runtime,
				rating: row.rating,
				hasPoster: row.hasPoster === 1,
				posterVersion: row.currentPosterFingerprint ?? String(row.artworkVersion)
			} satisfies FunChoiceItem
		])
	);
	return exactIds.flatMap((id) => {
		const item = byId.get(id);
		return item ? [item] : [];
	});
}

export interface FunLibraryBounds {
	yearMin: number | null;
	yearMax: number | null;
	runtimeMin: number | null;
	runtimeMax: number | null;
	ratingMin: number | null;
	ratingMax: number | null;
}

/** Dynamic numeric bounds for the selected server/library scope. */
export async function getFunLibraryBounds(
	scope: Pick<PickFilter, 'serverInstanceId' | 'librarySectionKey'>
): Promise<FunLibraryBounds> {
	const conds: SQL[] = [];
	if (scope.serverInstanceId) conds.push(eq(mediaItems.serverInstanceId, scope.serverInstanceId));
	if (scope.librarySectionKey) conds.push(eq(mediaItems.sectionKey, scope.librarySectionKey));
	const [row] = await db
		.select({
			yearMin: sql<number | null>`min(${mediaItems.year})`,
			yearMax: sql<number | null>`max(${mediaItems.year})`,
			runtimeMin: sql<number | null>`min(${mediaItems.runtime})`,
			runtimeMax: sql<number | null>`max(${mediaItems.runtime})`,
			ratingMin: sql<number | null>`min(${mediaItems.rating})`,
			ratingMax: sql<number | null>`max(${mediaItems.rating})`
		})
		.from(mediaItems)
		.where(conds.length ? and(...conds) : undefined);
	return {
		yearMin: row?.yearMin ?? null,
		yearMax: row?.yearMax ?? null,
		runtimeMin: row?.runtimeMin ?? null,
		runtimeMax: row?.runtimeMax ?? null,
		ratingMin: row?.ratingMin ?? null,
		ratingMax: row?.ratingMax ?? null
	};
}

export interface FunServerScope {
	id: string;
	name: string;
	type: 'plex' | 'jellyfin' | 'emby';
	libraries: { key: string; type: 'movie' | 'show' }[];
}

/** Library keys available inside one concrete active-server scope. */
export async function listFunLibraries(
	serverInstanceId: string
): Promise<FunServerScope['libraries']> {
	return db
		.select({ key: mediaItems.sectionKey, type: mediaItems.type })
		.from(mediaItems)
		.where(
			and(eq(mediaItems.serverInstanceId, serverInstanceId), isNull(mediaItems.sourceRemovedAt))
		)
		.groupBy(mediaItems.sectionKey, mediaItems.type)
		.orderBy(asc(mediaItems.sectionKey), asc(mediaItems.type));
}

/** Items with at least two distinct root-poster candidates, suitable for a bracket. */
export async function listPosterMatchEligibleItems(
	serverInstanceId: string,
	limit = 200
): Promise<PosterMatchItem[]> {
	const candidateItems = await db
		.select({ mediaItemId: posterCandidates.mediaItemId })
		.from(posterCandidates)
		.where(
			and(
				eq(posterCandidates.serverInstanceId, serverInstanceId),
				eq(posterCandidates.kind, 'poster'),
				eq(posterCandidates.active, true)
			)
		)
		.groupBy(posterCandidates.mediaItemId)
		.having(sql`count(distinct ${posterCandidates.url}) >= 2`)
		.orderBy(asc(posterCandidates.mediaItemId))
		.limit(limit);
	if (!candidateItems.length) return [];
	return db
		.select({ id: mediaItems.id, title: mediaItems.title, year: mediaItems.year })
		.from(mediaItems)
		.where(
			and(
				eq(mediaItems.serverInstanceId, serverInstanceId),
				isNull(mediaItems.sourceRemovedAt),
				inArray(
					mediaItems.id,
					candidateItems.map((row) => row.mediaItemId)
				)
			)
		)
		.orderBy(asc(mediaItems.title), asc(mediaItems.id));
}

/** Root-poster candidate identity/provenance used by Poster Match. */
export async function listPosterMatchCandidates(itemId: number, serverInstanceId: string) {
	return db
		.select({
			id: posterCandidates.id,
			url: posterCandidates.url,
			provider: posterCandidates.provider,
			setId: posterCandidates.setId,
			setAuthor: posterCandidates.setAuthor,
			width: posterCandidates.width,
			height: posterCandidates.height,
			score: posterCandidates.score
		})
		.from(posterCandidates)
		.where(
			and(
				eq(posterCandidates.serverInstanceId, serverInstanceId),
				eq(posterCandidates.mediaItemId, itemId),
				eq(posterCandidates.kind, 'poster'),
				eq(posterCandidates.active, true)
			)
		)
		.orderBy(desc(posterCandidates.score), asc(posterCandidates.id));
}

export async function hasCompletedSyncJob(serverInstanceId?: string): Promise<boolean> {
	const conditions = [eq(jobs.type, 'sync'), eq(jobs.status, 'completed')];
	if (serverInstanceId) conditions.push(eq(jobs.serverInstanceId, serverInstanceId));
	const [row] = await db
		.select({ id: jobs.id })
		.from(jobs)
		.where(and(...conditions))
		.limit(1);
	return Boolean(row);
}

/** Artwork availability rows for the full-screen FUN gallery. */
export async function listFunGalleryItems(
	filter: PickFilter,
	mode: 'poster' | 'background' | 'mixed',
	limit = 240
) {
	const conds = funConds(filter);
	const hasPoster = isNotNull(mediaItems.currentPosterUrl);
	const hasBackground = or(
		isNotNull(mediaItems.currentBackgroundUrl),
		isNotNull(mediaItems.backdropUrl)
	)!;
	conds.push(
		mode === 'poster'
			? hasPoster
			: mode === 'background'
				? hasBackground
				: or(hasPoster, hasBackground)!
	);
	const rows = await db
		.select({
			id: mediaItems.id,
			title: mediaItems.title,
			currentPosterUrl: mediaItems.currentPosterUrl,
			currentBackgroundUrl: mediaItems.currentBackgroundUrl,
			currentPosterFingerprint: mediaItems.currentPosterFingerprint,
			currentBackgroundFingerprint: mediaItems.currentBackgroundFingerprint,
			backdropUrl: mediaItems.backdropUrl,
			artworkVersion: mediaItems.artworkVersion
		})
		.from(mediaItems)
		.where(and(...conds))
		.orderBy(asc(mediaItems.id))
		.limit(limit);
	return rows.map((row) => ({
		id: row.id,
		title: row.title,
		hasPoster: Boolean(row.currentPosterUrl),
		hasBackground: Boolean(row.currentBackgroundUrl || row.backdropUrl),
		artworkVersion: row.artworkVersion,
		posterVersion: row.currentPosterFingerprint,
		backgroundVersion: row.currentBackgroundFingerprint
	}));
}

async function count(serverInstanceId: string, where?: SQL): Promise<number> {
	const [row] = await db
		.select({ c: sql<number>`count(*)` })
		.from(mediaItems)
		.where(
			where
				? and(
						eq(mediaItems.serverInstanceId, serverInstanceId),
						isNull(mediaItems.sourceRemovedAt),
						where
					)
				: and(eq(mediaItems.serverInstanceId, serverInstanceId), isNull(mediaItems.sourceRemovedAt))
		);
	return row?.c ?? 0;
}

export interface LibraryStats {
	total: number;
	movies: number;
	shows: number;
	resolved: number;
	withCandidates: number;
	withMediux: number;
	appliedCount: number;
}

export async function getStats(serverInstanceId: string): Promise<LibraryStats> {
	const [appliedRow] = await db
		.select({ c: sql<number>`count(distinct ${appliedPosters.mediaItemId})` })
		.from(appliedPosters)
		.innerJoin(
			mediaItems,
			and(
				eq(mediaItems.id, appliedPosters.mediaItemId),
				eq(mediaItems.serverInstanceId, appliedPosters.serverInstanceId)
			)
		)
		.where(
			and(
				eq(appliedPosters.serverInstanceId, serverInstanceId),
				isNull(mediaItems.sourceRemovedAt),
				eq(appliedPosters.status, 'success')
			)
		);
	return {
		total: await count(serverInstanceId),
		movies: await count(serverInstanceId, eq(mediaItems.type, 'movie')),
		shows: await count(serverInstanceId, eq(mediaItems.type, 'show')),
		resolved: await count(serverInstanceId, eq(mediaItems.resolved, true)),
		withCandidates: await count(serverInstanceId, eq(mediaItems.hasCandidates, true)),
		withMediux: await count(serverInstanceId, eq(mediaItems.hasMediux, true)),
		appliedCount: appliedRow?.c ?? 0
	};
}

export async function getMediaItem(id: number, serverInstanceId?: string) {
	const scope = serverInstanceId
		? and(eq(mediaItems.serverInstanceId, serverInstanceId), eq(mediaItems.id, id))
		: eq(mediaItems.id, id);
	return (await db.select().from(mediaItems).where(scope).limit(1))[0] ?? null;
}

/** Independent root-slot cache identity, with the legacy item version as fallback. */
export async function getRootArtworkVersion(
	mediaItemId: number,
	serverInstanceId: string,
	kind: 'poster' | 'background'
): Promise<number | null> {
	const [state] = await db
		.select({ artworkVersion: artworkSlotStates.artworkVersion })
		.from(artworkSlotStates)
		.where(
			and(
				eq(artworkSlotStates.serverInstanceId, serverInstanceId),
				eq(artworkSlotStates.mediaItemId, mediaItemId),
				eq(artworkSlotStates.kind, kind),
				sql`${artworkSlotStates.mediaCollectionId} is null`,
				sql`${artworkSlotStates.season} is null`,
				sql`${artworkSlotStates.episode} is null`
			)
		)
		.limit(1);
	return state?.artworkVersion ?? null;
}

/** Mark an item as ignored (excluded from sync/auto-apply) or restore it. */
export async function setItemIgnored(
	id: number,
	serverInstanceId: string,
	ignored: boolean
): Promise<void> {
	await db
		.update(mediaItems)
		.set({ ignored })
		.where(and(eq(mediaItems.serverInstanceId, serverInstanceId), eq(mediaItems.id, id)));
}

export async function getItemDetail(id: number, serverInstanceId?: string) {
	const item = await getMediaItem(id, serverInstanceId);
	if (!item) return null;
	const candidates = await db
		.select()
		.from(posterCandidates)
		.where(
			and(
				eq(posterCandidates.serverInstanceId, item.serverInstanceId),
				eq(posterCandidates.mediaItemId, id),
				eq(posterCandidates.active, true)
			)
		)
		.orderBy(posterCandidates.id);
	const history = await db
		.select()
		.from(appliedPosters)
		.where(
			and(
				eq(appliedPosters.serverInstanceId, item.serverInstanceId),
				eq(appliedPosters.mediaItemId, id)
			)
		)
		.orderBy(desc(appliedPosters.appliedAt))
		.limit(20);
	const childSelectionRows = await db
		.select()
		.from(childSelections)
		.where(
			and(
				eq(childSelections.serverInstanceId, item.serverInstanceId),
				eq(childSelections.mediaItemId, id)
			)
		);
	const { currentPosterUrl, currentBackgroundUrl, ...publicItem } = item;
	return {
		item: {
			...publicItem,
			hasCurrentPoster: currentPosterUrl !== null,
			hasCurrentBackground: currentBackgroundUrl !== null
		},
		candidates,
		sets: groupCandidatesBySet(candidates),
		providerGroups: groupByProvider(candidates),
		history,
		childSelections: childSelectionRows
	};
}

// Raw result/outcome columns are selected only for server-side summarization below.
// buildPublicJobProgress is the serialization boundary: immutable payloads, full
// results, and provider URLs never reach dashboard or SSE clients.
const publicJobColumns = {
	id: jobs.id,
	serverInstanceId: jobs.serverInstanceId,
	librarySectionKey: jobs.librarySectionKey,
	type: jobs.type,
	status: jobs.status,
	phase: jobs.phase,
	processed: jobs.processed,
	total: jobs.total,
	currentItem: jobs.currentItem,
	attempt: jobs.attempt,
	maxAttempts: jobs.maxAttempts,
	result: jobs.result,
	errorCode: jobs.errorCode,
	error: jobs.error,
	createdAt: jobs.createdAt,
	startedAt: jobs.startedAt,
	finishedAt: jobs.finishedAt,
	updatedAt: jobs.updatedAt
};

const publicOutcomeColumns = {
	id: jobItemOutcomes.id,
	jobId: jobItemOutcomes.jobId,
	mediaItemId: jobItemOutcomes.mediaItemId,
	destination: jobItemOutcomes.destination,
	kind: jobItemOutcomes.kind,
	season: jobItemOutcomes.season,
	episode: jobItemOutcomes.episode,
	status: jobItemOutcomes.status,
	retryable: jobItemOutcomes.retryable,
	result: jobItemOutcomes.result,
	errorCode: jobItemOutcomes.errorCode,
	error: jobItemOutcomes.error
};

async function hydratePublicJobs(rows: PublicJobRow[]) {
	if (!rows.length) return [];
	// Active SSE updates are frequent and cannot yet have final retryable subsets.
	// Only terminal rows need outcome hydration, avoiding an O(n²) reread while a
	// large sync appends one outcome per progress event.
	const detailedJobIds = rows.filter((row) => isTerminalJobStatus(row.status)).map((row) => row.id);
	if (!detailedJobIds.length) return rows.map((row) => buildPublicJobProgress(row));
	const outcomes = (await db
		.select(publicOutcomeColumns)
		.from(jobItemOutcomes)
		.where(inArray(jobItemOutcomes.jobId, detailedJobIds))
		.orderBy(asc(jobItemOutcomes.id))) as PublicOutcomeRow[];
	return rows.map((row) => buildPublicJobProgress(row, outcomes));
}

export async function listJobs(limit = 50, serverInstanceId?: string) {
	const rows = await db
		.select(publicJobColumns)
		.from(jobs)
		.where(serverInstanceId ? jobServerScopeCondition(serverInstanceId) : undefined)
		.orderBy(desc(jobs.id))
		.limit(limit);
	return hydratePublicJobs(rows as PublicJobRow[]);
}

export async function getJob(id: number, serverInstanceId?: string) {
	const scope = serverInstanceId
		? and(jobServerScopeCondition(serverInstanceId), eq(jobs.id, id))
		: eq(jobs.id, id);
	const row = (await db.select(publicJobColumns).from(jobs).where(scope).limit(1))[0];
	if (!row) return null;
	return (await hydratePublicJobs([row as PublicJobRow]))[0] ?? null;
}

/** All durable active jobs (newest first) for the dashboard's live progress list. */
export async function listActiveJobs(serverInstanceId?: string) {
	const active = sql`${jobs.status} in ('pending','running','retry_scheduled')`;
	const rows = await db
		.select(publicJobColumns)
		.from(jobs)
		.where(serverInstanceId ? and(jobServerScopeCondition(serverInstanceId), active) : active)
		.orderBy(desc(jobs.id));
	return hydratePublicJobs(rows as PublicJobRow[]);
}

export async function activeJobCount(serverInstanceId?: string): Promise<number> {
	const [row] = await db
		.select({ c: sql<number>`count(*)` })
		.from(jobs)
		.where(
			serverInstanceId
				? and(
						jobServerScopeCondition(serverInstanceId),
						sql`${jobs.status} in ('pending','running','retry_scheduled')`
					)
				: sql`${jobs.status} in ('pending','running','retry_scheduled')`
		);
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
		serverInstanceId?: string;
		level?: EventLevelFilter;
		limit?: number;
		before?: number;
	} = {}
) {
	const limit = opts.limit ?? 50;
	const conds: SQL[] = [];
	if (opts.serverInstanceId) conds.push(eq(events.serverInstanceId, opts.serverInstanceId));
	if (opts.level) conds.push(eq(events.level, opts.level));
	if (typeof opts.before === 'number') conds.push(lt(events.id, opts.before));
	return db
		.select({
			id: events.id,
			level: events.level,
			type: events.type,
			message: events.message,
			code: events.code,
			parameters: events.parameters,
			createdAt: events.createdAt
		})
		.from(events)
		.where(conds.length ? and(...conds) : undefined)
		.orderBy(desc(events.id))
		.limit(limit);
}

/** Delete every activity-log row (the Settings "Clear activity" action). */
export async function clearEvents(serverInstanceId: string): Promise<void> {
	await db.delete(events).where(eq(events.serverInstanceId, serverInstanceId));
}
