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

/** The provider preference order (ids), for cross-provider auto-selection. */
export const PROVIDER_ORDER: ProviderId[] = PROVIDERS.map((p) => p.id);

export { providerAvailability, type ProviderAvailability } from './availability';
