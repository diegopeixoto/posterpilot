import { fetchText } from '$lib/server/http';
import { BROWSER_USER_AGENT } from '$lib/server/ua';
import type { AppConfig } from '$lib/server/config';
import type { MediaItem } from '$lib/server/db/schema';
import type { PosterProvider } from './types';
import { bestThePosterDbResultId, parseThePosterDbAssets } from './parse';
import { getThePosterDbSession, invalidateThePosterDbSession } from './theposterdb-session';

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
 *
 * Credentials are optional: anonymous scraping keeps working as before, but the site
 * serves a placeholder image instead of real artwork to anonymous requests on some
 * pages, so when a ThePosterDB account is configured the scrape signs in first (see
 * theposterdb-session.ts) and retries once with a fresh session on an empty scrape —
 * a stale session still returns HTTP 200 with normal-looking markup, so an empty
 * result is the only "logged out" signal there is.
 */

const BASE_URL = 'https://theposterdb.com';

export const thePosterDbProvider: PosterProvider = {
	id: 'theposterdb',
	label: 'ThePosterDB',
	requiresKey: false,
	isAvailable: (config) => config.providerThePosterDb,
	async discover(item: MediaItem, config: AppConfig, opts) {
		const attempt = async (cookie: string | null, forceRefresh?: boolean) => {
			const get = (url: string) =>
				fetchText(url, {
					headers: {
						'User-Agent': BROWSER_USER_AGENT,
						Accept: 'text/html',
						...(cookie ? { Cookie: cookie } : {})
					},
					cacheTtlDays: config.httpCacheTtlDays,
					forceRefresh,
					retries: 1
				});

			const term = encodeURIComponent(`${item.title} ${item.year ?? ''}`.trim());
			const section = item.type === 'show' ? 'shows' : 'movies';
			const searchHtml = await get(`${BASE_URL}/search?term=${term}&section=${section}`);
			// The search page lists sets but embeds no poster images: the matching hit has
			// to be opened. Chosen by title, not by rank — see bestThePosterDbResultId.
			const setId = bestThePosterDbResultId(searchHtml, { title: item.title, year: item.year });
			if (!setId) return [];
			return parseThePosterDbAssets(await get(`${BASE_URL}/posters/${setId}`));
		};

		let cookie = await getThePosterDbSession(
			config.thePosterDbUsername,
			config.thePosterDbPassword
		);
		let sets = await attempt(cookie, opts?.forceRefresh);
		if (!sets.length && cookie) {
			// An authenticated scrape that comes back empty usually means the session
			// expired (the page loaded, but every image was the anonymous placeholder).
			// Re-login once and re-scrape past the cache.
			invalidateThePosterDbSession();
			cookie = await getThePosterDbSession(config.thePosterDbUsername, config.thePosterDbPassword);
			if (cookie) sets = await attempt(cookie, true);
		}
		return sets;
	}
};
