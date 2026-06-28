/**
 * Pure regrouping of a candidate set's artwork into a show group plus one group
 * per season, for the item-detail UI. No framework/$env imports so it can be
 * unit-tested directly.
 *
 * Candidate kinds: `poster`/`background` are show-level; `season` is a season
 * poster (keyed by `season`); `title_card` is an episode title card (keyed by
 * `season` + `episode`). Season backgrounds are not produced by any provider, so
 * season groups carry only a poster and episode title cards.
 */

/** The minimal artwork shape these helpers need (a `PosterCandidate` satisfies it). */
export interface ArtworkLike {
	kind: 'poster' | 'background' | 'season' | 'title_card';
	season: number | null;
	episode: number | null;
}

export interface SeasonGroup<T> {
	season: number;
	/** Season poster candidates (kind `season`) for this season. */
	posters: T[];
	/** Episode title-card candidates (kind `title_card`) for this season. */
	titleCards: T[];
}

export interface SetGroups<T> {
	/** Show-level poster candidates. */
	posters: T[];
	/** Show-level background candidates. */
	backgrounds: T[];
	/** Per-season groups, ordered by season number ascending. */
	seasons: SeasonGroup<T>[];
}

/**
 * Split a set's candidates into show posters/backgrounds and per-season groups.
 * Season posters with no season number and title cards with no season/episode
 * number are dropped (they cannot map to an applyable slot).
 */
export function groupSetArtwork<T extends ArtworkLike>(candidates: T[]): SetGroups<T> {
	const posters: T[] = [];
	const backgrounds: T[] = [];
	const bySeason = new Map<number, SeasonGroup<T>>();
	const ensure = (n: number): SeasonGroup<T> => {
		let g = bySeason.get(n);
		if (!g) {
			g = { season: n, posters: [], titleCards: [] };
			bySeason.set(n, g);
		}
		return g;
	};

	for (const c of candidates) {
		if (c.kind === 'poster') posters.push(c);
		else if (c.kind === 'background') backgrounds.push(c);
		else if (c.kind === 'season' && c.season !== null) ensure(c.season).posters.push(c);
		else if (c.kind === 'title_card' && c.season !== null && c.episode !== null)
			ensure(c.season).titleCards.push(c);
	}

	const seasons = [...bySeason.values()].sort((a, b) => a.season - b.season);
	for (const g of seasons) {
		g.titleCards.sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0));
	}

	return { posters, backgrounds, seasons };
}
