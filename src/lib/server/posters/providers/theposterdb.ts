import { fetchText } from '$lib/server/http';
import { BROWSER_USER_AGENT } from '$lib/server/ua';
import type { AppConfig } from '$lib/server/config';
import type { MediaItem } from '$lib/server/db/schema';
import type { PosterProvider } from './types';
import { bestThePosterDbResultId, parseThePosterDb } from './parse';

/**
 * ThePosterDB provider (experimental, opt-in, disabled by default).
 *
 * ThePosterDB has no public API and no clean TMDB-id → page mapping, so discovery is
 * a title search, and it takes two steps: the search page lists sets but embeds no
 * poster images at all, so the matching hit has to be opened to scrape its images.
 *
 * The hit is chosen by title rather than by rank — searching "Saving Private Ryan
 * 1998" ranks the documentary "Making 'Saving Private Ryan'" first, whose page holds
 * no posters. The parser is pure and tested; the live `discover` returns [] on any
 * mismatch so enabling this provider can never break discovery of the others.
 */

const BASE_URL = 'https://theposterdb.com';

export const thePosterDbProvider: PosterProvider = {
	id: 'theposterdb',
	label: 'ThePosterDB',
	requiresKey: false,
	isAvailable: (config) => config.providerThePosterDb,
	async discover(item: MediaItem, config: AppConfig, opts) {
		const get = (url: string) =>
			fetchText(url, {
				headers: { 'User-Agent': BROWSER_USER_AGENT, Accept: 'text/html' },
				cacheTtlDays: config.httpCacheTtlDays,
				forceRefresh: opts?.forceRefresh,
				retries: 1
			});

		const term = encodeURIComponent(`${item.title} ${item.year ?? ''}`.trim());
		const section = item.type === 'show' ? 'shows' : 'movies';
		const searchHtml = await get(`${BASE_URL}/search?term=${term}&section=${section}`);
		// The search page lists sets but embeds no poster images: the matching hit has
		// to be opened. Chosen by title, not by rank — see bestThePosterDbResultId.
		const setId = bestThePosterDbResultId(searchHtml, { title: item.title, year: item.year });
		if (!setId) return [];
		return parseThePosterDb(await get(`${BASE_URL}/posters/${setId}`));
	}
};
