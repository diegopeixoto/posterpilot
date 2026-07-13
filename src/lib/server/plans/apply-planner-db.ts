import { and, desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	artworkSlotStates,
	childSelections,
	mediaItems,
	posterCandidates,
	providerDiscoveryRuns
} from '$lib/server/db/schema';
import { resolveConfig } from '$lib/server/config';
import { autoSelectArtwork } from '$lib/server/posters/service';
import { getProviderPriority, getScoreWeights } from '$lib/server/posters/score-weights';
import { operationPlanStore } from './operation-plan-store';
import {
	createApplyPlanner,
	type ApplyItemRef,
	type ApplyPlannerDefaults,
	type ApplyPlannerDependencies,
	type ApplyPlannerItemData,
	type PlannerCandidateSnapshot,
	type PlannerCurrentSlotState,
	type PlannerStoredSelection,
	type ResolveApplyDestinationsInput
} from './apply-planner';
import type { ApplySlot, DestinationSlotSnapshot } from './apply-plan';

function iso(date: Date | null): string | null {
	return date ? date.toISOString() : null;
}

function candidateSlot(candidate: {
	kind: 'poster' | 'background' | 'season' | 'title_card';
	season: number | null;
	episode: number | null;
}): ApplySlot | null {
	if (candidate.kind === 'title_card') {
		return candidate.season !== null && candidate.episode !== null
			? { kind: 'title_card', season: candidate.season, episode: candidate.episode }
			: null;
	}
	if (candidate.episode !== null) return null;
	if (candidate.kind === 'season') {
		return candidate.season === null
			? null
			: { kind: 'poster', season: candidate.season, episode: null };
	}
	return { kind: candidate.kind, season: candidate.season, episode: null };
}

function slotKey(slot: ApplySlot): string {
	return `${slot.kind}:${slot.season ?? 'root'}:${slot.episode ?? 'root'}`;
}

function findCandidate(
	candidates: PlannerCandidateSnapshot[],
	candidateId: number | null,
	url: string,
	slot: ApplySlot
): PlannerCandidateSnapshot | null {
	if (candidateId !== null) {
		const byId = candidates.find(
			(candidate) =>
				candidate.candidateId === candidateId &&
				candidate.url === url &&
				slotKey(candidate.slot) === slotKey(slot)
		);
		if (byId) return byId;
	}
	return (
		candidates.find(
			(candidate) => candidate.url === url && slotKey(candidate.slot) === slotKey(slot)
		) ?? null
	);
}

function storedSelection(
	candidates: PlannerCandidateSnapshot[],
	input: {
		slot: ApplySlot;
		candidateId: number | null;
		url: string;
		provider: string | null;
		setId: string | null;
	}
): PlannerStoredSelection {
	const candidate = findCandidate(candidates, input.candidateId, input.url, input.slot);
	return {
		slot: input.slot,
		candidateId: candidate?.candidateId ?? null,
		url: input.url,
		provider: candidate?.provider ?? input.provider,
		setId: candidate?.setId ?? input.setId,
		setAuthor: candidate?.setAuthor ?? null
	};
}

/**
 * Load one internally consistent database snapshot for planning. This performs no
 * discovery or staging writes; it only freezes the facts already persisted.
 */
export async function loadDatabaseApplyPlannerItemData(
	ref: ApplyItemRef
): Promise<ApplyPlannerItemData | null> {
	return db.transaction(async (tx) => {
		const [item] = await tx
			.select()
			.from(mediaItems)
			.where(
				and(
					eq(mediaItems.id, ref.mediaItemId),
					eq(mediaItems.serverInstanceId, ref.serverInstanceId)
				)
			)
			.limit(1);
		if (!item) return null;

		const candidateRows = await tx
			.select()
			.from(posterCandidates)
			.where(
				and(
					eq(posterCandidates.mediaItemId, item.id),
					eq(posterCandidates.serverInstanceId, item.serverInstanceId)
				)
			);
		const childRows = await tx
			.select()
			.from(childSelections)
			.where(
				and(
					eq(childSelections.mediaItemId, item.id),
					eq(childSelections.serverInstanceId, item.serverInstanceId)
				)
			);
		const stateRows = await tx
			.select()
			.from(artworkSlotStates)
			.where(
				and(
					eq(artworkSlotStates.mediaItemId, item.id),
					eq(artworkSlotStates.serverInstanceId, item.serverInstanceId)
				)
			);
		const [latestRun] = await tx
			.select()
			.from(providerDiscoveryRuns)
			.where(
				and(
					eq(providerDiscoveryRuns.mediaItemId, item.id),
					eq(providerDiscoveryRuns.serverInstanceId, item.serverInstanceId)
				)
			)
			.orderBy(desc(providerDiscoveryRuns.startedAt))
			.limit(1);

		const candidates: PlannerCandidateSnapshot[] = candidateRows.flatMap((candidate) => {
			const slot = candidateSlot(candidate);
			if (!slot) return [];
			return [
				{
					candidateId: candidate.id,
					serverInstanceId: candidate.serverInstanceId,
					mediaItemId: candidate.mediaItemId,
					discoveryRunId: candidate.discoveryRunId,
					provider: candidate.provider,
					providerAssetId: candidate.providerAssetId,
					setId: candidate.setId,
					setAuthor: candidate.setAuthor,
					designFamily: candidate.designFamily,
					language: candidate.language,
					url: candidate.url,
					slot,
					resolvedTmdbId: candidate.resolvedTmdbId,
					resolvedMediaType: candidate.resolvedMediaType,
					width: candidate.width,
					height: candidate.height,
					score: candidate.score,
					active: candidate.active,
					stale: candidate.stale,
					lastSeenAt: iso(candidate.lastSeenAt)
				}
			];
		});

		const storedSelections: PlannerStoredSelection[] = [];
		if (item.selectedPosterUrl) {
			storedSelections.push(
				storedSelection(candidates, {
					slot: { kind: 'poster', season: null, episode: null },
					candidateId: item.selectedPosterCandidateId,
					url: item.selectedPosterUrl,
					provider: null,
					setId: null
				})
			);
		}
		if (item.selectedBackgroundUrl) {
			storedSelections.push(
				storedSelection(candidates, {
					slot: { kind: 'background', season: null, episode: null },
					candidateId: item.selectedBackgroundCandidateId,
					url: item.selectedBackgroundUrl,
					provider: null,
					setId: null
				})
			);
		}
		for (const child of childRows) {
			storedSelections.push(
				storedSelection(candidates, {
					slot: { kind: child.kind, season: child.season, episode: child.episode },
					candidateId: child.candidateId,
					url: child.url,
					provider: child.provider,
					setId: child.setId
				})
			);
		}

		const currentSlots: PlannerCurrentSlotState[] = stateRows.flatMap((state) => {
			const slot = candidateSlot({
				kind: state.kind,
				season: state.season,
				episode: state.episode
			});
			if (!slot) return [];
			return [
				{
					slot,
					url: state.currentUrl,
					fingerprint: state.currentFingerprint,
					artworkVersion: state.artworkVersion,
					observedAt: iso(state.lastObservedAt)
				}
			];
		});
		const currentKeys = new Set(currentSlots.map((state) => slotKey(state.slot)));
		if (!currentKeys.has('poster:root:root')) {
			currentSlots.push({
				slot: { kind: 'poster', season: null, episode: null },
				url: item.currentPosterUrl,
				fingerprint: item.currentPosterFingerprint,
				artworkVersion: item.artworkVersion,
				observedAt: iso(item.lastSyncedAt)
			});
		}
		if (!currentKeys.has('background:root:root')) {
			currentSlots.push({
				slot: { kind: 'background', season: null, episode: null },
				url: item.currentBackgroundUrl,
				fingerprint: item.currentBackgroundFingerprint,
				artworkVersion: item.artworkVersion,
				observedAt: iso(item.lastSyncedAt)
			});
		}

		return {
			item: {
				identity: {
					serverInstanceId: item.serverInstanceId,
					mediaItemId: item.id,
					librarySectionKey: item.sectionKey,
					sourceId: item.ratingKey,
					type: item.type,
					tmdbId: item.tmdbId,
					imdbId: item.imdbId,
					tvdbId: item.tvdbId,
					mediaType: item.mediaType,
					updatedAt: iso(item.updatedAt),
					selectionUpdatedAt: iso(item.selectionUpdatedAt)
				},
				ignored: item.ignored,
				sourceRemoved: item.sourceRemovedAt !== null,
				discovery: {
					status: item.discoveryStatus,
					runId: latestRun?.id ?? null,
					completedAt: iso(item.discoveryCompletedAt)
				},
				currentSlots
			},
			candidates,
			storedSelections
		};
	});
}

async function loadEffectiveDefaults(): Promise<ApplyPlannerDefaults> {
	const [config, scoreWeights, providerPriority] = await Promise.all([
		resolveConfig(),
		getScoreWeights(),
		getProviderPriority()
	]);
	return {
		defaultMethod: config.defaultApplyMethod,
		providerPriority,
		scoreWeights
	};
}

export interface DatabaseApplyPlannerOptions {
	/**
	 * Resolve concrete server child ids, capabilities, current target identities,
	 * and Kometa file/entry fingerprints. It must be read-only.
	 */
	resolveDestinationSlots(input: ResolveApplyDestinationsInput): Promise<DestinationSlotSnapshot[]>;
	loadDefaults?: () => Promise<ApplyPlannerDefaults>;
	clock?: () => Date;
}

/**
 * Runtime planner wired to the database, `autoSelectArtwork`, effective config,
 * and the expiring operation-plan store. It writes only the final plan row.
 */
export function createDatabaseApplyPlanner(options: DatabaseApplyPlannerOptions) {
	const dependencies: ApplyPlannerDependencies = {
		loadItemData: loadDatabaseApplyPlannerItemData,
		loadDefaults: options.loadDefaults ?? loadEffectiveDefaults,
		selectAutomatic: (ref, inputs) => autoSelectArtwork(ref.mediaItemId, inputs),
		resolveDestinationSlots: options.resolveDestinationSlots,
		persistPlan: (input) => operationPlanStore.create(input),
		clock: options.clock
	};
	return createApplyPlanner(dependencies);
}
