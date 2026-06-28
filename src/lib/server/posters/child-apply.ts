/**
 * Pure mapping from staged season/episode artwork slots to concrete media-server
 * child apply operations, matched by number.
 *
 * No I/O or framework imports so it can be unit-tested without a network — the
 * service supplies the already-fetched season/episode children and applies the
 * resulting ops. A slot whose season (or episode) number has no matching child is
 * returned under `skipped` rather than silently dropped, so the apply result can
 * report it.
 */

import type { ServerChild } from '$lib/server/media-server/types';

/** Which media-server image field a slot writes to. */
export type ChildImageField = 'poster' | 'background';

/** A staged child artwork slot (season poster/background, or episode title card). */
export interface StagedChildSlot {
	kind: 'poster' | 'background' | 'title_card';
	season: number;
	/** Episode number for title cards; null for season-level slots. */
	episode: number | null;
	url: string;
}

/** A resolved apply: which child id to write, which field, and the source slot. */
export interface ResolvedChildOp {
	childId: string;
	field: ChildImageField;
	url: string;
	slot: StagedChildSlot;
}

/** A slot that could not be matched to a server child. */
export interface SkippedChildSlot {
	slot: StagedChildSlot;
	reason: 'season-not-found' | 'episode-not-found';
}

export interface ChildResolution {
	ops: ResolvedChildOp[];
	skipped: SkippedChildSlot[];
}

/** Season numbers that have at least one episode (title-card) slot staged. */
export function seasonsNeedingEpisodes(slots: StagedChildSlot[]): number[] {
	const set = new Set<number>();
	for (const s of slots) {
		if (s.kind === 'title_card') set.add(s.season);
	}
	return [...set];
}

/**
 * Resolve staged slots against fetched children, matching by season/episode
 * number. A season poster/background maps to its season child's poster/background
 * field; an episode title card maps to its episode child's poster (primary/thumb)
 * field.
 */
export function resolveChildOps(
	slots: StagedChildSlot[],
	seasons: ServerChild[],
	episodesBySeason: Record<number, ServerChild[]>
): ChildResolution {
	const seasonById = new Map<number, string>();
	for (const s of seasons) seasonById.set(s.number, s.id);

	const ops: ResolvedChildOp[] = [];
	const skipped: SkippedChildSlot[] = [];

	for (const slot of slots) {
		const seasonChildId = seasonById.get(slot.season);
		if (seasonChildId === undefined) {
			skipped.push({ slot, reason: 'season-not-found' });
			continue;
		}

		if (slot.kind === 'title_card') {
			const eps = episodesBySeason[slot.season] ?? [];
			const epChild = eps.find((e) => e.number === slot.episode);
			if (!epChild) {
				skipped.push({ slot, reason: 'episode-not-found' });
				continue;
			}
			ops.push({ childId: epChild.id, field: 'poster', url: slot.url, slot });
		} else {
			ops.push({
				childId: seasonChildId,
				field: slot.kind === 'background' ? 'background' : 'poster',
				url: slot.url,
				slot
			});
		}
	}

	return { ops, skipped };
}
