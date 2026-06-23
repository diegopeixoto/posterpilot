/**
 * Shared domain types across server modules (plex, tmdb, mediux, posters, jobs).
 * Keeping these in one place lets each module be built and tested independently.
 */

// --- Plex ---

export interface PlexSection {
	key: string;
	title: string;
	type: 'movie' | 'show';
}

export interface PlexGuids {
	tmdb?: string;
	imdb?: string;
	tvdb?: string;
}

export interface PlexItem {
	ratingKey: string;
	title: string;
	year: number | null;
	type: 'movie' | 'show';
	guids: PlexGuids;
	/** Absolute URL (including token) of the item's current poster, or null. */
	currentPosterUrl: string | null;
}

// --- TMDB ---

export type TmdbMediaType = 'movie' | 'tv';

export interface TmdbResolution {
	tmdbId: string;
	mediaType: TmdbMediaType;
}

// --- MediaUX ---

export type CandidateKind = 'poster' | 'background' | 'season' | 'title_card';

export interface MediuxCandidate {
	setId: string;
	/** Absolute asset URL, e.g. https://api.mediux.pro/assets/<file_id> */
	url: string;
	kind: CandidateKind;
	/** Season number for season posters / title cards; null otherwise. */
	season: number | null;
	/** Episode number for title cards; null otherwise. */
	episode: number | null;
}

export interface MediuxSet {
	setId: string;
	candidates: MediuxCandidate[];
}
