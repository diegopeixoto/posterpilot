/**
 * Pure extraction of MediaUX artwork candidates from a mediux.pro **listing page**
 * (`/movies/{tmdbId}` or `/shows/{tmdbId}`).
 *
 * mediux.pro is a Next.js app. Individual `/sets/{id}` pages now return 500 site-wide,
 * but the listing page embeds the item's full set/file data in its RSC payload
 * (`self.__next_f.push([...])` chunks). We decode that payload and read the file
 * records directly — one network request per item, no per-set fetches.
 *
 * A file looks like:
 *   {"set_id":{"id":"8472",...},"id":"<uuid>","filename_disk":"<uuid>.jpg",
 *    "title":"2 Fast 2 Furious (2003)","fileType":"poster", ...}
 * and the asset is served at https://api.mediux.pro/assets/<uuid>.
 *
 * A movie's page also includes its whole franchise: "matching sets" carry one file
 * per sibling title (e.g. "Fast & Furious 6 (2013)"). We therefore keep only files
 * whose title matches the *target* item, identified from the embedded
 * `"movie"|"show":{"id":"<tmdbId>","title"|"name":"…"}` object.
 */

import type { CandidateKind, MediuxCandidate, MediuxSet, TmdbMediaType } from '$lib/server/types';

const ASSET_BASE = 'https://api.mediux.pro/assets';

// A file record's own id + title + fileType (filename_disk anchors a real file).
const FILE_RE =
	/"id":"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})","filename_disk":"[^"]*","title":"((?:[^"\\]|\\.)*)","fileType":"([a-z_]+)"/g;

// Each file object starts with its owning set: "set_id":{"id":"8472",...
const SET_MARK_RE = /"set_id":\{"id":"(\d+)"/g;

// A set definition carries its uploader as user_created.username. The window between
// set_name and user_created is bounded and forbidden from crossing into the next set
// (another "set_name":) so an author is never mis-attributed to an authorless set.
const SET_AUTHOR_RE =
	/"id":"(\d+)","set_name":"(?:[^"\\]|\\.)*"(?:(?!"set_name":)[\s\S]){0,400}?"user_created":\{(?:(?!"set_name":)[\s\S]){0,200}?"username":"((?:[^"\\]|\\.)*)"/g;

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

function normalize(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

/**
 * Map each set id to its uploader username, best-effort. Sets without an
 * identifiable author are simply absent from the map (the UI shows no author).
 */
export function extractSetAuthors(rsc: string): Map<string, string> {
	const authors = new Map<string, string>();
	for (const m of rsc.matchAll(SET_AUTHOR_RE)) {
		const author = unescapeJsonString(m[2]).trim();
		if (author) authors.set(m[1], author);
	}
	return authors;
}

/** The target item's display title from the embedded movie/show object, or null. */
function extractTargetTitle(rsc: string, tmdbId: string): string | null {
	const re = new RegExp(
		`"(?:movie|show)":\\{"id":"${tmdbId}","(?:title|name)":"((?:[^"\\\\]|\\\\.)*)"`
	);
	const m = rsc.match(re);
	return m ? unescapeJsonString(m[1]) : null;
}

/**
 * Whether a file title belongs to the target item.
 * - Movie-style titles carry a year ("Title (YYYY)") → require an exact match of the
 *   title sans year, which keeps "2 Fast 2 Furious (2003)" but rejects franchise
 *   siblings like "Fast & Furious 6 (2013)".
 * - Year-less titles are TV files ("Show S01E03", "Show Season 2") → match by prefix.
 */
export function titleMatchesTarget(fileTitle: string, targetTitle: string | null): boolean {
	if (!targetTitle) return true; // couldn't identify the target → don't over-filter
	const target = normalize(targetTitle.replace(/\(\d{4}\)/g, ''));
	if (!target) return true;
	if (/\(\d{4}\)/.test(fileTitle)) {
		const sansYear = normalize(fileTitle.replace(/\(\d{4}\)/g, '').replace(/\s*-\s*ost\b/i, ''));
		return sansYear === target;
	}
	return normalize(fileTitle).startsWith(target);
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

/**
 * Extract the candidate sets for the target item from its listing-page HTML, grouped
 * by set (newest set first). For movies, files are filtered to the target title so a
 * collection/franchise page doesn't surface sibling-title artwork; show pages aren't
 * collection-contaminated, so all of the show's files are kept. Returns `[]` when
 * nothing parseable is found.
 */
export function parseListingSets(
	html: string,
	tmdbId: string,
	mediaType: TmdbMediaType
): MediuxSet[] {
	const rsc = decodeRscPayload(html);
	if (!rsc) return [];

	const targetTitle = mediaType === 'movie' ? extractTargetTitle(rsc, tmdbId) : null;
	const authors = extractSetAuthors(rsc);

	const setMarks = [...rsc.matchAll(SET_MARK_RE)].map((m) => ({ idx: m.index ?? 0, setId: m[1] }));
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
		const title = unescapeJsonString(m[2]);
		// Movie pages include franchise siblings; show pages do not.
		if (mediaType === 'movie' && !titleMatchesTarget(title, targetTitle)) continue;
		const mapped = classify(m[3], title);
		if (!mapped) continue;
		const setId = setIdBefore(m.index ?? 0);
		const candidate: MediuxCandidate = {
			setId,
			setAuthor: authors.get(setId) ?? null,
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
		.map((setId) => ({
			setId,
			author: authors.get(setId) ?? null,
			candidates: bySet.get(setId) ?? []
		}))
		.filter((set) => set.candidates.length > 0);
}
