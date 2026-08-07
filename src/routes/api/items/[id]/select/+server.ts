import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { selectCandidate, selectChild, selectChildrenBulk } from '$lib/server/posters/service';
import { ArtworkSelectionStoreError } from '$lib/server/posters/selection-store';
import { getMediaItem } from '$lib/server/queries';
import { getActiveServerInstance } from '$lib/server/server-instances';

type ChildKind = 'poster' | 'background' | 'title_card';
interface ChildSlotInput {
	kind: ChildKind;
	season: number;
	episode?: number | null;
	url?: string | null;
	candidateId?: number | null;
}

interface SelectBody {
	posterUrl?: string | null;
	backgroundUrl?: string | null;
	posterCandidateId?: number | null;
	backgroundCandidateId?: number | null;
	/** When present, stage a single season/episode slot instead of the show-level cover. */
	child?: ChildSlotInput;
	/** When present, stage many season/episode slots at once (used by "use this set"). */
	children?: ChildSlotInput[];
}

const CHILD_KINDS: ChildKind[] = ['poster', 'background', 'title_card'];

function validSlot(s: ChildSlotInput): boolean {
	if (!s || !CHILD_KINDS.includes(s.kind) || !Number.isSafeInteger(s.season) || s.season < 0) {
		return false;
	}
	// Title cards are per-episode; season-level slots must not carry an episode.
	if (s.kind === 'title_card') {
		return Number.isSafeInteger(s.episode) && (s.episode ?? -1) >= 0;
	}
	return s.episode === null || s.episode === undefined;
}

function hasSelectionFields(value: { url?: unknown; candidateId?: unknown }): boolean {
	return Object.hasOwn(value, 'url') && Object.hasOwn(value, 'candidateId');
}

function rethrowSelectionError(reason: unknown): never {
	if (reason instanceof ArtworkSelectionStoreError) {
		throw error(reason.code === 'media_item_not_found' ? 404 : 400, reason.code);
	}
	throw reason;
}

export const POST: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	if (!Number.isSafeInteger(id) || id <= 0) throw error(400, 'invalid id');
	const active = await getActiveServerInstance();
	if (!active || !(await getMediaItem(id, active.id))) throw error(404, 'item not found');
	const parsed = await request.json().catch(() => ({}));
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw error(400, 'invalid selection body');
	}
	const body = parsed as SelectBody;

	if (Object.hasOwn(body, 'children')) {
		if (
			!Array.isArray(body.children) ||
			body.children.length === 0 ||
			body.children.some((slot) => !validSlot(slot) || !hasSelectionFields(slot))
		) {
			throw error(400, 'invalid child selections');
		}
		await selectChildrenBulk(
			active.id,
			id,
			body.children.map((slot) => ({
				kind: slot.kind,
				season: slot.season,
				episode: slot.episode ?? null,
				url: slot.url as string | null,
				candidateId: slot.candidateId as number | null
			}))
		).catch(rethrowSelectionError);
		return json({ ok: true });
	}

	if (body.child) {
		if (!validSlot(body.child) || !hasSelectionFields(body.child)) {
			throw error(400, 'invalid child slot');
		}
		const { kind, season, episode, url, candidateId } = body.child;
		await selectChild(active.id, id, {
			kind,
			season,
			episode: episode ?? null,
			url: url as string | null,
			candidateId: candidateId as number | null
		}).catch(rethrowSelectionError);
		return json({ ok: true });
	}

	const hasPosterUrl = Object.hasOwn(body, 'posterUrl');
	const hasPosterCandidate = Object.hasOwn(body, 'posterCandidateId');
	const hasBackgroundUrl = Object.hasOwn(body, 'backgroundUrl');
	const hasBackgroundCandidate = Object.hasOwn(body, 'backgroundCandidateId');
	if (hasPosterUrl !== hasPosterCandidate || hasBackgroundUrl !== hasBackgroundCandidate) {
		throw error(400, 'selection URL and candidate id must be supplied together');
	}
	const selection = {
		...(hasPosterUrl
			? {
					poster: {
						url: body.posterUrl as string | null,
						candidateId: body.posterCandidateId as number | null
					}
				}
			: {}),
		...(hasBackgroundUrl
			? {
					background: {
						url: body.backgroundUrl as string | null,
						candidateId: body.backgroundCandidateId as number | null
					}
				}
			: {})
	};
	if (Object.keys(selection).length === 0) throw error(400, 'no selection fields');
	await selectCandidate(active.id, id, selection).catch(rethrowSelectionError);
	return json({ ok: true });
};
