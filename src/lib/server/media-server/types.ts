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

/** Stable non-secret identity carried by every credentials-bound provider. */
export interface MediaServerIdentity {
	instanceId: string | null;
	name: string | null;
	type: ServerType;
}

export type CapabilitySupport = 'supported' | 'unsupported' | 'unknown';

/** Normalized artwork capabilities used by planning, diagnostics, verification, and undo. */
export interface MediaServerCapabilities extends Record<string, unknown> {
	posterWrite: CapabilitySupport;
	backgroundWrite: CapabilitySupport;
	seasonWrite: CapabilitySupport;
	episodeWrite: CapabilitySupport;
	fieldLock: CapabilitySupport;
	currentImageRetrieval: CapabilitySupport;
	artworkDelete: CapabilitySupport;
	/** Native collection/container discovery, independent of TMDB-backed grouping. */
	nativeCollectionDiscovery?: CapabilitySupport;
	/** Poster/background writes to a provider-native collection entity. */
	collectionArtwork?: CapabilitySupport;
	evidence: 'provider_contract' | 'advertised' | 'verified' | 'unknown';
	limitations: string[];
}

export type ServerArtworkKind = 'poster' | 'background';

/** Current artwork bytes plus a provider-native identity suitable for stale checks. */
export interface ServerArtwork {
	kind: ServerArtworkKind;
	url: string | null;
	identity: string | null;
	data: ArrayBuffer;
	contentType: string | null;
}

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
	/** The media server's own last-modified time for this item; null when the server doesn't report one. */
	serverUpdatedAt: Date | null;
	/** When the item was added to the server library; null when unreported/invalid. */
	addedAt: Date | null;
	/** Played state: movie played at least once, show fully played. False when unreported. */
	watched: boolean;
}

/** One provider-native member reference returned with a collection/container. */
export interface ServerNativeCollectionMember {
	/** Provider-native item id; never inferred from a title. */
	id: string;
	title: string | null;
	year: number | null;
}

/** A provider-native collection and its authoritative member identifiers. */
export interface ServerNativeCollection {
	/** Provider-native collection/container id. */
	id: string;
	name: string;
	members: ServerNativeCollectionMember[];
	currentPosterUrl: string | null;
	currentBackgroundUrl: string | null;
	/** Library ids that exposed this collection; informational, never identity. */
	libraryKeys: string[];
	capabilities: {
		posterWrite: CapabilitySupport;
		backgroundWrite: CapabilitySupport;
	};
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
	/** Current child artwork metadata, populated when the provider exposes it. */
	currentPosterUrl: string | null;
	currentBackgroundUrl: string | null;
	serverUpdatedAt: Date | null;
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
	/** Concrete named-instance identity; null ids are limited to legacy resolution. */
	readonly identity: MediaServerIdentity;
	/** Explicit capability contract; callers never infer support from type alone. */
	readonly capabilities: MediaServerCapabilities;

	/** Verify connectivity + credentials. Never throws. */
	testConnection(): Promise<ConnectionResult>;

	/** List the server's movie and show libraries (non-media libraries excluded). */
	listLibraries(): Promise<ServerLibrary[]>;

	/** List a library's items with their resolvable metadata. */
	listItems(libraryKey: string): Promise<ServerItem[]>;

	/**
	 * Discover provider-native collections for the selected library scope. Missing
	 * support is represented by an absent method and never blocks TMDB enrichment.
	 */
	listNativeCollections?(libraryKeys: string[]): Promise<ServerNativeCollection[]>;

	/** Apply artwork to a provider-native collection/container when supported. */
	applyCollectionPosterUrl?(collectionId: string, url: string): Promise<void>;
	applyCollectionPosterBytes?(
		collectionId: string,
		data: ArrayBuffer,
		contentType?: string
	): Promise<void>;
	applyCollectionBackgroundUrl?(collectionId: string, url: string): Promise<void>;
	applyCollectionBackgroundBytes?(
		collectionId: string,
		data: ArrayBuffer,
		contentType?: string
	): Promise<void>;
	readCollectionArtwork?(
		collectionId: string,
		kind: ServerArtworkKind
	): Promise<ServerArtwork | null>;
	deleteCollectionArtwork?(collectionId: string, kind: ServerArtworkKind): Promise<void>;

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

	/** Read exact current artwork bytes for snapshots and post-write verification. */
	readArtwork?(itemId: string, kind: ServerArtworkKind): Promise<ServerArtwork | null>;

	/** Remove an explicitly set artwork slot when the provider supports absence restoration. */
	deleteArtwork?(itemId: string, kind: ServerArtworkKind): Promise<void>;

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
