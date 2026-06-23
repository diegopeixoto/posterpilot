import { fetchText } from '$lib/server/http';
import type { AppConfig } from '$lib/server/config';
import type { MediaItem } from '$lib/server/db/schema';
import type { PosterProvider } from './types';
import { parseThePosterDb } from './parse';

/**
 * ThePosterDB provider (experimental, opt-in, disabled by default).
 *
 * ThePosterDB has no public API and no clean TMDB-id → page mapping, so discovery
 * is a best-effort title search whose embedded asset URLs are scraped. The parser
 * is pure and tested; the live `discover` returns [] gracefully on any mismatch so
 * enabling this provider can never break discovery of the others.
 */

const BASE_URL = 'https://theposterdb.com';
const USER_AGENT =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export const thePosterDbProvider: PosterProvider = {
	id: 'theposterdb',
	label: 'ThePosterDB',
	requiresKey: false,
	isAvailable: (config) => config.providerThePosterDb,
	async discover(item: MediaItem, config: AppConfig, opts) {
		const term = encodeURIComponent(`${item.title} ${item.year ?? ''}`.trim());
		const section = item.type === 'show' ? 'shows' : 'movies';
		const url = `${BASE_URL}/search?term=${term}&section=${section}`;
		try {
			const html = await fetchText(url, {
				headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
				cacheTtlDays: config.httpCacheTtlDays,
				forceRefresh: opts?.forceRefresh,
				retries: 1
			});
			return parseThePosterDb(html);
		} catch {
			return [];
		}
	}
};
