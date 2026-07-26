import type { ThePosterDbSetPoster } from '$lib/server/posters/providers/parse';

export interface CollectionMemberRef {
	mediaItemId: number;
	title: string;
	year: number | null;
}

export interface SetMemberMatch {
	mediaItemId: number;
	posterId: string;
	url: string;
}

export interface ThePosterDbCollectionSet {
	setId: string;
	/** Poster for the collection entity itself (type=collection), when the set has one. */
	collectionPosterUrl: string | null;
	/** One set poster mapped onto each matched collection member film. */
	matches: SetMemberMatch[];
}

/** Fold accents, drop punctuation, collapse spaces — so "Cash Out" == "cash out". */
export function normalizeTitle(value: string): string {
	return value
		.toLocaleLowerCase('en-US')
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

/** Significant tokens (length ≥ 2) of a normalized title, e.g. "cash out 2" → {cash,out}. */
function tokens(normalized: string): Set<string> {
	return new Set(normalized.split(' ').filter((t) => t.length >= 2));
}

/** True when every token of the smaller set is present in the larger — "high rollers" ⊆ "cash out high rollers". */
function tokenSubset(a: Set<string>, b: Set<string>): boolean {
	const [small, big] = a.size <= b.size ? [a, b] : [b, a];
	if (!small.size) return false;
	for (const t of small) if (!big.has(t)) return false;
	return true;
}

/**
 * Map a set's `movie` posters onto collection members. Jellyfin titles rarely equal
 * ThePosterDB's exactly ("Cash Out 2: High Rollers" vs "High Rollers"), so matching runs
 * in tiers, strongest first, each claiming a member at most once:
 *   1. exact normalized title (year to disambiguate same-title members),
 *   2. token subset (one title's words contained in the other) with year preference,
 *   3. equal release year — safe within a franchise where each film has a distinct year.
 * The collection-type poster (if any) is returned apart for the collection entity's own
 * artwork. Pure — no IO — so it is unit-tested directly.
 */
export function matchThePosterDbSetToMembers(
	posters: ThePosterDbSetPoster[],
	members: CollectionMemberRef[]
): Omit<ThePosterDbCollectionSet, 'setId'> {
	const collectionPoster = posters.find((p) => p.type === 'collection') ?? null;
	const moviePosters = posters.filter((p) => p.type === 'movie');
	const pool = members.map((m) => ({
		member: m,
		norm: normalizeTitle(m.title),
		tokens: tokens(normalizeTitle(m.title))
	}));

	const used = new Set<number>();
	const matches: SetMemberMatch[] = [];
	const claim = (poster: ThePosterDbSetPoster, member: CollectionMemberRef) => {
		used.add(member.mediaItemId);
		matches.push({ mediaItemId: member.mediaItemId, posterId: poster.posterId, url: poster.url });
	};
	const free = () => pool.filter((p) => !used.has(p.member.mediaItemId));
	const preferYear = (cands: typeof pool, year: number | null): (typeof pool)[number] | undefined =>
		(year !== null ? cands.find((c) => c.member.year === year) : undefined) ?? cands[0];

	// Tier 1: exact normalized title.
	const pending: ThePosterDbSetPoster[] = [];
	for (const poster of moviePosters) {
		const norm = normalizeTitle(poster.title);
		const pick = preferYear(
			free().filter((c) => c.norm === norm),
			poster.year
		);
		if (pick) claim(poster, pick.member);
		else pending.push(poster);
	}
	// Tier 2: token subset.
	const stillPending: ThePosterDbSetPoster[] = [];
	for (const poster of pending) {
		const ptok = tokens(normalizeTitle(poster.title));
		const pick = preferYear(
			free().filter((c) => tokenSubset(ptok, c.tokens)),
			poster.year
		);
		if (pick) claim(poster, pick.member);
		else stillPending.push(poster);
	}
	// Tier 3: equal year.
	for (const poster of stillPending) {
		if (poster.year === null) continue;
		const pick = free().find((c) => c.member.year === poster.year);
		if (pick) claim(poster, pick.member);
	}

	return { collectionPosterUrl: collectionPoster?.url ?? null, matches };
}
