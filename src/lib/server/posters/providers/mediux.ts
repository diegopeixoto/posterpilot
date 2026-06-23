import { discoverCandidates } from '$lib/server/mediux/scraper';
import type { PosterProvider } from './types';

/** MediUX provider: the existing scraper/parser behind the shared interface. */
export const mediuxProvider: PosterProvider = {
	id: 'mediux',
	label: 'MediUX',
	requiresKey: false,
	isAvailable: (config) => config.providerMediux,
	async discover(item, config, opts) {
		if (!item.tmdbId || !item.mediaType) return [];
		return discoverCandidates(item.tmdbId, item.mediaType, {
			delayMs: config.mediuxDelayMs,
			concurrency: config.mediuxConcurrency,
			cacheTtlDays: config.httpCacheTtlDays,
			forceRefresh: opts?.forceRefresh
		});
	}
};
