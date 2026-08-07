import { and, eq, isNull, sql } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type { SQLiteUpdateSetSource } from 'drizzle-orm/sqlite-core';
import * as schema from '$lib/server/db/schema';
import { childSelections, mediaItems, posterCandidates } from '$lib/server/db/schema';

type Database = LibSQLDatabase<typeof schema>;
type ReadExecutor = Pick<Database, 'select'>;

export interface ArtworkSlotSelection {
	url: string | null;
	candidateId: number | null;
}

export interface RootArtworkSelectionPatch {
	poster?: ArtworkSlotSelection;
	background?: ArtworkSlotSelection;
}

export interface ChildArtworkSlot {
	kind: 'poster' | 'background' | 'title_card';
	season: number;
	episode: number | null;
}

export interface ChildArtworkSelection extends ChildArtworkSlot, ArtworkSlotSelection {}

export type ArtworkSelectionStoreErrorCode =
	| 'invalid_artwork_selection'
	| 'media_item_not_found'
	| 'artwork_candidate_scope_mismatch';

export class ArtworkSelectionStoreError extends Error {
	constructor(readonly code: ArtworkSelectionStoreErrorCode) {
		super(code);
		this.name = 'ArtworkSelectionStoreError';
	}
}

type CandidateRow = {
	id: number;
	serverInstanceId: string;
	mediaItemId: number;
	provider: string;
	setId: string;
	url: string;
	kind: 'poster' | 'background' | 'season' | 'title_card';
	season: number | null;
	episode: number | null;
	active: boolean;
};

type ResolvedSelection = {
	url: string | null;
	candidateId: number | null;
	provider: string | null;
	setId: string | null;
};

function validServerInstanceId(value: string): string {
	if (typeof value !== 'string' || value.length === 0 || value.includes('\u0000')) {
		throw new ArtworkSelectionStoreError('invalid_artwork_selection');
	}
	return value;
}

function validItemId(value: number): number {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new ArtworkSelectionStoreError('invalid_artwork_selection');
	}
	return value;
}

function validSlot(slot: ChildArtworkSlot): ChildArtworkSlot {
	if (
		(slot.kind !== 'poster' && slot.kind !== 'background' && slot.kind !== 'title_card') ||
		!Number.isSafeInteger(slot.season) ||
		slot.season < 0
	) {
		throw new ArtworkSelectionStoreError('invalid_artwork_selection');
	}
	if (slot.kind === 'title_card') {
		if (!Number.isSafeInteger(slot.episode) || (slot.episode ?? -1) < 0) {
			throw new ArtworkSelectionStoreError('invalid_artwork_selection');
		}
	} else if (slot.episode !== null) {
		throw new ArtworkSelectionStoreError('invalid_artwork_selection');
	}
	return slot;
}

function validSelection(selection: ArtworkSlotSelection): ArtworkSlotSelection {
	if (!selection || !Object.hasOwn(selection, 'url') || !Object.hasOwn(selection, 'candidateId')) {
		throw new ArtworkSelectionStoreError('invalid_artwork_selection');
	}
	if (selection.url !== null && (typeof selection.url !== 'string' || selection.url.length === 0)) {
		throw new ArtworkSelectionStoreError('invalid_artwork_selection');
	}
	if (
		selection.candidateId !== null &&
		(!Number.isSafeInteger(selection.candidateId) || selection.candidateId <= 0)
	) {
		throw new ArtworkSelectionStoreError('invalid_artwork_selection');
	}
	if (selection.url === null && selection.candidateId !== null) {
		throw new ArtworkSelectionStoreError('invalid_artwork_selection');
	}
	return selection;
}

function candidateMatchesSlot(candidate: CandidateRow, slot: ChildArtworkSlot): boolean {
	if (candidate.season !== slot.season || candidate.episode !== slot.episode) return false;
	if (slot.kind === 'title_card') return candidate.kind === 'title_card';
	if (slot.kind === 'background') return candidate.kind === 'background';
	return candidate.kind === 'poster' || candidate.kind === 'season';
}

function rootCandidateMatchesSlot(candidate: CandidateRow, kind: 'poster' | 'background'): boolean {
	return candidate.kind === kind && candidate.season === null && candidate.episode === null;
}

export function createArtworkSelectionStore(
	database: Database,
	options: { clock?: () => Date } = {}
) {
	const clock = options.clock ?? (() => new Date());

	async function requireItem(
		executor: ReadExecutor,
		serverInstanceId: string,
		mediaItemId: number
	): Promise<void> {
		const [item] = await executor
			.select({ id: mediaItems.id })
			.from(mediaItems)
			.where(and(eq(mediaItems.id, mediaItemId), eq(mediaItems.serverInstanceId, serverInstanceId)))
			.limit(1);
		if (!item) throw new ArtworkSelectionStoreError('media_item_not_found');
	}

	async function candidateById(
		executor: ReadExecutor,
		candidateId: number
	): Promise<CandidateRow | null> {
		const [candidate] = await executor
			.select({
				id: posterCandidates.id,
				serverInstanceId: posterCandidates.serverInstanceId,
				mediaItemId: posterCandidates.mediaItemId,
				provider: posterCandidates.provider,
				setId: posterCandidates.setId,
				url: posterCandidates.url,
				kind: posterCandidates.kind,
				season: posterCandidates.season,
				episode: posterCandidates.episode,
				active: posterCandidates.active
			})
			.from(posterCandidates)
			.where(eq(posterCandidates.id, candidateId))
			.limit(1);
		return candidate ?? null;
	}

	async function resolveSelection(
		executor: ReadExecutor,
		serverInstanceId: string,
		mediaItemId: number,
		selectionInput: ArtworkSlotSelection,
		matchesSlot: (candidate: CandidateRow) => boolean
	): Promise<ResolvedSelection> {
		const selection = validSelection(selectionInput);
		if (selection.url === null) {
			return { url: null, candidateId: null, provider: null, setId: null };
		}
		if (selection.candidateId === null) {
			return {
				url: selection.url,
				candidateId: null,
				provider: 'custom',
				setId: null
			};
		}
		const candidate = await candidateById(executor, selection.candidateId);
		if (
			!candidate ||
			!candidate.active ||
			candidate.serverInstanceId !== serverInstanceId ||
			candidate.mediaItemId !== mediaItemId ||
			candidate.url !== selection.url ||
			!matchesSlot(candidate)
		) {
			throw new ArtworkSelectionStoreError('artwork_candidate_scope_mismatch');
		}
		return {
			url: candidate.url,
			candidateId: candidate.id,
			provider: candidate.provider,
			setId: candidate.setId
		};
	}

	async function stageRoot(
		serverInstanceIdInput: string,
		mediaItemIdInput: number,
		selection: RootArtworkSelectionPatch
	): Promise<void> {
		const serverInstanceId = validServerInstanceId(serverInstanceIdInput);
		const mediaItemId = validItemId(mediaItemIdInput);
		if (!selection || typeof selection !== 'object') {
			throw new ArtworkSelectionStoreError('invalid_artwork_selection');
		}
		const hasPoster = Object.hasOwn(selection, 'poster');
		const hasBackground = Object.hasOwn(selection, 'background');
		if (!hasPoster && !hasBackground) {
			throw new ArtworkSelectionStoreError('invalid_artwork_selection');
		}
		await database.transaction(async (tx) => {
			await requireItem(tx, serverInstanceId, mediaItemId);
			const poster = hasPoster
				? await resolveSelection(
						tx,
						serverInstanceId,
						mediaItemId,
						selection.poster as ArtworkSlotSelection,
						(candidate) => rootCandidateMatchesSlot(candidate, 'poster')
					)
				: null;
			const background = hasBackground
				? await resolveSelection(
						tx,
						serverInstanceId,
						mediaItemId,
						selection.background as ArtworkSlotSelection,
						(candidate) => rootCandidateMatchesSlot(candidate, 'background')
					)
				: null;
			const changedAt = clock();
			const patch: SQLiteUpdateSetSource<typeof mediaItems> = {
				selectionUpdatedAt: changedAt,
				selectionRevision: sql`${mediaItems.selectionRevision} + 1`,
				updatedAt: changedAt
			};
			if (poster) {
				patch.selectedPosterUrl = poster.url;
				patch.selectedPosterCandidateId = poster.candidateId;
				patch.selectedPosterProvider = poster.provider;
			}
			if (background) {
				patch.selectedBackgroundUrl = background.url;
				patch.selectedBackgroundCandidateId = background.candidateId;
				patch.selectedBackgroundProvider = background.provider;
			}
			await tx
				.update(mediaItems)
				.set(patch)
				.where(
					and(eq(mediaItems.id, mediaItemId), eq(mediaItems.serverInstanceId, serverInstanceId))
				);
		});
	}

	async function stageChild(
		serverInstanceIdInput: string,
		mediaItemIdInput: number,
		input: ChildArtworkSelection
	): Promise<void> {
		const serverInstanceId = validServerInstanceId(serverInstanceIdInput);
		const mediaItemId = validItemId(mediaItemIdInput);
		if (!input || typeof input !== 'object') {
			throw new ArtworkSelectionStoreError('invalid_artwork_selection');
		}
		const slot = validSlot({ kind: input.kind, season: input.season, episode: input.episode });
		await database.transaction(async (tx) => {
			await requireItem(tx, serverInstanceId, mediaItemId);
			const resolved = await resolveSelection(
				tx,
				serverInstanceId,
				mediaItemId,
				input,
				(candidate) => candidateMatchesSlot(candidate, slot)
			);
			const changedAt = clock();
			const episodeMatch =
				slot.episode === null
					? isNull(childSelections.episode)
					: eq(childSelections.episode, slot.episode);
			await tx
				.delete(childSelections)
				.where(
					and(
						eq(childSelections.serverInstanceId, serverInstanceId),
						eq(childSelections.mediaItemId, mediaItemId),
						eq(childSelections.kind, slot.kind),
						eq(childSelections.season, slot.season),
						episodeMatch
					)
				);
			if (resolved.url !== null) {
				await tx.insert(childSelections).values({
					serverInstanceId,
					mediaItemId,
					...slot,
					url: resolved.url,
					candidateId: resolved.candidateId,
					provider: resolved.provider,
					setId: resolved.setId,
					updatedAt: changedAt
				});
			}
			await tx
				.update(mediaItems)
				.set({
					selectionUpdatedAt: changedAt,
					selectionRevision: sql`${mediaItems.selectionRevision} + 1`,
					updatedAt: changedAt
				})
				.where(
					and(eq(mediaItems.id, mediaItemId), eq(mediaItems.serverInstanceId, serverInstanceId))
				);
		});
	}

	async function stageChildren(
		serverInstanceIdInput: string,
		mediaItemIdInput: number,
		inputs: ChildArtworkSelection[]
	): Promise<void> {
		const serverInstanceId = validServerInstanceId(serverInstanceIdInput);
		const mediaItemId = validItemId(mediaItemIdInput);
		if (!Array.isArray(inputs) || inputs.length === 0) {
			throw new ArtworkSelectionStoreError('invalid_artwork_selection');
		}
		const slots = inputs.map((input) => {
			if (!input || typeof input !== 'object') {
				throw new ArtworkSelectionStoreError('invalid_artwork_selection');
			}
			return {
				input,
				slot: validSlot({ kind: input.kind, season: input.season, episode: input.episode })
			};
		});
		const slotKeys = new Set<string>();
		for (const { slot } of slots) {
			const key = `${slot.kind}:${slot.season}:${slot.episode ?? ''}`;
			if (slotKeys.has(key)) {
				throw new ArtworkSelectionStoreError('invalid_artwork_selection');
			}
			slotKeys.add(key);
		}
		await database.transaction(async (tx) => {
			await requireItem(tx, serverInstanceId, mediaItemId);
			const resolved = [] as { slot: ChildArtworkSlot; selection: ResolvedSelection }[];
			for (const entry of slots) {
				resolved.push({
					slot: entry.slot,
					selection: await resolveSelection(
						tx,
						serverInstanceId,
						mediaItemId,
						entry.input,
						(candidate) => candidateMatchesSlot(candidate, entry.slot)
					)
				});
			}
			const changedAt = clock();
			for (const entry of resolved) {
				const episodeMatch =
					entry.slot.episode === null
						? isNull(childSelections.episode)
						: eq(childSelections.episode, entry.slot.episode);
				await tx
					.delete(childSelections)
					.where(
						and(
							eq(childSelections.serverInstanceId, serverInstanceId),
							eq(childSelections.mediaItemId, mediaItemId),
							eq(childSelections.kind, entry.slot.kind),
							eq(childSelections.season, entry.slot.season),
							episodeMatch
						)
					);
				if (entry.selection.url === null) continue;
				await tx.insert(childSelections).values({
					serverInstanceId,
					mediaItemId,
					...entry.slot,
					url: entry.selection.url,
					candidateId: entry.selection.candidateId,
					provider: entry.selection.provider,
					setId: entry.selection.setId,
					updatedAt: changedAt
				});
			}
			await tx
				.update(mediaItems)
				.set({
					selectionUpdatedAt: changedAt,
					selectionRevision: sql`${mediaItems.selectionRevision} + 1`,
					updatedAt: changedAt
				})
				.where(
					and(eq(mediaItems.id, mediaItemId), eq(mediaItems.serverInstanceId, serverInstanceId))
				);
		});
	}

	return { stageRoot, stageChild, stageChildren };
}

export type ArtworkSelectionStore = ReturnType<typeof createArtworkSelectionStore>;
