import { fetchJson } from '$lib/server/http';
import type { AppConfig } from '$lib/server/config';
import type { MediaItem } from '$lib/server/db/schema';
import type { PosterProvider } from './types';
import { parseFanart } from './parse';

/**
 * Fanart.tv provider. Movies are keyed by TMDB id; TV is keyed by **TVDB** id
 * (so TV is skipped when no tvdbId is present). Image URLs are already absolute.
 */

const FANART_BASE = 'https://webservice.fanart.tv/v3';

export const fanartProvider: PosterProvider = {
	id: 'fanarttv',
	label: 'Fanart.tv',
	requiresKey: true,
	isAvailable: (config) => config.providerFanart && Boolean(config.fanartKey),
	async discover(item: MediaItem, config: AppConfig, opts) {
		if (!config.fanartKey || !item.mediaType) return [];
		// Movies: TMDB id. TV: TVDB id (skip when absent).
		const id = item.mediaType === 'tv' ? item.tvdbId : item.tmdbId;
		if (!id) return [];
		const path = item.mediaType === 'tv' ? 'tv' : 'movies';
		const url = `${FANART_BASE}/${path}/${id}?api_key=${config.fanartKey}`;
		try {
			const json = await fetchJson<unknown>(url, {
				cacheTtlDays: config.httpCacheTtlDays,
				forceRefresh: opts?.forceRefresh
			});
			return parseFanart(json, item.mediaType);
		} catch {
			// 404 = no Fanart.tv entry for this title; treat as no candidates.
			return [];
		}
	}
};
