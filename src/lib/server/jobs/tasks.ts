import { and, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { mediaItems } from '$lib/server/db/schema';
import {
	resolveConfig,
	getIncludedSectionsForServer,
	requireConfig,
	setCachedLibraries
} from '$lib/server/config';
import { fetchMetadata, resolveTmdbStrict } from '$lib/server/tmdb/client';
import { pickExternalId } from '$lib/server/tmdb/auth';
import { manualMatchRepository } from '$lib/server/tmdb/manual-match-runtime';
import { discoverForItem } from '$lib/server/posters/service';
import { logEvent, pruneEvents } from '$lib/server/events';
import { shouldReprocessItem } from './incremental';
import type { JobContext, JobPayload, JobTaskResult } from './types';
import { resolveMediaServerInstance } from '$lib/server/server-instances';
import { executeDatabaseFrozenApplyJob } from '$lib/server/plans/apply-runtime';
import { executeFrozenArtworkUndoJob } from '$lib/server/artwork-revisions/undo-runtime';
import { createCollectionRepository } from '$lib/server/collections/repository';
import { reconcileOptionalNativeCollections } from '$lib/server/collections/native-sync';
import { createDatabaseFullRescanArtworkObserver } from './full-rescan-artwork';
import { sanitizeServerArtworkUrl } from '$lib/server/media-server/artwork-url';

const collectionRepository = createCollectionRepository(db);
const observeFullRescanArtwork = createDatabaseFullRescanArtworkObserver(db);

function errorMessage(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

export type JobType = 'sync' | 'full_rescan' | 'discover' | 'apply';
export type { JobPayload } from './types';

interface JobTaskExecutionOptions {
	libraryScopes?: string[];
	providers?: string[];
}

/** Sync: pull the active server's libraries/items, upsert media_items, resolve TMDB ids. */
export async function runSyncJob(
	ctx: JobContext,
	payload: Extract<JobPayload, { kind: 'sync' }>,
	options: JobTaskExecutionOptions = {}
): Promise<JobTaskResult> {
	const full = payload.full ?? false;
	const serverInstanceId = payload.serverInstanceId;
	const config = await resolveConfig();
	requireConfig(config, ['tmdbKey']);
	const { server } = await resolveMediaServerInstance(serverInstanceId, {
		requireEnabled: true
	});

	await ctx.setPhase('server_read');
	const allSections = await server.listLibraries();
	// Refresh the Settings "Libraries to sync" cache from this authoritative list.
	await setCachedLibraries(allSections, serverInstanceId);
	const includedSections = await getIncludedSectionsForServer(serverInstanceId);
	const configuredSections = includedSections.length
		? allSections.filter((s) => includedSections.includes(s.key))
		: allSections;
	const requestedLibraryScopes = options.libraryScopes
		? [...new Set(options.libraryScopes)]
		: payload.librarySectionKey
			? [payload.librarySectionKey]
			: null;
	if (
		requestedLibraryScopes &&
		requestedLibraryScopes.some((key) => !configuredSections.some((section) => section.key === key))
	) {
		throw new Error('job_library_scope_mismatch');
	}
	const sections = requestedLibraryScopes
		? configuredSections.filter((section) => requestedLibraryScopes.includes(section.key))
		: configuredSections;
	const scopedLibraryRun = requestedLibraryScopes !== null;

	// Preserve item identity and revision history when a library leaves the active
	// sync scope. Re-enabling it clears this marker during the upsert below.
	const keepKeys = sections.map((s) => s.key);
	const removalObservedAt = new Date();
	const unavailableItemIds = new Set<number>();
	await ctx.setPhase('reconciliation');
	const outOfScopeItems = scopedLibraryRun
		? []
		: await db
				.select({ id: mediaItems.id })
				.from(mediaItems)
				.where(
					and(
						eq(mediaItems.serverInstanceId, serverInstanceId),
						keepKeys.length ? notInArray(mediaItems.sectionKey, keepKeys) : undefined
					)
				);
	for (const item of outOfScopeItems) unavailableItemIds.add(item.id);
	if (!scopedLibraryRun && outOfScopeItems.length) {
		await db
			.update(mediaItems)
			.set({ sourceRemovedAt: removalObservedAt, updatedAt: removalObservedAt })
			.where(
				and(
					eq(mediaItems.serverInstanceId, serverInstanceId),
					isNull(mediaItems.sourceRemovedAt),
					keepKeys.length ? notInArray(mediaItems.sectionKey, keepKeys) : undefined
				)
			);
	}

	type SyncItem = Awaited<ReturnType<typeof server.listItems>>[number];
	const work: { sectionKey: string; item: SyncItem }[] = [];
	await ctx.setPhase('server_read');
	for (const section of sections) {
		const items = await server.listItems(section.key);
		for (const item of items) work.push({ sectionKey: section.key, item });
	}

	// Mark items that disappeared from an included source library without deleting
	// their snapshots or immutable revision timeline.
	await ctx.setPhase('reconciliation');
	if (sections.length) {
		const seen = new Set(work.map(({ sectionKey, item }) => `${sectionKey}\u0000${item.id}`));
		const known = await db
			.select({
				id: mediaItems.id,
				sectionKey: mediaItems.sectionKey,
				ratingKey: mediaItems.ratingKey
			})
			.from(mediaItems)
			.where(
				and(
					eq(mediaItems.serverInstanceId, serverInstanceId),
					inArray(mediaItems.sectionKey, keepKeys)
				)
			);
		const removedIds = known
			.filter((row) => !seen.has(`${row.sectionKey}\u0000${row.ratingKey}`))
			.map((row) => row.id);
		for (const id of removedIds) unavailableItemIds.add(id);
		for (let offset = 0; offset < removedIds.length; offset += 500) {
			await db
				.update(mediaItems)
				.set({ sourceRemovedAt: removalObservedAt, updatedAt: removalObservedAt })
				.where(
					and(
						inArray(mediaItems.id, removedIds.slice(offset, offset + 500)),
						isNull(mediaItems.sourceRemovedAt)
					)
				);
		}
	}
	if (unavailableItemIds.size) {
		await collectionRepository.reconcileUnavailableItems({
			serverInstanceId,
			mediaItemIds: [...unavailableItemIds],
			observedAt: removalObservedAt
		});
	}

	let executionWork = work;
	if (payload.itemIds) {
		const requestedIds = [...new Set(payload.itemIds)];
		const requestedRows = await db
			.select({
				id: mediaItems.id,
				sectionKey: mediaItems.sectionKey,
				ratingKey: mediaItems.ratingKey
			})
			.from(mediaItems)
			.where(
				and(eq(mediaItems.serverInstanceId, serverInstanceId), inArray(mediaItems.id, requestedIds))
			);
		if (requestedRows.length !== requestedIds.length) throw new Error('job_item_scope_mismatch');
		const requestedSourceKeys = new Set(
			requestedRows.map((row) => `${row.sectionKey}\u0000${row.ratingKey}`)
		);
		executionWork = work.filter(({ sectionKey, item }) =>
			requestedSourceKeys.has(`${sectionKey}\u0000${item.id}`)
		);
		if (executionWork.length !== requestedIds.length) throw new Error('job_item_unavailable');
	}

	await ctx.setTotal(executionWork.length);
	await logEvent('info', 'sync', 'Library sync started', {
		items: executionWork.length,
		serverInstanceId
	});
	let processed = 0;
	let succeeded = 0;
	let failed = 0;
	const newItems: Array<{ id: number; librarySectionKey: string }> = [];
	for (const { sectionKey, item } of executionWork) {
		if (ctx.isCancelled()) break;
		await ctx.progress(processed, item.title);

		const currentPosterUrl = sanitizeServerArtworkUrl(item.currentPosterUrl);
		const currentBackgroundUrl = sanitizeServerArtworkUrl(item.currentBackgroundUrl);
		const base = {
			serverInstanceId,
			ratingKey: item.id,
			sectionKey,
			type: item.type,
			title: item.title,
			year: item.year ?? null,
			imdbId: item.guids.imdb ?? null,
			tvdbId: item.guids.tvdb ?? null,
			currentPosterUrl,
			currentBackgroundUrl,
			// Record the server's change time for incremental skips. lastSyncedAt is
			// advanced separately, only once the item is actually processed (below), so a
			// transient failure leaves the item eligible for retry on the next sync.
			serverUpdatedAt: item.serverUpdatedAt,
			addedAt: item.addedAt,
			watched: item.watched,
			sourceRemovedAt: null,
			updatedAt: new Date()
		};

		const existing = (
			await db
				.select()
				.from(mediaItems)
				.where(
					and(eq(mediaItems.serverInstanceId, serverInstanceId), eq(mediaItems.ratingKey, item.id))
				)
				.limit(1)
		)[0];
		let itemId: number;
		if (existing) {
			await db
				.update(mediaItems)
				.set(base)
				.where(
					and(eq(mediaItems.serverInstanceId, serverInstanceId), eq(mediaItems.id, existing.id))
				);
			itemId = existing.id;
		} else {
			const [inserted] = await db.insert(mediaItems).values(base).returning();
			itemId = inserted.id;
			newItems.push({ id: itemId, librarySectionKey: sectionKey });
		}

		let externalChanges = 0;
		let observationFailure: unknown = null;
		if (full) {
			await ctx.setPhase('artwork_observation');
			try {
				const observation = await observeFullRescanArtwork({
					server,
					serverInstanceId,
					mediaItemId: itemId,
					sourceItemId: item.id,
					currentPosterUrl,
					currentBackgroundUrl,
					previous: existing
						? {
								currentPosterUrl: existing.currentPosterUrl,
								currentBackgroundUrl: existing.currentBackgroundUrl,
								currentPosterFingerprint: existing.currentPosterFingerprint,
								currentBackgroundFingerprint: existing.currentBackgroundFingerprint,
								lastVerifiedAt: existing.lastVerifiedAt,
								externalArtworkChangedAt: existing.externalArtworkChangedAt
							}
						: null,
					jobId: ctx.jobId
				});
				externalChanges = observation.externalChanges;
			} catch (error) {
				observationFailure = error;
				await logEvent('warn', 'sync', 'Full rescan artwork observation failed', {
					serverInstanceId,
					mediaItemId: itemId,
					code: 'full_rescan_artwork_observation_failed'
				});
			}
		}

		// Skip the expensive TMDB resolution + enrichment when the item is unchanged
		// since the last sync. The row above is still upserted (kept/unpruned) with a
		// refreshed serverUpdatedAt; we only avoid the network work.
		const reprocess = existing?.sourceRemovedAt
			? true
			: shouldReprocessItem(
					item.serverUpdatedAt,
					existing?.serverUpdatedAt ?? null,
					existing?.lastSyncedAt ?? null,
					{ full, incremental: config.incrementalSync }
				);
		// Only advance lastSyncedAt once the item is fully processed this pass. An
		// unchanged item is already considered synced; a transient resolve/enrich
		// failure leaves it unsynced so the next sync retries it.
		let synced = !reprocess && observationFailure === null;
		let itemFailure: unknown = observationFailure;
		if (reprocess) {
			await ctx.setPhase('resolution');
			try {
				let resolution =
					existing?.manualMatchPinned && existing.tmdbId && existing.mediaType
						? { tmdbId: existing.tmdbId, mediaType: existing.mediaType }
						: null;
				if (!existing?.manualMatchPinned) {
					const selected = pickExternalId(item.guids);
					const automatic = await resolveTmdbStrict(item.guids, config.tmdbKey!, {
						cacheTtlDays: config.httpCacheTtlDays,
						forceRefresh: full
					});
					if (automatic && selected) {
						const source = selected.source;
						const persisted = await manualMatchRepository.applyAutomaticResolution(
							serverInstanceId,
							itemId,
							{
								resolution: automatic,
								reason: source === 'tmdb' ? 'direct_tmdb_guid' : source,
								source,
								attemptedSources: [source],
								resolvedAt: new Date()
							}
						);
						resolution =
							persisted.resolved && persisted.tmdbId && persisted.mediaType
								? { tmdbId: persisted.tmdbId, mediaType: persisted.mediaType }
								: null;
						if (existing?.tmdbId && existing.tmdbId !== persisted.tmdbId) {
							await collectionRepository.reconcileTmdbItemCollection({
								serverInstanceId,
								mediaItemId: itemId,
								collection: null
							});
						}
					} else {
						await manualMatchRepository.applyAutomaticUnresolved(serverInstanceId, itemId, {
							reason: selected ? 'no_match' : 'no_external_guid',
							source: selected?.source ?? null,
							attemptedSources: selected ? [selected.source] : [],
							resolvedAt: new Date()
						});
						await collectionRepository.reconcileTmdbItemCollection({
							serverInstanceId,
							mediaItemId: itemId,
							collection: null
						});
					}
				}
				if (resolution) {
					// Enrich with TMDB display metadata. A failure here leaves the item
					// resolved but un-enriched and unsynced, so it is retried on a later sync.
					try {
						const meta = await fetchMetadata(
							resolution.tmdbId,
							resolution.mediaType,
							config.tmdbKey!,
							{
								cacheTtlDays: config.httpCacheTtlDays,
								forceRefresh: full,
								fetchLogo: full || !existing?.logoUrl
							}
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
						await collectionRepository.reconcileTmdbItemCollection({
							serverInstanceId,
							mediaItemId: itemId,
							collection: meta.collection
						});
						synced = observationFailure === null;
					} catch (error) {
						// Enrichment failed (network/parse); leave it for the next sync to retry.
						itemFailure = error;
					}
				} else if (!existing?.manualMatchPinned) {
					// Deterministic no-match — retrying won't help until the server item changes.
					synced = observationFailure === null;
				} else {
					// A malformed/incomplete pin remains authoritative until explicitly replaced/cleared.
					synced = observationFailure === null;
				}
			} catch (error) {
				// Resolve failed (transient); leave unresolved + unsynced so a later sync retries.
				itemFailure = error;
			}
		}

		// Advance the sync watermark only for fully-processed items.
		if (synced) {
			await db
				.update(mediaItems)
				.set({ lastSyncedAt: new Date() })
				.where(eq(mediaItems.id, itemId));
			succeeded++;
			await ctx.recordOutcome({
				serverInstanceId,
				mediaItemId: itemId,
				status: 'success',
				result: {
					sourceId: item.id,
					sectionKey,
					mode: full ? 'full_rescan' : 'incremental',
					externalChanges
				}
			});
		} else {
			failed++;
			await ctx.recordOutcome({
				serverInstanceId,
				mediaItemId: itemId,
				status: 'failed',
				retryable: true,
				errorCode: 'sync_item_transient',
				error: itemFailure ?? 'sync_item_transient'
			});
		}

		processed++;
		await ctx.progress(processed, item.title);
	}

	// Native collection discovery is optional and authoritative only for a complete
	// server/library pass. A missing method or transient provider failure never
	// blocks the TMDB-backed item work completed above, and never clears last-known
	// native associations on an inconclusive read.
	if (
		!payload.itemIds &&
		!scopedLibraryRun &&
		!ctx.isCancelled() &&
		server.listNativeCollections &&
		server.capabilities.nativeCollectionDiscovery !== 'unsupported'
	) {
		await ctx.setPhase('collections');
		const nativeResult = await reconcileOptionalNativeCollections({
			server,
			libraryKeys: sections.map((section) => section.key),
			reconcile: (collections) =>
				collectionRepository.reconcileNativeCollections({
					serverInstanceId,
					provider: server.type,
					collections
				})
		});
		if (nativeResult.status === 'failed') {
			await logEvent('warn', 'sync', 'Native collection discovery unavailable', {
				serverInstanceId,
				provider: server.type,
				code: 'native_collection_discovery_failed'
			});
		}
	}

	if (ctx.isCancelled()) {
		await logEvent('warn', 'sync', 'Library sync interrupted', {
			processed,
			total: executionWork.length,
			serverInstanceId
		});
	} else {
		await logEvent('info', 'sync', `Library sync finished (${processed} items)`, {
			processed,
			serverInstanceId
		});
	}
	await pruneEvents();
	return {
		summary: {
			processed,
			succeeded,
			failed,
			interrupted: Math.max(0, executionWork.length - processed)
		},
		automationEvents: {
			librarySectionKeys: sections.map((section) => section.key),
			newItems
		}
	};
}

/** Discover: find MediaUX candidates for the given items (or all resolved items). */
export async function runDiscoverJob(
	ctx: JobContext,
	payload: Extract<JobPayload, { kind: 'discover' }>,
	options: JobTaskExecutionOptions = {}
): Promise<JobTaskResult> {
	const config = await resolveConfig();
	const serverInstanceId = payload.serverInstanceId;
	// Ignored items are excluded from discovery regardless of how they're selected.
	const requestedIds = payload.itemIds
		? [...new Set(payload.itemIds.filter((id) => Number.isSafeInteger(id) && id > 0))]
		: [];
	const libraryScopes = options.libraryScopes ? [...new Set(options.libraryScopes)] : null;
	const items = requestedIds.length
		? await db
				.select()
				.from(mediaItems)
				.where(
					and(
						eq(mediaItems.serverInstanceId, serverInstanceId),
						inArray(mediaItems.id, requestedIds),
						libraryScopes ? inArray(mediaItems.sectionKey, libraryScopes) : undefined,
						isNull(mediaItems.sourceRemovedAt),
						eq(mediaItems.ignored, false)
					)
				)
		: await db
				.select()
				.from(mediaItems)
				.where(
					and(
						eq(mediaItems.serverInstanceId, serverInstanceId),
						libraryScopes ? inArray(mediaItems.sectionKey, libraryScopes) : undefined,
						isNull(mediaItems.sourceRemovedAt),
						eq(mediaItems.resolved, true),
						eq(mediaItems.ignored, false)
					)
				);
	if (requestedIds.length && items.length !== requestedIds.length) {
		throw new Error('job_item_scope_mismatch');
	}

	await ctx.setPhase('discovery');
	await ctx.setTotal(items.length);
	await logEvent('info', 'discover', 'Discovery started', {
		items: items.length,
		serverInstanceId
	});
	let processed = 0;
	let failed = 0;
	let succeeded = 0;
	for (const item of items) {
		if (ctx.isCancelled()) break;
		await ctx.progress(processed, item.title);
		try {
			await discoverForItem(item, config, {
				forceRefresh: payload.forceRefresh,
				providers: options.providers
			});
			succeeded++;
			await ctx.recordOutcome({
				serverInstanceId,
				mediaItemId: item.id,
				status: 'success'
			});
		} catch (e) {
			// Skip an item that fails discovery; the rest continue.
			failed++;
			await logEvent('warn', 'discover', `Discovery failed for "${item.title}"`, {
				title: item.title,
				serverInstanceId,
				mediaItemId: item.id,
				error: errorMessage(e)
			});
			await ctx.recordOutcome({
				serverInstanceId,
				mediaItemId: item.id,
				status: 'failed',
				retryable: true,
				errorCode: 'provider_discovery_failed',
				error: e
			});
		}
		processed++;
		await ctx.progress(processed, item.title);
	}

	if (ctx.isCancelled()) {
		await logEvent('warn', 'discover', 'Discovery interrupted', {
			processed,
			failed,
			serverInstanceId
		});
	} else {
		await logEvent(
			'info',
			'discover',
			`Discovery finished (${processed} items, ${failed} failed)`,
			{
				processed,
				failed,
				serverInstanceId
			}
		);
	}
	await pruneEvents();
	return {
		summary: {
			processed,
			succeeded,
			failed,
			interrupted: Math.max(0, items.length - processed)
		}
	};
}

/** Execute a frozen review-only automation occurrence without any apply path. */
export async function runAutomationJob(
	ctx: JobContext,
	payload: Extract<JobPayload, { kind: 'automation' }>
): Promise<JobTaskResult> {
	const occurrence = payload.occurrence;
	if (!occurrence.reviewOnly) throw new TypeError('automation_must_be_review_only');
	const scopedItemIds = payload.retryItemIds?.length ? payload.retryItemIds : occurrence.itemIds;
	await ctx.setPhase('automation_sync');
	const syncResult = await runSyncJob(
		ctx,
		{
			kind: 'sync',
			serverInstanceId: occurrence.serverInstanceId,
			...(scopedItemIds.length ? { itemIds: scopedItemIds } : {})
		},
		{ libraryScopes: occurrence.libraryScopes }
	);
	if (ctx.isCancelled() || occurrence.action === 'sync') {
		return { summary: syncResult.summary };
	}

	const requestedItemIds = scopedItemIds.length
		? scopedItemIds
		: (
				await db
					.select({ id: mediaItems.id })
					.from(mediaItems)
					.where(
						and(
							eq(mediaItems.serverInstanceId, occurrence.serverInstanceId),
							inArray(mediaItems.sectionKey, occurrence.libraryScopes),
							isNull(mediaItems.sourceRemovedAt),
							eq(mediaItems.resolved, true),
							eq(mediaItems.ignored, false)
						)
					)
			).map((row) => row.id);
	await ctx.setPhase('automation_discovery');
	const discoveryResult = await runDiscoverJob(
		ctx,
		{
			kind: 'discover',
			serverInstanceId: occurrence.serverInstanceId,
			itemIds: requestedItemIds,
			forceRefresh: occurrence.discoveryInputs.forceRefresh
		},
		{
			libraryScopes: occurrence.libraryScopes,
			providers: occurrence.discoveryInputs.providers
		}
	);
	return {
		summary: {
			processed: syncResult.summary.processed + discoveryResult.summary.processed,
			succeeded: syncResult.summary.succeeded + discoveryResult.summary.succeeded,
			failed: syncResult.summary.failed + discoveryResult.summary.failed,
			skipped: (syncResult.summary.skipped ?? 0) + (discoveryResult.summary.skipped ?? 0),
			interrupted:
				(syncResult.summary.interrupted ?? 0) + (discoveryResult.summary.interrupted ?? 0)
		}
	};
}

/** Apply: execute only the exact operations consumed from a frozen plan. */
export async function runApplyJob(
	ctx: JobContext,
	payload: Extract<JobPayload, { kind: 'apply' }>
) {
	const serverInstanceId =
		payload.plan.scope.serverInstanceIds.length === 1
			? payload.plan.scope.serverInstanceIds[0]
			: undefined;
	await ctx.setPhase('apply');
	await ctx.setTotal(payload.plan.summary.itemCount);
	await logEvent('info', 'apply', 'Frozen apply started', {
		planId: payload.planId,
		serverInstanceId,
		items: payload.plan.summary.itemCount,
		operations: payload.plan.summary.operationCount
	});
	const result = await executeDatabaseFrozenApplyJob(
		payload,
		{
			isCancelled: ctx.isCancelled,
			progress: (processed, item) => ctx.progress(processed, item.target.sourceId)
		},
		{ jobId: ctx.jobId }
	);
	await logEvent('info', 'apply', 'Frozen apply finished', {
		planId: payload.planId,
		serverInstanceId,
		succeeded: result.summary.succeeded,
		failed: result.summary.failed,
		skipped: result.summary.skipped
	});
	await pruneEvents();
	return result;
}

/**
 * Execute a frozen undo plan on the durable worker. Undo restores byte-exact
 * snapshots, so a failed operation is recorded as its own revision outcome rather
 * than retried blindly; the job reports the mixed result and the timeline stays
 * the source of truth.
 */
export async function runUndoJob(
	ctx: JobContext,
	payload: Extract<JobPayload, { kind: 'undo' }>
): Promise<JobTaskResult> {
	await ctx.setPhase('undo');
	await ctx.setTotal(payload.plan.summary.operationCount);
	await logEvent('info', 'apply', 'Artwork undo started', {
		planId: payload.planId,
		serverInstanceId: payload.plan.scope.serverInstanceId,
		operations: payload.plan.summary.operationCount
	});

	const result = await executeFrozenArtworkUndoJob({
		planId: payload.planId,
		digest: payload.digest,
		payload: payload.plan,
		jobId: ctx.jobId,
		initiator: 'job',
		onProgress: (completed, operation) => ctx.progress(completed, operation.targetId)
	});

	for (const operation of result.operations) {
		await ctx.recordOutcome({
			serverInstanceId: operation.serverInstanceId,
			mediaItemId: operation.target.kind === 'item' ? operation.target.mediaItemId : null,
			destination: operation.destination,
			kind: operation.slot.kind,
			season: operation.slot.season,
			episode: operation.slot.episode,
			status: operation.status,
			retryable: false,
			result: { operationId: operation.operationId, revisionId: operation.revisionId },
			errorCode: operation.errorCode
		});
	}

	await logEvent('info', 'apply', 'Artwork undo finished', {
		planId: payload.planId,
		serverInstanceId: payload.plan.scope.serverInstanceId,
		succeeded: result.summary.succeeded,
		failed: result.summary.failed,
		skipped: result.summary.skipped
	});
	return {
		summary: {
			processed: result.summary.total,
			succeeded: result.summary.succeeded,
			failed: result.summary.failed,
			skipped: result.summary.skipped
		}
	};
}
