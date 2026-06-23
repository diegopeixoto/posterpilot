import type { AppConfig } from '$lib/server/config';
import type { MediaItem } from '$lib/server/db/schema';
import type { MediuxSet } from '$lib/server/types';

/** Identifier for an artwork provider; also stored on each candidate row. */
export type ProviderId = 'mediux' | 'tmdb' | 'fanarttv' | 'theposterdb';

/** A discovered artwork set (reuses the MediUX set shape, provider-agnostic). */
export type ArtworkSet = MediuxSet;

/**
 * An artwork source behind a single interface. Providers return artwork sets for a
 * resolved title; the registry decides which are available given the config.
 */
export interface PosterProvider {
	id: ProviderId;
	label: string;
	/** Whether the provider needs a credential to run. */
	requiresKey: boolean;
	/** Enabled in config AND (if keyed) has its credential. */
	isAvailable(config: AppConfig): boolean;
	/** Discover artwork sets for a resolved item. Returns [] when none; may throw on hard failure. */
	discover(
		item: MediaItem,
		config: AppConfig,
		opts?: { forceRefresh?: boolean }
	): Promise<ArtworkSet[]>;
}
