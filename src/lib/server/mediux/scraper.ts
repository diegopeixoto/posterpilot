/**
 * Network orchestration for MediaUX (mediux.pro) scraping.
 *
 * mediux.pro is a Next.js app whose per-set pages (`/sets/{id}`) now 500 site-wide.
 * The listing page (`/movies/{id}` or `/shows/{id}`) still serves the item's full
 * set/file data in its embedded RSC payload, so discovery is a single fetch of the
 * listing page plus pure parsing — no per-set requests, no fan-out.
 */

import { fetchText } from '$lib/server/http';
import type { MediuxSet, TmdbMediaType } from '$lib/server/types';
import { parseListingSets } from './parser';

const BASE_URL = 'https://mediux.pro';

// Realistic UA — mediux.pro is behind bot filtering.
const USER_AGENT =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** Options for a discovery run. delayMs/concurrency are accepted for API stability but unused (single request). */
export interface DiscoverOptions {
	delayMs?: number;
	concurrency?: number;
	cacheTtlDays: number;
	forceRefresh?: boolean;
}

function listingUrl(tmdbId: string, mediaType: TmdbMediaType): string {
	const segment = mediaType === 'movie' ? 'movies' : 'shows';
	return `${BASE_URL}/${segment}/${tmdbId}`;
}

/**
 * Discover MediaUX artwork candidates for a TMDB id by fetching its listing page
 * and parsing the embedded payload. Returns one `MediuxSet` per set that yielded
 * at least one candidate, newest set first. Empty when the item has no MediaUX
 * artwork; throws only if the single page fetch fails after the HTTP layer's retries.
 */
export async function discoverCandidates(
	tmdbId: string,
	mediaType: TmdbMediaType,
	opts: DiscoverOptions
): Promise<MediuxSet[]> {
	const html = await fetchText(listingUrl(tmdbId, mediaType), {
		headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
		cacheTtlDays: opts.cacheTtlDays,
		forceRefresh: opts.forceRefresh,
		retries: 2
	});
	return parseListingSets(html);
}
