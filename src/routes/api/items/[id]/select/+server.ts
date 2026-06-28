import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { selectCandidate, selectChild, selectChildrenBulk } from '$lib/server/posters/service';

type ChildKind = 'poster' | 'background' | 'title_card';
interface ChildSlotInput {
	kind: ChildKind;
	season: number;
	episode?: number | null;
	url?: string | null;
}

interface SelectBody {
	posterUrl?: string | null;
	backgroundUrl?: string | null;
	/** When present, stage a single season/episode slot instead of the show-level cover. */
	child?: ChildSlotInput;
	/** When present, stage many season/episode slots at once (used by "use this set"). */
	children?: ChildSlotInput[];
	url?: string | null;
}

const CHILD_KINDS: ChildKind[] = ['poster', 'background', 'title_card'];

function validSlot(s: ChildSlotInput): boolean {
	if (!CHILD_KINDS.includes(s.kind) || !Number.isFinite(s.season)) return false;
	// Title cards are per-episode; season-level slots must not carry an episode.
	if (s.kind === 'title_card') return Number.isFinite(s.episode);
	return s.episode === null || s.episode === undefined;
}

export const POST: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	if (!Number.isFinite(id)) throw error(400, 'invalid id');
	const body = (await request.json().catch(() => ({}))) as SelectBody;

	if (body.children) {
		const slots = body.children.filter(validSlot).filter((s) => s.url);
		await selectChildrenBulk(
			id,
			slots.map((s) => ({
				kind: s.kind,
				season: s.season,
				episode: s.episode ?? null,
				url: s.url as string
			}))
		);
		return json({ ok: true });
	}

	if (body.child) {
		if (!validSlot(body.child)) throw error(400, 'invalid child slot');
		const { kind, season, episode } = body.child;
		await selectChild(id, { kind, season, episode: episode ?? null }, body.url ?? null);
		return json({ ok: true });
	}

	await selectCandidate(id, body.posterUrl ?? null, body.backgroundUrl ?? null);
	return json({ ok: true });
};
