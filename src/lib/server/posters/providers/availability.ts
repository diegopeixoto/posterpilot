import type { AppConfig } from '$lib/server/config';
import type { ProviderId } from './types';

export type ProviderAvailability = 'available' | 'disabled' | 'missing_credential';

/** Pure explanation of whether a configured provider can participate. */
export function providerAvailability(id: ProviderId, config: AppConfig): ProviderAvailability {
	const enabled =
		id === 'mediux'
			? config.providerMediux
			: id === 'tmdb'
				? config.providerTmdb
				: id === 'fanarttv'
					? config.providerFanart
					: config.providerThePosterDb;
	if (!enabled) return 'disabled';
	if (id === 'fanarttv' && !config.fanartKey) return 'missing_credential';
	if (id === 'tmdb' && !config.tmdbKey) return 'missing_credential';
	return 'available';
}
