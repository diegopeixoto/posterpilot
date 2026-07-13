/**
 * Catalog of Kometa per-library `operations` keys with friendly labels,
 * manual-derived descriptions, value types and (for enum ops) allowed values.
 * Pure data + guards.
 */

export type OperationType = 'bool' | 'text' | 'int' | 'enum' | 'list';

export interface Operation {
	readonly key: string;
	readonly label: string;
	readonly description: string;
	readonly type: OperationType;
	readonly group: 'assets' | 'mass_update' | 'ratings' | 'maintenance' | 'arr';
	readonly enumValues?: readonly string[];
}

export const OPERATIONS: readonly Operation[] = Object.freeze([
	Object.freeze({
		key: 'assets_for_all',
		label: 'Assets For All Items',
		description:
			'Searches the configured asset directories for images for every item in the library.',
		type: 'bool',
		group: 'assets'
	}),
	Object.freeze({
		key: 'assets_for_all_collections',
		label: 'Assets For All Collections',
		description:
			'Searches the asset directories for images for all unmanaged and/or unconfigured collections in the library.',
		type: 'bool',
		group: 'assets'
	}),
	Object.freeze({
		key: 'delete_collections',
		label: 'Delete Collections',
		description:
			'Deletes collections in the library matching the chosen criteria (managed, configured, item-count, and empty smart collections).',
		type: 'list',
		group: 'maintenance',
		enumValues: ['managed', 'configured', 'less', 'ignore_empty_smart_collections']
	}),
	Object.freeze({
		key: 'mass_genre_update',
		label: 'Mass Genre Update',
		description: "Replaces every item's genres with values pulled from the chosen source.",
		type: 'enum',
		group: 'mass_update',
		enumValues: [
			'tmdb',
			'tvdb',
			'imdb',
			'omdb',
			'anidb',
			'anidb_3_0',
			'anidb_2_5',
			'anidb_2_0',
			'anidb_1_5',
			'anidb_1_0',
			'anidb_0_5',
			'mal',
			'mal_all',
			'lock',
			'unlock',
			'remove',
			'reset'
		]
	}),
	Object.freeze({
		key: 'mass_content_rating_update',
		label: 'Mass Content Rating Update',
		description: "Replaces every item's content rating with values from the chosen source.",
		type: 'enum',
		group: 'ratings',
		enumValues: [
			'mdb',
			'mdb_commonsense',
			'mdb_commonsense0',
			'plex_csm',
			'plex_csm0',
			'mdb_age_rating',
			'mdb_age_rating0',
			'omdb',
			'mal',
			'lock',
			'unlock',
			'remove',
			'reset'
		]
	}),
	Object.freeze({
		key: 'mass_original_title_update',
		label: 'Mass Original Title Update',
		description: "Replaces every item's original title with values from the chosen source.",
		type: 'enum',
		group: 'mass_update',
		enumValues: [
			'anidb',
			'anidb_official',
			'mal',
			'mal_english',
			'mal_japanese',
			'lock',
			'unlock',
			'remove',
			'reset'
		]
	}),
	Object.freeze({
		key: 'mass_studio_update',
		label: 'Mass Studio Update',
		description: "Replaces every item's studio with values from the chosen source.",
		type: 'enum',
		group: 'mass_update',
		enumValues: ['anidb', 'mal', 'tmdb', 'lock', 'unlock', 'remove', 'reset']
	}),
	Object.freeze({
		key: 'mass_originally_available_update',
		label: 'Mass Originally Available Date Update',
		description:
			"Replaces every item's originally-available (release) date with values from the chosen source.",
		type: 'enum',
		group: 'mass_update',
		enumValues: [
			'tmdb',
			'tmdb_premiere',
			'tmdb_theatrical',
			'tmdb_theatricallimited',
			'tmdb_digital',
			'tmdb_physical',
			'tmdb_tv',
			'tvdb',
			'omdb',
			'mdb',
			'mdb_digital',
			'anidb',
			'mal',
			'lock',
			'unlock',
			'remove',
			'reset'
		]
	}),
	Object.freeze({
		key: 'mass_added_at_update',
		label: 'Mass Added-At Date Update',
		description:
			"Replaces every item's 'added at' date with values from the chosen source or a fixed date.",
		type: 'enum',
		group: 'mass_update',
		enumValues: ['tmdb', 'tvdb', 'omdb', 'mdb', 'anidb', 'mal', 'lock', 'unlock', 'remove', 'reset']
	}),
	Object.freeze({
		key: 'mass_audience_rating_update',
		label: 'Mass Audience Rating Update',
		description: "Replaces every item's audience rating with values from the chosen source.",
		type: 'enum',
		group: 'ratings',
		enumValues: [
			'tmdb',
			'imdb',
			'mal',
			'anidb_average',
			'anidb_rating',
			'anidb_score',
			'trakt',
			'trakt_user',
			'omdb',
			'omdb_metascore',
			'omdb_tomatoes',
			'mdb',
			'mdb_average',
			'mdb_imdb',
			'mdb_letterboxd',
			'mdb_metacritic',
			'mdb_metacriticuser',
			'mdb_myanimelist',
			'mdb_tmdb',
			'mdb_tomatoes',
			'mdb_tomatoesaudience',
			'mdb_trakt',
			'plex_imdb',
			'plex_tmdb',
			'plex_tomatoes',
			'plex_tomatoesaudience',
			'lock',
			'unlock',
			'remove',
			'reset'
		]
	}),
	Object.freeze({
		key: 'mass_critic_rating_update',
		label: 'Mass Critic Rating Update',
		description: "Replaces every item's critic rating with values from the chosen source.",
		type: 'enum',
		group: 'ratings',
		enumValues: [
			'tmdb',
			'imdb',
			'mal',
			'anidb_average',
			'anidb_rating',
			'anidb_score',
			'trakt',
			'trakt_user',
			'omdb',
			'omdb_metascore',
			'omdb_tomatoes',
			'mdb',
			'mdb_average',
			'mdb_imdb',
			'mdb_letterboxd',
			'mdb_metacritic',
			'mdb_metacriticuser',
			'mdb_myanimelist',
			'mdb_tmdb',
			'mdb_tomatoes',
			'mdb_tomatoesaudience',
			'mdb_trakt',
			'plex_imdb',
			'plex_tmdb',
			'plex_tomatoes',
			'plex_tomatoesaudience',
			'lock',
			'unlock',
			'remove',
			'reset'
		]
	}),
	Object.freeze({
		key: 'mass_user_rating_update',
		label: 'Mass User Rating Update',
		description: "Replaces every item's user rating with values from the chosen source.",
		type: 'enum',
		group: 'ratings',
		enumValues: [
			'tmdb',
			'imdb',
			'mal',
			'anidb_average',
			'anidb_rating',
			'anidb_score',
			'trakt',
			'trakt_user',
			'omdb',
			'omdb_metascore',
			'omdb_tomatoes',
			'mdb',
			'mdb_average',
			'mdb_imdb',
			'mdb_letterboxd',
			'mdb_metacritic',
			'mdb_metacriticuser',
			'mdb_myanimelist',
			'mdb_tmdb',
			'mdb_tomatoes',
			'mdb_tomatoesaudience',
			'mdb_trakt',
			'plex_imdb',
			'plex_tmdb',
			'plex_tomatoes',
			'plex_tomatoesaudience',
			'lock',
			'unlock',
			'remove',
			'reset'
		]
	}),
	Object.freeze({
		key: 'mass_episode_audience_rating_update',
		label: 'Mass Episode Audience Rating Update',
		description: "Replaces every episode's audience rating with values from the chosen source.",
		type: 'enum',
		group: 'ratings',
		enumValues: [
			'imdb',
			'tmdb',
			'trakt',
			'plex_imdb',
			'plex_tmdb',
			'lock',
			'unlock',
			'remove',
			'reset'
		]
	}),
	Object.freeze({
		key: 'mass_episode_critic_rating_update',
		label: 'Mass Episode Critic Rating Update',
		description: "Replaces every episode's critic rating with values from the chosen source.",
		type: 'enum',
		group: 'ratings',
		enumValues: [
			'imdb',
			'tmdb',
			'trakt',
			'plex_imdb',
			'plex_tmdb',
			'lock',
			'unlock',
			'remove',
			'reset'
		]
	}),
	Object.freeze({
		key: 'mass_episode_user_rating_update',
		label: 'Mass Episode User Rating Update',
		description: "Replaces every episode's user rating with values from the chosen source.",
		type: 'enum',
		group: 'ratings',
		enumValues: [
			'imdb',
			'tmdb',
			'trakt',
			'plex_imdb',
			'plex_tmdb',
			'lock',
			'unlock',
			'remove',
			'reset'
		]
	}),
	Object.freeze({
		key: 'mass_poster_update',
		label: 'Mass Poster Update',
		description:
			"Updates every item's poster from the chosen source (configurable as a source value or object).",
		type: 'enum',
		group: 'mass_update',
		enumValues: ['tmdb', 'plex', 'lock', 'unlock']
	}),
	Object.freeze({
		key: 'mass_background_update',
		label: 'Mass Background Update',
		description:
			"Updates every item's background/art from the chosen source (configurable as a source value or object).",
		type: 'enum',
		group: 'mass_update',
		enumValues: ['tmdb', 'plex', 'lock', 'unlock']
	}),
	Object.freeze({
		key: 'mass_imdb_parental_labels',
		label: 'Mass IMDb Parental Labels',
		description:
			'Adds IMDb Parental Guide labels to every item at or above the chosen severity threshold.',
		type: 'enum',
		group: 'mass_update',
		enumValues: ['none', 'mild', 'moderate', 'severe']
	}),
	Object.freeze({
		key: 'mass_collection_mode',
		label: 'Mass Collection Mode',
		description: 'Sets the collection display mode for every collection in the library.',
		type: 'enum',
		group: 'mass_update',
		enumValues: ['default', 'hide', 'hide_items', 'show_items']
	}),
	Object.freeze({
		key: 'update_blank_track_titles',
		label: 'Update Blank Track Titles',
		description: "For music libraries, replaces any blank track title with the track's sort title.",
		type: 'bool',
		group: 'maintenance'
	}),
	Object.freeze({
		key: 'remove_title_parentheses',
		label: 'Remove Title Parentheses',
		description: 'Removes trailing parentheses from each unlocked item title.',
		type: 'bool',
		group: 'maintenance'
	}),
	Object.freeze({
		key: 'ignore_labels',
		label: 'Ignore Labels',
		description: 'Skips items from library operations when they carry any of the given labels.',
		type: 'list',
		group: 'maintenance'
	}),
	Object.freeze({
		key: 'respect_ignore_ids',
		label: 'Respect Ignore IDs',
		description: 'Skips items from library operations when their IDs are in the ignore list.',
		type: 'bool',
		group: 'maintenance'
	}),
	Object.freeze({
		key: 'split_duplicates',
		label: 'Split Duplicates',
		description: 'Splits all duplicate (merged) items found in the library.',
		type: 'bool',
		group: 'maintenance'
	}),
	Object.freeze({
		key: 'radarr_add_all',
		label: 'Radarr Add All',
		description: 'Adds every item in the library to Radarr.',
		type: 'bool',
		group: 'arr'
	}),
	Object.freeze({
		key: 'radarr_remove_by_tag',
		label: 'Radarr Remove By Tag',
		description: 'Removes every item from Radarr that has any of the given tags.',
		type: 'list',
		group: 'arr'
	}),
	Object.freeze({
		key: 'sonarr_add_all',
		label: 'Sonarr Add All',
		description: 'Adds every item in the library to Sonarr.',
		type: 'bool',
		group: 'arr'
	}),
	Object.freeze({
		key: 'sonarr_remove_by_tag',
		label: 'Sonarr Remove By Tag',
		description: 'Removes every item from Sonarr that has any of the given tags.',
		type: 'list',
		group: 'arr'
	}),
	Object.freeze({
		key: 'genre_mapper',
		label: 'Genre Mapper',
		description:
			'Maps existing genres to new names or null to consolidate or remove specific genres.',
		type: 'list',
		group: 'maintenance'
	}),
	Object.freeze({
		key: 'content_rating_mapper',
		label: 'Content Rating Mapper',
		description:
			'Maps existing content ratings to new values or null to consolidate or remove specific ratings.',
		type: 'list',
		group: 'ratings'
	}),
	Object.freeze({
		key: 'metadata_backup',
		label: 'Metadata Backup',
		description:
			"Creates and maintains a Kometa metadata file mapping each item's locked attributes for backup.",
		type: 'list',
		group: 'maintenance'
	}),
	Object.freeze({
		key: 'plex_bulk_edit_batch_size',
		label: 'Plex Bulk Edit Batch Size',
		description:
			'Processes library operations in chunks of this many items per Plex bulk edit request.',
		type: 'int',
		group: 'maintenance'
	})
]);

const BY_KEY = new Map(OPERATIONS.map((o) => [o.key, o]));

/** Resolve an operation definition by key. */
export function operationByKey(key: string): Operation | undefined {
	return BY_KEY.get(key);
}

/** True when `key` is a recognized Kometa operation. */
export function isKnownOperation(key: string): boolean {
	return BY_KEY.has(key);
}
