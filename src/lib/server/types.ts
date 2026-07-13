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
	/** Provider-returned poster URL; callers must sanitize it before persistence. */
	currentPosterUrl: string | null;
	/** Provider-returned background URL; callers must sanitize it before persistence. */
	currentBackgroundUrl: string | null;
	/** Plex's own last-modified time for this item (from `updatedAt`), or null. */
	serverUpdatedAt: Date | null;
	/** When the item was added to the library (from `addedAt`), or null. */
	addedAt: Date | null;
	/** Played state: movie played at least once, show fully played. */
	watched: boolean;
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

/** TMDB's stable, source-qualified franchise identity for a movie. */
export interface TmdbCollectionRef {
	id: string;
	name: string;
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
	/** `belongs_to_collection` for movies; null for ungrouped movies and TV. */
	collection: TmdbCollectionRef | null;
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
	/** Image pixel dimensions when the provider reports them; used for scoring. */
	width?: number | null;
	height?: number | null;
}

export interface MediuxSet {
	setId: string;
	author: string | null;
	candidates: MediuxCandidate[];
}
