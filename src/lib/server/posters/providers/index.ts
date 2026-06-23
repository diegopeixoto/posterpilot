import type { AppConfig } from '$lib/server/config';
import type { PosterProvider, ProviderId } from './types';
import { mediuxProvider } from './mediux';
import { tmdbProvider } from './tmdb';
import { fanartProvider } from './fanart';
import { thePosterDbProvider } from './theposterdb';

export type { PosterProvider, ProviderId, ArtworkSet } from './types';

/**
 * All registered providers, in the deterministic preference order used for
 * auto-selection (most-preferred first).
 */
export const PROVIDERS: PosterProvider[] = [
	mediuxProvider,
	fanartProvider,
	thePosterDbProvider,
	tmdbProvider
];

/** Human-readable label for a provider id. */
export function providerLabel(id: string): string {
	return PROVIDERS.find((p) => p.id === id)?.label ?? id;
}

/** The provider preference order (ids), for cross-provider auto-selection. */
export const PROVIDER_ORDER: ProviderId[] = PROVIDERS.map((p) => p.id);

/** Providers that are enabled and (if keyed) have their credential. */
export function availableProviders(config: AppConfig): PosterProvider[] {
	return PROVIDERS.filter((p) => p.isAvailable(config));
}
