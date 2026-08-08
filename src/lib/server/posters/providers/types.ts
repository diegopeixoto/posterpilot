import type { AppConfig } from '$lib/server/config';
import type { MediaItem } from '$lib/server/db/schema';
import type { CandidateKind, MediuxSet } from '$lib/server/types';

/** Identifier for an artwork provider; also stored on each candidate row. */
export type ProviderId = 'mediux' | 'tmdb' | 'fanarttv' | 'theposterdb';

/** A discovered artwork set (reuses the MediUX set shape, provider-agnostic). */
export type ArtworkSet = MediuxSet;

/**
 * What one provider returned for a title: its sets plus notes about the response
 * as a whole.
 *
 * Deliberately a wrapper rather than an extra field on `ArtworkSet`: truncation
 * describes the provider's *response*, not any one set. A provider that dropped
 * every candidate would have no set left to hang the flag on, and `ArtworkSet` is
 * the shared MediUX domain shape — a TMDB-only concern does not belong in it.
 */
export interface ProviderDiscovery {
	sets: ArtworkSet[];
	/**
	 * Artwork kinds whose candidate list hit the provider's retention guard, so the
	 * UI can mark that pane (and only that pane) incomplete. Empty when the provider
	 * kept everything it returned — one boolean could not say *which* pane was cut.
	 */
	truncatedKinds: readonly CandidateKind[];
}

/**
 * Either shape `discover` may resolve to. Bare sets stay legal so a provider that
 * never truncates — MediUX, Fanart.tv, ThePosterDB — carries no ceremony for a
 * signal it cannot produce, and so adding one never forces the others to fabricate
 * a value they have no basis for.
 */
export type DiscoveryResult = ArtworkSet[] | ProviderDiscovery;

/** Normalize either `discover` shape into the annotated one. */
export function providerDiscovery(result: DiscoveryResult): ProviderDiscovery {
	return Array.isArray(result) ? { sets: result, truncatedKinds: [] } : result;
}

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
	/** Discover artwork sets for a resolved item. Returns none when empty; may throw on hard failure. */
	discover(
		item: MediaItem,
		config: AppConfig,
		opts?: { forceRefresh?: boolean }
	): Promise<DiscoveryResult>;
}
