/**
 * Catalog of Kometa "default" collection files — the `default:` values usable in a
 * library's `collection_files`. These are the category-style collection sets
 * (genre, studio, country, …) PosterPilot lets users toggle per library.
 *
 * Pure data + guards, so it can be unit-tested in isolation and imported by both
 * the config-merge engine and the settings UI. Names are verified against
 * https://kometa.wiki/en/latest/defaults/collections/.
 *
 * NOTE: there is no bare `content_rating` default — the real files are
 * region/service-suffixed (`content_rating_us`, `content_rating_uk`, …).
 */

/** Which Plex library kinds a default set sensibly applies to. */
export type DefaultApplicability = 'movie' | 'show' | 'both';

/** A single Kometa default collection set. */
export interface DefaultCollection {
	/** The `default:` value written into `collection_files`. */
	name: string;
	/** Library kinds this set is meaningful for (UI hint; not enforced). */
	applies: DefaultApplicability;
}

/** A named group of default sets, for grouped rendering in the UI. */
export interface DefaultGroup {
	/** Stable group id (also an i18n key suffix: `kometa_group_<id>`). */
	id: string;
	collections: DefaultCollection[];
}

export const DEFAULT_COLLECTION_GROUPS: readonly DefaultGroup[] = Object.freeze([
	{
		id: 'content',
		collections: [
			{ name: 'genre', applies: 'both' },
			{ name: 'franchise', applies: 'both' },
			{ name: 'universe', applies: 'both' },
			{ name: 'based', applies: 'both' },
			{ name: 'collectionless', applies: 'both' }
		]
	},
	{
		id: 'production',
		collections: [
			{ name: 'studio', applies: 'both' },
			{ name: 'network', applies: 'show' },
			{ name: 'streaming', applies: 'both' }
		]
	},
	{
		id: 'location',
		collections: [
			{ name: 'country', applies: 'both' },
			{ name: 'region', applies: 'both' },
			{ name: 'continent', applies: 'both' }
		]
	},
	{
		id: 'time',
		collections: [
			{ name: 'seasonal', applies: 'both' },
			{ name: 'year', applies: 'both' },
			{ name: 'decade', applies: 'both' }
		]
	},
	{
		id: 'media',
		collections: [
			{ name: 'resolution', applies: 'both' },
			{ name: 'aspect', applies: 'both' },
			{ name: 'audio_language', applies: 'both' },
			{ name: 'subtitle_language', applies: 'both' }
		]
	},
	{
		id: 'content_rating',
		collections: [
			{ name: 'content_rating_us', applies: 'both' },
			{ name: 'content_rating_uk', applies: 'both' },
			{ name: 'content_rating_de', applies: 'both' },
			{ name: 'content_rating_au', applies: 'both' },
			{ name: 'content_rating_nz', applies: 'both' },
			{ name: 'content_rating_mal', applies: 'both' },
			{ name: 'content_rating_cs', applies: 'both' }
		]
	},
	{
		id: 'people',
		collections: [
			{ name: 'actor', applies: 'both' },
			{ name: 'director', applies: 'movie' },
			{ name: 'producer', applies: 'movie' },
			{ name: 'writer', applies: 'movie' }
		]
	},
	{
		id: 'award',
		collections: [
			{ name: 'oscars', applies: 'movie' },
			{ name: 'cannes', applies: 'movie' },
			{ name: 'sundance', applies: 'movie' },
			{ name: 'golden', applies: 'both' },
			{ name: 'emmy', applies: 'show' },
			{ name: 'choice', applies: 'both' },
			{ name: 'spirit', applies: 'movie' },
			{ name: 'bafta', applies: 'movie' },
			{ name: 'sag', applies: 'both' }
		]
	},
	{
		id: 'chart',
		collections: [
			{ name: 'basic', applies: 'both' },
			{ name: 'imdb', applies: 'both' },
			{ name: 'tmdb', applies: 'both' },
			{ name: 'trakt', applies: 'both' },
			{ name: 'letterboxd', applies: 'movie' },
			{ name: 'tautulli', applies: 'both' },
			{ name: 'anilist', applies: 'both' },
			{ name: 'myanimelist', applies: 'both' }
		]
	}
]);

/** Flat list of every catalog entry. */
export const DEFAULT_COLLECTIONS: readonly DefaultCollection[] = Object.freeze(
	DEFAULT_COLLECTION_GROUPS.flatMap((g) => g.collections)
);

const KNOWN_NAMES: ReadonlySet<string> = new Set(DEFAULT_COLLECTIONS.map((c) => c.name));

/** True when `name` is a recognized Kometa default collection file in the catalog. */
export function isKnownDefault(name: string): boolean {
	return KNOWN_NAMES.has(name);
}

/** Filter a list of default names to only the recognized ones (order preserved). */
export function knownDefaults(names: readonly string[]): string[] {
	return names.filter((n) => KNOWN_NAMES.has(n));
}
