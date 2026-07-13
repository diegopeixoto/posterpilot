import { and, asc, desc, eq, gte, inArray, isNull, like, or, sql, type SQL } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	jobs,
	jobItemOutcomes,
	mediaItems,
	posterCandidates,
	serverInstances
} from '$lib/server/db/schema';
import { REVIEW_STATES, type ReviewState } from './state';
import { reviewStateExpression } from './state-sql';
import { buildReviewDashboardSummary } from './dashboard-summary';

export type ReviewAvailability = 'candidates' | 'mediux' | 'none';
export type ReviewSort = 'priority' | 'updated' | 'title' | 'year';

export interface ReviewFilter {
	serverInstanceId: string;
	librarySectionKey?: string;
	state?: ReviewState;
	attention?: boolean;
	type?: 'movie' | 'show';
	availability?: ReviewAvailability;
	changedSince?: Date;
	jobId?: number;
	q?: string;
	sort?: ReviewSort;
}

export interface ReviewPageOptions {
	limit: number;
	offset: number;
}

export interface ReviewCandidateSummary {
	id: number;
	url: string;
	kind: 'poster' | 'background';
	provider: string;
	setId: string;
	setAuthor: string | null;
	score: number | null;
	stale: boolean;
}

function reviewConditions(filter: ReviewFilter): SQL[] {
	const conditions: SQL[] = [
		eq(mediaItems.serverInstanceId, filter.serverInstanceId),
		isNull(mediaItems.sourceRemovedAt)
	];
	if (filter.librarySectionKey) {
		conditions.push(eq(mediaItems.sectionKey, filter.librarySectionKey));
	}
	if (filter.state) conditions.push(eq(reviewStateExpression, filter.state));
	else if (filter.attention) {
		conditions.push(sql`${reviewStateExpression} not in ('completed', 'ignored')`);
	}
	if (filter.type) conditions.push(eq(mediaItems.type, filter.type));
	if (filter.availability === 'candidates') conditions.push(eq(mediaItems.hasCandidates, true));
	if (filter.availability === 'mediux') conditions.push(eq(mediaItems.hasMediux, true));
	if (filter.availability === 'none') conditions.push(eq(mediaItems.hasCandidates, false));
	if (filter.changedSince) conditions.push(gte(mediaItems.updatedAt, filter.changedSince));
	if (filter.jobId) {
		conditions.push(sql`exists (
			select 1 from job_item_outcomes automation_scope
			where automation_scope.job_id = ${filter.jobId}
				and automation_scope.server_instance_id = ${mediaItems.serverInstanceId}
				and automation_scope.media_item_id = ${mediaItems.id}
		)`);
	}
	if (filter.q) conditions.push(like(mediaItems.title, `%${filter.q}%`));
	return conditions;
}

function orderBy(filter: ReviewFilter): SQL[] {
	if (filter.sort === 'title') return [asc(mediaItems.title), asc(mediaItems.id)];
	if (filter.sort === 'year')
		return [desc(mediaItems.year), asc(mediaItems.title), asc(mediaItems.id)];
	if (filter.sort === 'updated') return [desc(mediaItems.updatedAt), asc(mediaItems.id)];
	const priority = sql`case ${reviewStateExpression}
		when 'partial_failure' then 0
		when 'externally_changed' then 1
		when 'unresolved' then 2
		when 'staged' then 3
		when 'suggestion_ready' then 4
		when 'no_candidates' then 5
		when 'new' then 6
		when 'ignored' then 7
		else 8 end`;
	return [asc(priority), desc(mediaItems.updatedAt), asc(mediaItems.id)];
}

/**
 * Materialize the deterministic order behind a review view. The ids stay on the
 * server and are used to create a short-lived navigation context for item detail.
 */
export async function listReviewItemIds(filter: ReviewFilter): Promise<number[]> {
	const rows = await db
		.select({ id: mediaItems.id })
		.from(mediaItems)
		.where(and(...reviewConditions(filter)))
		.orderBy(...orderBy(filter));
	return rows.map((row) => row.id);
}

export async function queryReviewInbox(filter: ReviewFilter, page: ReviewPageOptions) {
	const conditions = reviewConditions(filter);
	const [rows, countRows, countByState] = await Promise.all([
		db
			.select({
				id: mediaItems.id,
				serverInstanceId: mediaItems.serverInstanceId,
				sectionKey: mediaItems.sectionKey,
				type: mediaItems.type,
				title: mediaItems.title,
				year: mediaItems.year,
				tmdbId: mediaItems.tmdbId,
				mediaType: mediaItems.mediaType,
				resolved: mediaItems.resolved,
				resolutionReason: mediaItems.resolutionReason,
				manualMatchPinned: mediaItems.manualMatchPinned,
				resolutionUpdatedAt: mediaItems.resolutionUpdatedAt,
				hasCurrentPoster: sql<number>`case when ${mediaItems.currentPosterUrl} is null then 0 else 1 end`,
				hasCurrentBackground: sql<number>`case when ${mediaItems.currentBackgroundUrl} is null then 0 else 1 end`,
				currentPosterFingerprint: mediaItems.currentPosterFingerprint,
				currentBackgroundFingerprint: mediaItems.currentBackgroundFingerprint,
				artworkVersion: mediaItems.artworkVersion,
				backdropUrl: mediaItems.backdropUrl,
				selectedPosterUrl: mediaItems.selectedPosterUrl,
				selectedBackgroundUrl: mediaItems.selectedBackgroundUrl,
				hasCandidates: mediaItems.hasCandidates,
				hasMediux: mediaItems.hasMediux,
				ignored: mediaItems.ignored,
				reviewedAt: mediaItems.reviewedAt,
				discoveryStatus: mediaItems.discoveryStatus,
				externalArtworkChangedAt: mediaItems.externalArtworkChangedAt,
				lastVerifiedAt: mediaItems.lastVerifiedAt,
				updatedAt: mediaItems.updatedAt,
				state: reviewStateExpression,
				stagedChildCount: sql<number>`(
					select count(*) from child_selections staged_count
					where staged_count.media_item_id = ${mediaItems.id}
						and staged_count.server_instance_id = ${mediaItems.serverInstanceId}
				)`
			})
			.from(mediaItems)
			.where(and(...conditions))
			.orderBy(...orderBy(filter))
			.limit(Math.min(100, Math.max(1, page.limit)))
			.offset(Math.max(0, page.offset)),
		db
			.select({ count: sql<number>`count(*)` })
			.from(mediaItems)
			.where(and(...conditions)),
		db
			.select({ state: reviewStateExpression, count: sql<number>`count(*)` })
			.from(mediaItems)
			.where(
				and(
					eq(mediaItems.serverInstanceId, filter.serverInstanceId),
					isNull(mediaItems.sourceRemovedAt)
				)
			)
			.groupBy(reviewStateExpression)
	]);

	const ids = rows.map((row) => row.id);
	const [candidates, failedSlots] = ids.length
		? await Promise.all([
				db
					.select({
						id: posterCandidates.id,
						mediaItemId: posterCandidates.mediaItemId,
						url: posterCandidates.url,
						kind: posterCandidates.kind,
						provider: posterCandidates.provider,
						setId: posterCandidates.setId,
						setAuthor: posterCandidates.setAuthor,
						score: posterCandidates.score,
						stale: posterCandidates.stale
					})
					.from(posterCandidates)
					.where(
						and(
							eq(posterCandidates.serverInstanceId, filter.serverInstanceId),
							inArray(posterCandidates.mediaItemId, ids),
							eq(posterCandidates.active, true),
							or(eq(posterCandidates.kind, 'poster'), eq(posterCandidates.kind, 'background'))
						)
					)
					.orderBy(
						asc(posterCandidates.mediaItemId),
						asc(posterCandidates.kind),
						desc(posterCandidates.score),
						asc(posterCandidates.id)
					),
				db
					.select({
						mediaItemId: jobItemOutcomes.mediaItemId,
						destination: jobItemOutcomes.destination,
						kind: jobItemOutcomes.kind,
						season: jobItemOutcomes.season,
						episode: jobItemOutcomes.episode,
						errorCode: jobItemOutcomes.errorCode,
						retryable: jobItemOutcomes.retryable
					})
					.from(jobItemOutcomes)
					.where(
						and(
							eq(jobItemOutcomes.serverInstanceId, filter.serverInstanceId),
							inArray(jobItemOutcomes.mediaItemId, ids),
							eq(jobItemOutcomes.status, 'failed'),
							sql`${jobItemOutcomes.jobId} = (
								select max(latest_failed.job_id) from job_item_outcomes latest_failed
								where latest_failed.media_item_id = ${jobItemOutcomes.mediaItemId}
									and latest_failed.server_instance_id = ${jobItemOutcomes.serverInstanceId}
							)`
						)
					)
			])
		: [[], []];

	const items = rows.map((item) => {
		const own = candidates.filter((candidate) => candidate.mediaItemId === item.id);
		const first = (kind: 'poster' | 'background'): ReviewCandidateSummary | null => {
			const candidate = own.find((entry) => entry.kind === kind);
			return candidate
				? {
						id: candidate.id,
						url: candidate.url,
						kind,
						provider: candidate.provider,
						setId: candidate.setId,
						setAuthor: candidate.setAuthor,
						score: candidate.score,
						stale: candidate.stale
					}
				: null;
		};
		return {
			item: {
				...item,
				hasCurrentPoster: item.hasCurrentPoster === 1,
				hasCurrentBackground: item.hasCurrentBackground === 1
			},
			suggestion: { poster: first('poster'), background: first('background') },
			failedSlots: failedSlots.filter((slot) => slot.mediaItemId === item.id)
		};
	});

	return {
		items,
		total: countRows[0]?.count ?? 0,
		counts: Object.fromEntries(
			REVIEW_STATES.map((state) => [
				state,
				countByState.find((row) => row.state === state)?.count ?? 0
			])
		) as Record<ReviewState, number>
	};
}

export async function listReviewScopes() {
	const [servers, libraries] = await Promise.all([
		db
			.select({ id: serverInstances.id, name: serverInstances.name, type: serverInstances.type })
			.from(serverInstances)
			.where(eq(serverInstances.enabled, true))
			.orderBy(asc(serverInstances.name)),
		db
			.select({
				serverInstanceId: mediaItems.serverInstanceId,
				sectionKey: mediaItems.sectionKey,
				type: mediaItems.type,
				count: sql<number>`count(*)`
			})
			.from(mediaItems)
			.where(isNull(mediaItems.sourceRemovedAt))
			.groupBy(mediaItems.serverInstanceId, mediaItems.sectionKey, mediaItems.type)
			.orderBy(asc(mediaItems.sectionKey))
	]);
	return { servers, libraries };
}

/** Exact actionable counts for the active server and each of its libraries. */
export async function getReviewDashboardSummary(serverInstanceId: string) {
	const [stateRows, libraryRows, failedRows] = await Promise.all([
		db
			.select({ state: reviewStateExpression, count: sql<number>`count(*)` })
			.from(mediaItems)
			.where(
				and(eq(mediaItems.serverInstanceId, serverInstanceId), isNull(mediaItems.sourceRemovedAt))
			)
			.groupBy(reviewStateExpression),
		db
			.select({
				sectionKey: mediaItems.sectionKey,
				state: reviewStateExpression,
				count: sql<number>`count(*)`
			})
			.from(mediaItems)
			.where(
				and(eq(mediaItems.serverInstanceId, serverInstanceId), isNull(mediaItems.sourceRemovedAt))
			)
			.groupBy(mediaItems.sectionKey, reviewStateExpression),
		db
			.select({ count: sql<number>`count(*)` })
			.from(jobs)
			.where(
				and(
					eq(jobs.serverInstanceId, serverInstanceId),
					inArray(jobs.status, ['partial_failed', 'failed', 'interrupted'])
				)
			)
	]);
	return buildReviewDashboardSummary(stateRows, libraryRows, failedRows[0]?.count ?? 0);
}
