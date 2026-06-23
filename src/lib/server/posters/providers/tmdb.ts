import { fetchJson } from '$lib/server/http';
import { tmdbAuth } from '$lib/server/tmdb/auth';
import type { AppConfig } from '$lib/server/config';
import type { MediaItem } from '$lib/server/db/schema';
import type { PosterProvider } from './types';
import { parseTmdbImages } from './parse';

/**
 * TMDB artwork provider: surfaces the title's TMDB posters and backdrops as
 * candidates, reusing the configured TMDB credential.
 */

const TMDB_BASE = 'https://api.themoviedb.org/3';

export const tmdbProvider: PosterProvider = {
	id: 'tmdb',
	label: 'TMDB',
	requiresKey: false, // reuses the existing TMDB credential
	isAvailable: (config) => config.providerTmdb && Boolean(config.tmdbKey),
	async discover(item: MediaItem, config: AppConfig, opts) {
		if (!item.tmdbId || !item.mediaType || !config.tmdbKey) return [];
		const auth = tmdbAuth(config.tmdbKey);
		const base = `${TMDB_BASE}/${item.mediaType}/${item.tmdbId}/images`;
		const url = auth.query ? `${base}?${auth.query}` : base;
		const json = await fetchJson<unknown>(url, {
			headers: auth.headers,
			cacheTtlDays: config.httpCacheTtlDays,
			forceRefresh: opts?.forceRefresh
		});
		return parseTmdbImages(json);
	}
};
