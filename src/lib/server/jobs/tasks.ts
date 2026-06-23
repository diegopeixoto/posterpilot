import { eq, inArray, notInArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { mediaItems } from '$lib/server/db/schema';
import { resolveConfig, requireConfig, type ApplyMethod } from '$lib/server/config';
import { listSections, listItems } from '$lib/server/plex/client';
import { fetchMetadata, resolveTmdb } from '$lib/server/tmdb/client';
import { applyToItem, autoSelectPoster, discoverForItem } from '$lib/server/posters/service';
import type { JobContext } from './runner';

export type JobType = 'sync' | 'discover' | 'apply';

export type JobPayload =
	| { kind: 'sync' }
	| { kind: 'discover'; itemIds?: number[]; forceRefresh?: boolean }
	| { kind: 'apply'; itemIds: number[]; method: ApplyMethod; selection: 'auto' | 'stored' };

/** Sync: pull Plex sections/items, upsert media_items, resolve TMDB ids. */
export async function runSyncJob(ctx: JobContext): Promise<void> {
	const config = await resolveConfig();
	requireConfig(config, ['plexUrl', 'plexToken', 'tmdbKey']);
	const plexUrl = config.plexUrl!;
	const plexToken = config.plexToken!;

	const allSections = await listSections(plexUrl, plexToken);
	const sections = config.includedSections.length
		? allSections.filter((s) => config.includedSections.includes(s.key))
		: allSections;

	// Prune items from libraries no longer synced (excluded in settings, or removed
	// from Plex). Cascades to their candidates/history. Keeps the count accurate.
	const keepKeys = sections.map((s) => s.key);
	if (keepKeys.length) {
		await db.delete(mediaItems).where(notInArray(mediaItems.sectionKey, keepKeys));
	}

	const work: { sectionKey: string; item: Awaited<ReturnType<typeof listItems>>[number] }[] = [];
	for (const section of sections) {
		const items = await listItems(plexUrl, plexToken, section.key);
		for (const item of items) work.push({ sectionKey: section.key, item });
	}

	await ctx.setTotal(work.length);
	let processed = 0;
	for (const { sectionKey, item } of work) {
		if (ctx.isCancelled()) break;
		await ctx.progress(processed, item.title);

		const base = {
			ratingKey: item.ratingKey,
			sectionKey,
			type: item.type,
			title: item.title,
			year: item.year ?? null,
			tmdbId: item.guids.tmdb ?? null,
			imdbId: item.guids.imdb ?? null,
			tvdbId: item.guids.tvdb ?? null,
			currentPosterUrl: item.currentPosterUrl,
			updatedAt: new Date()
		};

		const existing = (
			await db.select().from(mediaItems).where(eq(mediaItems.ratingKey, item.ratingKey)).limit(1)
		)[0];
		let itemId: number;
		if (existing) {
			await db.update(mediaItems).set(base).where(eq(mediaItems.id, existing.id));
			itemId = existing.id;
		} else {
			const [inserted] = await db.insert(mediaItems).values(base).returning();
			itemId = inserted.id;
		}

		try {
			const resolution = await resolveTmdb(item.guids, config.tmdbKey!, {
				cacheTtlDays: config.httpCacheTtlDays
			});
			if (resolution) {
				await db
					.update(mediaItems)
					.set({
						tmdbId: resolution.tmdbId,
						mediaType: resolution.mediaType,
						resolved: true,
						updatedAt: new Date()
					})
					.where(eq(mediaItems.id, itemId));

				// Enrich with TMDB display metadata. Best-effort: a failure here leaves
				// the item resolved but un-enriched, to be backfilled on a later sync.
				try {
					const meta = await fetchMetadata(
						resolution.tmdbId,
						resolution.mediaType,
						config.tmdbKey!,
						{ cacheTtlDays: config.httpCacheTtlDays, fetchLogo: !existing?.logoUrl }
					);
					await db
						.update(mediaItems)
						.set({
							overview: meta.overview,
							tagline: meta.tagline,
							genres: meta.genres,
							runtime: meta.runtime,
							rating: meta.rating,
							backdropUrl: meta.backdropUrl,
							// Keep an existing logo if we skipped the images call this run.
							logoUrl: meta.logoUrl ?? existing?.logoUrl ?? null,
							seasonCount: meta.seasonCount,
							episodeCount: meta.episodeCount,
							cast: meta.cast,
							updatedAt: new Date()
						})
						.where(eq(mediaItems.id, itemId));
				} catch {
					// Enrichment failed (network/parse); leave metadata for the next sync.
				}
			} else {
				await db.update(mediaItems).set({ resolved: false }).where(eq(mediaItems.id, itemId));
			}
		} catch {
			// Leave unresolved; a later sync or forced refresh can retry.
		}

		processed++;
		await ctx.progress(processed, item.title);
	}
}

/** Discover: find MediaUX candidates for the given items (or all resolved items). */
export async function runDiscoverJob(
	ctx: JobContext,
	payload: Extract<JobPayload, { kind: 'discover' }>
): Promise<void> {
	const config = await resolveConfig();
	const items =
		payload.itemIds && payload.itemIds.length
			? await db.select().from(mediaItems).where(inArray(mediaItems.id, payload.itemIds))
			: await db.select().from(mediaItems).where(eq(mediaItems.resolved, true));

	await ctx.setTotal(items.length);
	let processed = 0;
	for (const item of items) {
		if (ctx.isCancelled()) break;
		await ctx.progress(processed, item.title);
		try {
			await discoverForItem(item, config, { forceRefresh: payload.forceRefresh });
		} catch {
			// Skip an item that fails discovery; the rest continue.
		}
		processed++;
		await ctx.progress(processed, item.title);
	}
}

/** Apply: apply selected (or auto-selected) covers to the given items. */
export async function runApplyJob(
	ctx: JobContext,
	payload: Extract<JobPayload, { kind: 'apply' }>
): Promise<void> {
	const config = await resolveConfig();
	if (!payload.itemIds.length) {
		await ctx.setTotal(0);
		return;
	}
	const items = await db.select().from(mediaItems).where(inArray(mediaItems.id, payload.itemIds));

	await ctx.setTotal(items.length);
	let processed = 0;
	for (const item of items) {
		if (ctx.isCancelled()) break;
		await ctx.progress(processed, item.title);
		try {
			let posterUrl: string | null = null;
			let backgroundUrl: string | null = null;

			if (payload.selection === 'auto') {
				posterUrl = await autoSelectPoster(item.id);
				if (!posterUrl) {
					await discoverForItem(item, config);
					posterUrl = await autoSelectPoster(item.id);
				}
			} else {
				posterUrl = item.selectedPosterUrl;
				backgroundUrl = item.selectedBackgroundUrl;
			}

			if (posterUrl) {
				await applyToItem(item, { posterUrl, backgroundUrl, method: payload.method, config });
			}
		} catch {
			// Record-keeping happens inside applyToItem; skip on unexpected errors.
		}
		processed++;
		await ctx.progress(processed, item.title);
	}
}
