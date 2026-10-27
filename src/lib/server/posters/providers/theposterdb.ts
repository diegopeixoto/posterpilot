import { fetchText } from '$lib/server/http';
import { BROWSER_USER_AGENT } from '$lib/server/ua';
import type { AppConfig } from '$lib/server/config';
import type { MediaItem } from '$lib/server/db/schema';
import type { PosterProvider } from './types';
import { bestThePosterDbResultId, parseThePosterDbAssets } from './parse';
import { getThePosterDbSession, invalidateThePosterDbSession } from './theposterdb-session';
import { isCloudflareChallenge, ProviderScrapeError } from './scrape-error';

/**
 * ThePosterDB provider (experimental, opt-in, disabled by default).
 *
 * ThePosterDB has no public API and no clean TMDB-id → page mapping, so discovery is
 * a title search, and it takes two steps: the search page lists sets but embeds no
 * poster images at all, so the matching hit has to be opened to scrape its images.
 *
 * The hit is chosen by title rather than by rank — searching "Saving Private Ryan
 * 1998" ranks the documentary "Making 'Saving Private Ryan'" first, whose page holds
 * no posters. A title mismatch still returns [] while explicit scrape failures
 * are isolated and recorded by the discovery service.
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
			if (isCloudflareChallenge(searchHtml)) {
				throw new ProviderScrapeError(
					'theposterdb_blocked',
					'ThePosterDB returned a Cloudflare challenge.'
				);
			}
			// The search page lists sets but embeds no poster images: the matching hit has
			// to be opened. Chosen by title, not by rank — see bestThePosterDbResultId.
			const setId = bestThePosterDbResultId(searchHtml, { title: item.title, year: item.year });
			if (!setId) return { sets: [], placeholderOnly: false };
			const html = await get(`${BASE_URL}/posters/${setId}`);
			if (isCloudflareChallenge(html)) {
				throw new ProviderScrapeError(
					'theposterdb_blocked',
					'ThePosterDB returned a Cloudflare challenge.'
				);
			}
			const sets = parseThePosterDbAssets(html);
			// Authenticated cards also carry a fallback img; only a poster card with
			// no usable source anywhere on the page is evidence of placeholder-only output.
			const placeholderOnly =
				!sets.length &&
				/<picture\b[^>]*>[\s\S]{0,2000}?<img\b[^>]*class=["'][^"']*\btpdb-poster\b[^"']*["'][^>]*src=["'][^"']*missing_poster\.jpg["'][^>]*>[\s\S]{0,200}?<\/picture>\s*<div\b[^>]*data-poster-id=["']\d+["']/i.test(
					html
				);
			return { sets, placeholderOnly };
		};

		const session = async () => {
			try {
				return await getThePosterDbSession(config.thePosterDbUsername, config.thePosterDbPassword, {
					throwOnFailure: true
				});
			} catch {
				throw new ProviderScrapeError(
					'theposterdb_auth_failed',
					'ThePosterDB login failed; check credentials and service availability.'
				);
			}
		};
		let cookie = await session();
		let result = await attempt(cookie, opts?.forceRefresh);
		if (!result.sets.length && cookie) {
			// A stale session can yield placeholders; retain the existing one-retry
			// behavior for all empty responses, including title mismatches.
			invalidateThePosterDbSession();
			cookie = result.placeholderOnly
				? await session()
				: await getThePosterDbSession(config.thePosterDbUsername, config.thePosterDbPassword);
			if (cookie) {
				const refreshed = await attempt(cookie, true);
				if (refreshed.sets.length || !result.placeholderOnly) result = refreshed;
			}
		}
		if (result.placeholderOnly) {
			throw new ProviderScrapeError(
				'theposterdb_placeholder_only',
				'ThePosterDB returned poster cards without accessible artwork.'
			);
		}
		return result.sets;
	}
};
