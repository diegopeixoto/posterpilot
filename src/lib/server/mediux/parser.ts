/**
 * Pure extraction of MediaUX artwork candidates from a mediux.pro **listing page**
 * (`/movies/{tmdbId}` or `/shows/{tmdbId}`).
 *
 * mediux.pro is a Next.js app. Individual `/sets/{id}` pages now return 500 site-wide,
 * but the listing page embeds the item's full set/file data in its RSC payload
 * (`self.__next_f.push([...])` chunks). We decode that payload and read the file
 * records directly — one network request per item, no per-set fetches.
 *
 * Each file looks like:
 *   {"set_id":{"id":"8472",...},"id":"<uuid>","filename_disk":"<uuid>.jpg",
 *    "title":"2 Fast 2 Furious (2003)","fileType":"poster", ...}
 * and the asset is served at https://api.mediux.pro/assets/<uuid>.
 */

import type { CandidateKind, MediuxCandidate, MediuxSet } from '$lib/server/types';

const ASSET_BASE = 'https://api.mediux.pro/assets';

// A file record's own id + title + fileType (filename_disk anchors a real file).
const FILE_RE =
	/"id":"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})","filename_disk":"[^"]*","title":"((?:[^"\\]|\\.)*)","fileType":"([a-z_]+)"/g;

// Each file object starts with its owning set: "set_id":{"id":"8472",...
const SET_MARK_RE = /"set_id":\{"id":"(\d+)"/g;

const PUSH_RE = /self\.__next_f\.push\(\[\d+,"((?:[^"\\]|\\.)*)"\]\)/g;

/** Decode and concatenate the Next.js RSC payload chunks embedded in a page. */
export function decodeRscPayload(html: string): string {
	let out = '';
	for (const m of html.matchAll(PUSH_RE)) {
		try {
			out += JSON.parse(`"${m[1]}"`);
		} catch {
			// A chunk that doesn't unescape cleanly is skipped, not fatal.
		}
	}
	return out;
}

function unescapeJsonString(escaped: string): string {
	try {
		return JSON.parse(`"${escaped}"`);
	} catch {
		return escaped;
	}
}

/** Map a mediux fileType + title to a candidate kind, or null to skip the file. */
function classify(
	fileType: string,
	title: string
): { kind: CandidateKind; season: number | null; episode: number | null } | null {
	if (fileType === 'backdrop') return { kind: 'background', season: null, episode: null };
	if (fileType === 'title_card') {
		const se = title.match(/S(\d+)\s*E(\d+)/i);
		return {
			kind: 'title_card',
			season: se ? Number(se[1]) : null,
			episode: se ? Number(se[2]) : null
		};
	}
	if (fileType === 'poster') {
		const season = title.match(/Season (\d+)/i);
		if (season) return { kind: 'season', season: Number(season[1]), episode: null };
		return { kind: 'poster', season: null, episode: null };
	}
	// misc, album_art, logo, etc. are not cover candidates.
	return null;
}

// Set headers look like "id":"8472","set_name":"2 Fast 2 Furious (2003) Set".
const SET_NAME_RE = /"id":"(\d+)","set_name":"((?:[^"\\]|\\.)*)"/g;

/**
 * Extract the candidate sets for the *target* item from its listing-page HTML.
 *
 * The page embeds the item's own user sets plus its whole collection — collection
 * sets (named "… Collection") hold artwork for sibling titles, so they are dropped.
 * The rest are grouped by set, newest set first. Returns `[]` when nothing
 * parseable is found.
 */
export function parseListingSets(html: string): MediuxSet[] {
	const rsc = decodeRscPayload(html);
	if (!rsc) return [];

	// set id -> set name, so we can drop collection sets (sibling-title artwork).
	const setNames = new Map<string, string>();
	for (const m of rsc.matchAll(SET_NAME_RE)) {
		setNames.set(m[1], unescapeJsonString(m[2]));
	}

	const setMarks = [...rsc.matchAll(SET_MARK_RE)].map((m) => ({
		idx: m.index ?? 0,
		setId: m[1]
	}));
	const setIdBefore = (idx: number): string => {
		let found = 'unknown';
		for (const mark of setMarks) {
			if (mark.idx <= idx) found = mark.setId;
			else break;
		}
		return found;
	};

	const bySet = new Map<string, MediuxCandidate[]>();
	const order: string[] = [];
	for (const m of rsc.matchAll(FILE_RE)) {
		const mapped = classify(m[3], unescapeJsonString(m[2]));
		if (!mapped) continue;
		const setId = setIdBefore(m.index ?? 0);
		if (/collection/i.test(setNames.get(setId) ?? '')) continue; // sibling-title artwork
		const candidate: MediuxCandidate = {
			setId,
			url: `${ASSET_BASE}/${m[1]}`,
			kind: mapped.kind,
			season: mapped.season,
			episode: mapped.episode
		};
		if (!bySet.has(setId)) {
			bySet.set(setId, []);
			order.push(setId);
		}
		bySet.get(setId)?.push(candidate);
	}

	// Sets appear oldest-first in the payload; present newest-first.
	return order
		.reverse()
		.map((setId) => ({ setId, candidates: bySet.get(setId) ?? [] }))
		.filter((set) => set.candidates.length > 0);
}
