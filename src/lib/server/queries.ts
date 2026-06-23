import { and, desc, eq, like, sql, type SQL } from 'drizzle-orm';
import { db } from './db';
import { appliedPosters, jobs, mediaItems, posterCandidates } from './db/schema';

export interface LibraryFilter {
	type?: 'movie' | 'show';
	missingPoster?: boolean;
	hasMediux?: boolean;
	/** Only items posterpilot has not applied a cover to (still on the Plex default). */
	unchanged?: boolean;
	q?: string;
}

/** List library items matching the given filters, ordered by title. */
export async function listLibrary(filter: LibraryFilter = {}) {
	const conds: SQL[] = [];
	if (filter.type) conds.push(eq(mediaItems.type, filter.type));
	if (filter.hasMediux) conds.push(eq(mediaItems.hasMediux, true));
	if (filter.missingPoster) conds.push(sql`${mediaItems.currentPosterUrl} is null`);
	if (filter.unchanged)
		conds.push(
			sql`not exists (select 1 from applied_posters ap where ap.media_item_id = ${mediaItems.id} and ap.status = 'success')`
		);
	if (filter.q) conds.push(like(mediaItems.title, `%${filter.q}%`));
	return db
		.select()
		.from(mediaItems)
		.where(conds.length ? and(...conds) : undefined)
		.orderBy(mediaItems.title);
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
	return { item, candidates, history };
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
