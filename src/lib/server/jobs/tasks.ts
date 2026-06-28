import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { mediaItems } from '$lib/server/db/schema';
import {
	resolveConfig,
	requireConfig,
	requireActiveServer,
	setCachedLibraries,
	type ApplyMethod
} from '$lib/server/config';
import { resolveActiveServer, serverTypeLabel } from '$lib/server/media-server';
import { fetchMetadata, resolveTmdb } from '$lib/server/tmdb/client';
import { applyToItem, autoSelectPoster, discoverForItem } from '$lib/server/posters/service';
import { logEvent, pruneEvents } from '$lib/server/events';
import { createLimiter } from '$lib/server/http';
import { shouldReprocessItem } from './incremental';
import type { JobContext } from './runner';

function errorMessage(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

export type JobType = 'sync' | 'discover' | 'apply';

export type JobPayload =
	| { kind: 'sync'; full?: boolean }
	| { kind: 'discover'; itemIds?: number[]; forceRefresh?: boolean }
	| { kind: 'apply'; itemIds: number[]; method: ApplyMethod; selection: 'auto' | 'stored' };

/** Sync: pull the active server's libraries/items, upsert media_items, resolve TMDB ids. */
export async function runSyncJob(
	ctx: JobContext,
	payload?: Extract<JobPayload, { kind: 'sync' }>
): Promise<void> {
	// A full sync reprocesses every item; absent payload (legacy callers) = incremental.
	const full = payload?.full ?? false;
	const config = await resolveConfig();
	requireActiveServer(config);
	requireConfig(config, ['tmdbKey']);
	const { server } = resolveActiveServer(config);
	if (!server) throw new Error(`${serverTypeLabel(config.serverType)} is not configured`);

	const allSections = await server.listLibraries();
	// Refresh the Settings "Libraries to sync" cache from this authoritative list.
	await setCachedLibraries(allSections);
	const sections = config.includedSections.length
		? allSections.filter((s) => config.includedSections.includes(s.key))
		: allSections;

	// Prune items from libraries no longer synced (excluded in settings, or removed
	// from the server). Cascades to their candidates/history. Keeps the count accurate.
	const keepKeys = sections.map((s) => s.key);
	if (keepKeys.length) {
		await db.delete(mediaItems).where(notInArray(mediaItems.sectionKey, keepKeys));
	}

	type SyncItem = Awaited<ReturnType<typeof server.listItems>>[number];
	const work: { sectionKey: string; item: SyncItem }[] = [];
	for (const section of sections) {
		const items = await server.listItems(section.key);
		for (const item of items) work.push({ sectionKey: section.key, item });
	}

	await ctx.setTotal(work.length);
	await logEvent('info', 'sync', 'Library sync started', { items: work.length });
	let processed = 0;
	for (const { sectionKey, item } of work) {
		if (ctx.isCancelled()) break;
		await ctx.progress(processed, item.title);

		const base = {
			ratingKey: item.id,
			sectionKey,
			type: item.type,
			title: item.title,
			year: item.year ?? null,
			tmdbId: item.guids.tmdb ?? null,
			imdbId: item.guids.imdb ?? null,
			tvdbId: item.guids.tvdb ?? null,
			currentPosterUrl: item.currentPosterUrl,
			// Record the server's change time for incremental skips. lastSyncedAt is
			// advanced separately, only once the item is actually processed (below), so a
			// transient failure leaves the item eligible for retry on the next sync.
			serverUpdatedAt: item.serverUpdatedAt,
			updatedAt: new Date()
		};

		const existing = (
			await db.select().from(mediaItems).where(eq(mediaItems.ratingKey, item.id)).limit(1)
		)[0];
		let itemId: number;
		if (existing) {
			await db.update(mediaItems).set(base).where(eq(mediaItems.id, existing.id));
			itemId = existing.id;
		} else {
			const [inserted] = await db.insert(mediaItems).values(base).returning();
			itemId = inserted.id;
		}

		// Skip the expensive TMDB resolution + enrichment when the item is unchanged
		// since the last sync. The row above is still upserted (kept/unpruned) with a
		// refreshed serverUpdatedAt; we only avoid the network work.
		const reprocess = shouldReprocessItem(
			item.serverUpdatedAt,
			existing?.serverUpdatedAt ?? null,
			existing?.lastSyncedAt ?? null,
			{ full, incremental: config.incrementalSync }
		);
		// Only advance lastSyncedAt once the item is fully processed this pass. An
		// unchanged item is already considered synced; a transient resolve/enrich
		// failure leaves it unsynced so the next sync retries it.
		let synced = !reprocess;
		if (reprocess) {
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

					// Enrich with TMDB display metadata. A failure here leaves the item
					// resolved but un-enriched and unsynced, so it is retried on a later sync.
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
						synced = true;
					} catch {
						// Enrichment failed (network/parse); leave it for the next sync to retry.
					}
				} else {
					await db.update(mediaItems).set({ resolved: false }).where(eq(mediaItems.id, itemId));
					// Deterministic no-match — retrying won't help until the server item changes.
					synced = true;
				}
			} catch {
				// Resolve failed (transient); leave unresolved + unsynced so a later sync retries.
			}
		}

		// Advance the sync watermark only for fully-processed items.
		if (synced) {
			await db
				.update(mediaItems)
				.set({ lastSyncedAt: new Date() })
				.where(eq(mediaItems.id, itemId));
		}

		processed++;
		await ctx.progress(processed, item.title);
	}

	if (ctx.isCancelled()) {
		await logEvent('warn', 'sync', 'Library sync interrupted', { processed, total: work.length });
	} else {
		await logEvent('info', 'sync', `Library sync finished (${processed} items)`, { processed });
	}
	await pruneEvents();
}

/** Discover: find MediaUX candidates for the given items (or all resolved items). */
export async function runDiscoverJob(
	ctx: JobContext,
	payload: Extract<JobPayload, { kind: 'discover' }>
): Promise<void> {
	const config = await resolveConfig();
	// Ignored items are excluded from discovery regardless of how they're selected.
	const items =
		payload.itemIds && payload.itemIds.length
			? await db
					.select()
					.from(mediaItems)
					.where(and(inArray(mediaItems.id, payload.itemIds), eq(mediaItems.ignored, false)))
			: await db
					.select()
					.from(mediaItems)
					.where(and(eq(mediaItems.resolved, true), eq(mediaItems.ignored, false)));

	await ctx.setTotal(items.length);
	await logEvent('info', 'discover', 'Discovery started', { items: items.length });
	let processed = 0;
	let failed = 0;
	for (const item of items) {
		if (ctx.isCancelled()) break;
		await ctx.progress(processed, item.title);
		try {
			await discoverForItem(item, config, { forceRefresh: payload.forceRefresh });
		} catch (e) {
			// Skip an item that fails discovery; the rest continue.
			failed++;
			await logEvent('warn', 'discover', `Discovery failed for "${item.title}"`, {
				title: item.title,
				error: errorMessage(e)
			});
		}
		processed++;
		await ctx.progress(processed, item.title);
	}

	if (ctx.isCancelled()) {
		await logEvent('warn', 'discover', 'Discovery interrupted', { processed, failed });
	} else {
		await logEvent(
			'info',
			'discover',
			`Discovery finished (${processed} items, ${failed} failed)`,
			{
				processed,
				failed
			}
		);
	}
	await pruneEvents();
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
	// Ignored items are never touched by a bulk apply, even if their id is passed.
	const items = await db
		.select()
		.from(mediaItems)
		.where(and(inArray(mediaItems.id, payload.itemIds), eq(mediaItems.ignored, false)));

	await ctx.setTotal(items.length);
	await logEvent('info', 'apply', 'Apply started', { items: items.length, method: payload.method });

	// Process items with bounded concurrency. The JS event loop is single-threaded,
	// so the shared counters are mutated atomically between awaits — no locking needed.
	const limit = createLimiter(Math.max(1, config.applyConcurrency));
	let processed = 0;
	let applied = 0;
	let failed = 0;
	await Promise.all(
		items.map((item) =>
			limit(async () => {
				// Don't begin new item work once cancellation has been requested. Items
				// still queued behind the limiter bail here when they finally start.
				if (ctx.isCancelled()) return;
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
						const outcomes = await applyToItem(item, {
							posterUrl,
							backgroundUrl,
							method: payload.method,
							config
						});
						// Per-method success/failure is logged inside applyToItem; here we
						// only tally the per-item result for the run summary.
						const failures = outcomes.filter((o) => o.status === 'failed');
						if (failures.length) failed++;
						else applied++;
					}
				} catch (e) {
					// Record-keeping happens inside applyToItem; an unexpected error still counts.
					failed++;
					await logEvent('error', 'apply', `Apply failed for "${item.title}"`, {
						title: item.title,
						method: payload.method,
						error: errorMessage(e)
					});
				}
				// Emit progress as each item completes (order is non-deterministic).
				processed++;
				await ctx.progress(processed, item.title);
			})
		)
	);

	await logEvent('info', 'apply', `Applied ${applied} covers (${failed} failed)`, {
		applied,
		failed,
		processed
	});
	await pruneEvents();
}
