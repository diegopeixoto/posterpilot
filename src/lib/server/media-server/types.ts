/**
 * The `MediaServer` provider abstraction.
 *
 * Captures everything the rest of the app needs from a media server (Plex,
 * Jellyfin, Emby) behind one interface so sync/discover/apply never speak a
 * provider's HTTP dialect. Each provider is constructed with its credentials
 * bound (see `media-server/index.ts`); callers receive a `MediaServer` and
 * invoke neutral verbs (`applyPosterUrl`, `lockField`) — never a `baseUrl`/token.
 *
 * The normalized types mirror the existing Plex domain types but are
 * server-neutral: `ServerLibrary` ≈ `PlexSection`, `ServerItem` ≈ `PlexItem`,
 * `ConnectionResult` ≈ `PlexConnectionResult`.
 */

import type { PlexGuids } from '$lib/server/types';

/** The supported media-server backends. */
export type ServerType = 'plex' | 'jellyfin' | 'emby';

/** A movie or show library/section on a media server. */
export interface ServerLibrary {
	/** Provider-native library id/key (Plex section key, Jellyfin/Emby item id). */
	key: string;
	title: string;
	type: 'movie' | 'show';
}

/** A normalized library item with the metadata the app resolves/applies against. */
export interface ServerItem {
	/** Provider-native stable id (Plex ratingKey, Jellyfin/Emby item id). */
	id: string;
	title: string;
	year: number | null;
	type: 'movie' | 'show';
	/** External ids (tmdb/imdb/tvdb); empty object when the item is unresolvable. */
	guids: PlexGuids;
	/** Absolute URL of the item's current poster, or null. */
	currentPosterUrl: string | null;
	/** Absolute URL of the item's current background/art, or null when unsupported. */
	currentBackgroundUrl: string | null;
}

/**
 * A show's season or episode child, identified provider-natively and keyed by its
 * number, so number-keyed artwork (season N / episode N) can be mapped to it.
 */
export interface ServerChild {
	/** Provider-native stable id (Plex ratingKey, Jellyfin/Emby item id). */
	id: string;
	/** Season number (for seasons) or episode number (for episodes). */
	number: number;
}

/** Result of a provider connection test. Never thrown — returned as a value. */
export interface ConnectionResult {
	ok: boolean;
	serverName?: string;
	version?: string;
	/** Human-readable failure reason; present only when `ok` is false. */
	error?: string;
	/** True when the failure was an authentication rejection (bad token/key). */
	unauthorized?: boolean;
}

/** Lockable artwork fields, expressed in neutral terms. */
export type LockField = 'poster' | 'background';

/**
 * The media-server provider interface. Every backend (Plex, Jellyfin, Emby)
 * implements it; the application depends only on this surface.
 */
export interface MediaServer {
	/** Which backend this provider talks to. */
	readonly type: ServerType;

	/** Verify connectivity + credentials. Never throws. */
	testConnection(): Promise<ConnectionResult>;

	/** List the server's movie and show libraries (non-media libraries excluded). */
	listLibraries(): Promise<ServerLibrary[]>;

	/** List a library's items with their resolvable metadata. */
	listItems(libraryKey: string): Promise<ServerItem[]>;

	/** List a show's seasons, each with its season number. */
	listSeasons(showId: string): Promise<ServerChild[]>;

	/** List a season's episodes, each with its episode number. */
	listEpisodes(seasonId: string): Promise<ServerChild[]>;

	/** Apply a poster to an item from an image URL, then lock the poster field. */
	applyPosterUrl(itemId: string, url: string): Promise<void>;

	/** Apply a poster to an item from raw image bytes, then lock the poster field. */
	applyPosterBytes(itemId: string, data: ArrayBuffer, contentType?: string): Promise<void>;

	/** Apply a background/art image from an image URL, then lock the field. */
	applyBackgroundUrl?(itemId: string, url: string): Promise<void>;

	/** Apply a background/art image from raw bytes, then lock the field. */
	applyBackgroundBytes?(itemId: string, data: ArrayBuffer, contentType?: string): Promise<void>;

	/**
	 * Lock or unlock a field so the server's automatic agents do not overwrite an
	 * applied image. A no-op on servers without a lock concept (Jellyfin/Emby).
	 */
	lockField(itemId: string, field: LockField, locked: boolean): Promise<void>;
}

/** A discovered plex.tv server connection (local or remote). */
export interface ConnectionCandidate {
	serverName: string;
	uri: string;
	address: string;
	local: boolean;
	relay: boolean;
	https: boolean;
}
