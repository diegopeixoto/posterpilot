import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { serializeWrite } from '$lib/server/db/write-queue';
import {
	childSelections,
	mediaItems,
	posterCandidates,
	providerDiscoveryOutcomes,
	providerDiscoveryRuns,
	type MediaItem
} from '$lib/server/db/schema';
import type { AppConfig } from '$lib/server/config';
import { redact } from '$lib/server/config/redact';
import { logEvent } from '$lib/server/events';
import { PROVIDERS } from './providers';
import { providerAvailability } from './providers/availability';
import { scorePoster } from './score';
import { getScoreWeights } from './score-weights';
import {
	selectAutomaticArtwork,
	type AutomaticArtworkSelection,
	type AutomaticSelectionInputs
} from './automatic-selection';

/** Discover per provider without erasing last-known-good data when one source fails. */
export async function discoverForItem(
	item: MediaItem,
	config: AppConfig,
	opts?: { forceRefresh?: boolean; providers?: readonly string[] }
): Promise<number> {
	const requestedProviders = opts?.providers ? new Set(opts.providers) : null;
	const providers = requestedProviders
		? PROVIDERS.filter((provider) => requestedProviders.has(provider.id))
		: PROVIDERS;
	if (requestedProviders && providers.length !== requestedProviders.size) {
		throw new TypeError('discovery_provider_scope_invalid');
	}
	const runId = randomUUID();
	const startedAt = new Date();
	await db.insert(providerDiscoveryRuns).values({
		id: runId,
		serverInstanceId: item.serverInstanceId,
		mediaItemId: item.id,
		tmdbId: item.tmdbId,
		mediaType: item.mediaType,
		status: 'running',
		startedAt
	});
	await db
		.update(mediaItems)
		.set({ discoveryStatus: 'running', discoveryStartedAt: startedAt, updatedAt: startedAt })
		.where(and(eq(mediaItems.serverInstanceId, item.serverInstanceId), eq(mediaItems.id, item.id)));

	const weights = await getScoreWeights();
	let attempted = 0;
	let succeeded = 0;
	let failures = 0;

	await Promise.all(
		providers.map(async (provider) => {
			const availability = providerAvailability(provider.id, config);
			const providerStarted = new Date();
			const scope = and(
				eq(posterCandidates.serverInstanceId, item.serverInstanceId),
				eq(posterCandidates.mediaItemId, item.id),
				eq(posterCandidates.provider, provider.id)
			);
			if (availability !== 'available') {
				await serializeWrite(async () => {
					await db.update(posterCandidates).set({ active: false, stale: true }).where(scope);
					await db.insert(providerDiscoveryOutcomes).values({
						runId,
						serverInstanceId: item.serverInstanceId,
						mediaItemId: item.id,
						provider: provider.id,
						status: availability,
						candidateCount: 0,
						startedAt: providerStarted,
						completedAt: new Date()
					});
				});
				return;
			}

			attempted += 1;
			try {
				const sets = await provider.discover(item, config, { forceRefresh: opts?.forceRefresh });
				const candidates = sets.flatMap((set) =>
					set.candidates.map((candidate) => {
						const width = candidate.width ?? null;
						const height = candidate.height ?? null;
						return {
							serverInstanceId: item.serverInstanceId,
							mediaItemId: item.id,
							discoveryRunId: runId,
							provider: provider.id,
							setId: candidate.setId,
							setAuthor: candidate.setAuthor,
							url: candidate.url,
							kind: candidate.kind,
							season: candidate.season,
							episode: candidate.episode,
							resolvedTmdbId: item.tmdbId,
							resolvedMediaType: item.mediaType,
							width,
							height,
							score: scorePoster(
								{ provider: provider.id, width, height, kind: candidate.kind },
								weights
							),
							active: true,
							stale: false,
							lastSeenAt: new Date()
						};
					})
				);
				await serializeWrite(() =>
					db.transaction(async (tx) => {
						const [outcome] = await tx
							.insert(providerDiscoveryOutcomes)
							.values({
								runId,
								serverInstanceId: item.serverInstanceId,
								mediaItemId: item.id,
								provider: provider.id,
								status: candidates.length ? 'succeeded' : 'empty',
								candidateCount: candidates.length,
								latencyMs: Date.now() - providerStarted.getTime(),
								lastSuccessAt: new Date(),
								startedAt: providerStarted,
								completedAt: new Date()
							})
							.returning({ id: providerDiscoveryOutcomes.id });
						await tx.delete(posterCandidates).where(scope);
						if (candidates.length) {
							await tx
								.insert(posterCandidates)
								.values(
									candidates.map((candidate) => ({ ...candidate, providerOutcomeId: outcome.id }))
								);
						}
					})
				);
				succeeded += 1;
			} catch (error) {
				failures += 1;
				const retained = await db
					.select({ id: posterCandidates.id })
					.from(posterCandidates)
					.where(and(scope, eq(posterCandidates.active, true)));
				const rawError = error instanceof Error ? error.message : String(error);
				const safeError = redact(rawError, config).slice(0, 500);
				const timedOut = /timed?\s*out|abort/i.test(rawError);
				await serializeWrite(async () => {
					await db.update(posterCandidates).set({ stale: true }).where(scope);
					await db.insert(providerDiscoveryOutcomes).values({
						runId,
						serverInstanceId: item.serverInstanceId,
						mediaItemId: item.id,
						provider: provider.id,
						status: timedOut ? 'timed_out' : 'failed',
						candidateCount: retained.length,
						retainedStaleCandidates: retained.length > 0,
						latencyMs: Date.now() - providerStarted.getTime(),
						errorCode: timedOut ? 'provider_timeout' : 'provider_failed',
						error: safeError,
						startedAt: providerStarted,
						completedAt: new Date()
					});
				});
				await logEvent('warn', 'provider', `${provider.id} discovery failed for "${item.title}"`, {
					provider: provider.id,
					title: item.title,
					serverInstanceId: item.serverInstanceId,
					mediaItemId: item.id,
					error: safeError,
					retained: retained.length
				});
			}
		})
	);

	const activeCandidates = await db
		.select({ provider: posterCandidates.provider })
		.from(posterCandidates)
		.where(
			and(
				eq(posterCandidates.serverInstanceId, item.serverInstanceId),
				eq(posterCandidates.mediaItemId, item.id),
				eq(posterCandidates.active, true)
			)
		);
	const runStatus = failures === 0 ? 'succeeded' : succeeded > 0 ? 'partial' : 'failed';
	const discoveryStatus =
		failures > 0
			? succeeded > 0
				? 'partial'
				: 'failed'
			: activeCandidates.length
				? 'succeeded'
				: 'empty';
	const completedAt = new Date();
	await db
		.update(providerDiscoveryRuns)
		.set({ status: runStatus, completedAt })
		.where(eq(providerDiscoveryRuns.id, runId));
	await db
		.update(mediaItems)
		.set({
			hasCandidates: activeCandidates.length > 0,
			hasMediux: activeCandidates.some((candidate) => candidate.provider === 'mediux'),
			discoveryStatus,
			discoveryCompletedAt: completedAt,
			updatedAt: completedAt
		})
		.where(and(eq(mediaItems.serverInstanceId, item.serverInstanceId), eq(mediaItems.id, item.id)));

	if (activeCandidates.length) {
		await logEvent(
			'info',
			'discover',
			`Found ${activeCandidates.length} covers for "${item.title}"`,
			{
				title: item.title,
				serverInstanceId: item.serverInstanceId,
				mediaItemId: item.id,
				count: activeCandidates.length,
				attempted
			}
		);
	}
	return activeCandidates.length;
}

/** Select poster, background, and every child slot with frozen, explainable provenance. */
export async function autoSelectArtwork(
	itemId: number,
	inputs: Omit<AutomaticSelectionInputs, 'weights'> & {
		weights?: AutomaticSelectionInputs['weights'];
	} = {}
): Promise<AutomaticArtworkSelection> {
	const [rows, weights] = await Promise.all([
		db
			.select()
			.from(posterCandidates)
			.where(and(eq(posterCandidates.mediaItemId, itemId), eq(posterCandidates.active, true))),
		inputs.weights ? Promise.resolve(inputs.weights) : getScoreWeights()
	]);
	return selectAutomaticArtwork(rows, { ...inputs, weights });
}

async function requireItemServerInstanceId(itemId: number): Promise<string> {
	const [item] = await db
		.select({ serverInstanceId: mediaItems.serverInstanceId })
		.from(mediaItems)
		.where(eq(mediaItems.id, itemId))
		.limit(1);
	if (!item) throw new Error(`Media item ${itemId} was not found`);
	return item.serverInstanceId;
}

export interface ArtworkSelectionPatch {
	posterUrl?: string | null;
	backgroundUrl?: string | null;
	posterCandidateId?: number | null;
	backgroundCandidateId?: number | null;
}

/** Record only the supplied pending slots, preserving every omitted selection. */
export async function selectCandidate(
	itemId: number,
	selection: ArtworkSelectionPatch
): Promise<void> {
	const patch: Partial<typeof mediaItems.$inferInsert> = {
		selectionUpdatedAt: new Date(),
		updatedAt: new Date()
	};
	if (Object.hasOwn(selection, 'posterUrl')) patch.selectedPosterUrl = selection.posterUrl ?? null;
	if (Object.hasOwn(selection, 'backgroundUrl')) {
		patch.selectedBackgroundUrl = selection.backgroundUrl ?? null;
	}
	if (Object.hasOwn(selection, 'posterCandidateId')) {
		patch.selectedPosterCandidateId = selection.posterCandidateId ?? null;
	}
	if (Object.hasOwn(selection, 'backgroundCandidateId')) {
		patch.selectedBackgroundCandidateId = selection.backgroundCandidateId ?? null;
	}
	await db.update(mediaItems).set(patch).where(eq(mediaItems.id, itemId));
}

/**
 * Upsert or clear a single season/episode artwork slot. A null `url` clears the
 * slot. Season slots pass `episode: null`; episode (title-card) slots pass the
 * episode number. Uniqueness is per-slot, so we delete any existing row for the
 * slot before inserting (libsql has no portable partial-index upsert target).
 */
export async function selectChild(
	itemId: number,
	slot: { kind: 'poster' | 'background' | 'title_card'; season: number; episode: number | null },
	url: string | null
): Promise<void> {
	const serverInstanceId = await requireItemServerInstanceId(itemId);
	const changedAt = new Date();
	const { kind, season, episode } = slot;
	const episodeMatch =
		episode === null ? isNull(childSelections.episode) : eq(childSelections.episode, episode);
	await db
		.delete(childSelections)
		.where(
			and(
				eq(childSelections.serverInstanceId, serverInstanceId),
				eq(childSelections.mediaItemId, itemId),
				eq(childSelections.kind, kind),
				eq(childSelections.season, season),
				episodeMatch
			)
		);
	if (url) {
		await db.insert(childSelections).values({
			serverInstanceId,
			mediaItemId: itemId,
			kind,
			season,
			episode,
			url,
			updatedAt: changedAt
		});
	}
	await db
		.update(mediaItems)
		.set({ selectionUpdatedAt: changedAt, updatedAt: changedAt })
		.where(and(eq(mediaItems.id, itemId), eq(mediaItems.serverInstanceId, serverInstanceId)));
}

/**
 * Stage many child slots in one call (used by "use this set"). Runs every per-slot
 * delete+insert inside a single transaction so the bulk stage commits once and is
 * atomic, rather than issuing two statements per slot across separate commits.
 */
export async function selectChildrenBulk(
	itemId: number,
	slots: {
		kind: 'poster' | 'background' | 'title_card';
		season: number;
		episode: number | null;
		url: string;
	}[]
): Promise<void> {
	if (!slots.length) return;
	const serverInstanceId = await requireItemServerInstanceId(itemId);
	await db.transaction(async (tx) => {
		const changedAt = new Date();
		for (const s of slots) {
			const episodeMatch =
				s.episode === null
					? isNull(childSelections.episode)
					: eq(childSelections.episode, s.episode);
			await tx
				.delete(childSelections)
				.where(
					and(
						eq(childSelections.serverInstanceId, serverInstanceId),
						eq(childSelections.mediaItemId, itemId),
						eq(childSelections.kind, s.kind),
						eq(childSelections.season, s.season),
						episodeMatch
					)
				);
			await tx.insert(childSelections).values({
				serverInstanceId,
				mediaItemId: itemId,
				kind: s.kind,
				season: s.season,
				episode: s.episode,
				url: s.url,
				updatedAt: changedAt
			});
		}
		await tx
			.update(mediaItems)
			.set({ selectionUpdatedAt: changedAt, updatedAt: changedAt })
			.where(and(eq(mediaItems.id, itemId), eq(mediaItems.serverInstanceId, serverInstanceId)));
	});
}
