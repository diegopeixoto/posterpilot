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

/** A top-billed cast member, as shown on the item hero. */
export interface TmdbCastMember {
	name: string;
	character: string | null;
	profileUrl: string | null;
}

/**
 * Display metadata for an item, derived from the TMDB detail (+credits) response
 * and the images endpoint. All fields are optional — TMDB may omit any of them.
 */
export interface TmdbMetadata {
	overview: string | null;
	tagline: string | null;
	genres: string[];
	runtime: number | null;
	rating: number | null;
	backdropUrl: string | null;
	logoUrl: string | null;
	seasonCount: number | null;
	episodeCount: number | null;
	cast: TmdbCastMember[];
}

// --- MediaUX ---

export type CandidateKind = 'poster' | 'background' | 'season' | 'title_card';

export interface MediuxCandidate {
	setId: string;
	/** Uploader/author of the owning set, when present in the payload. */
	setAuthor: string | null;
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
	author: string | null;
	candidates: MediuxCandidate[];
}
