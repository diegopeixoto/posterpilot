/**
 * Network orchestration for MediaUX (mediux.pro) scraping.
 *
 * mediux.pro is a Next.js app whose per-set pages (`/sets/{id}`) now 500 site-wide.
 * The listing page (`/movies/{id}` or `/shows/{id}`) still serves the item's full
 * set/file data in its embedded RSC payload, so discovery is a single fetch of the
 * listing page plus pure parsing — no per-set requests, no fan-out.
 */

import { fetchText } from '$lib/server/http';
import { BROWSER_USER_AGENT } from '$lib/server/ua';
import type { MediuxSet, TmdbMediaType } from '$lib/server/types';
import { decodeRscPayload, parseListingSets } from './parser';
import {
	isCloudflareChallenge,
	ProviderScrapeError
} from '$lib/server/posters/providers/scrape-error';

const BASE_URL = 'https://mediux.pro';

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
 * artwork; explicit block pages or undecodable RSC chunks also fail the discovery.
 */
export async function discoverCandidates(
	tmdbId: string,
	mediaType: TmdbMediaType,
	opts: DiscoverOptions
): Promise<MediuxSet[]> {
	const html = await fetchText(listingUrl(tmdbId, mediaType), {
		headers: { 'User-Agent': BROWSER_USER_AGENT, Accept: 'text/html' },
		cacheTtlDays: opts.cacheTtlDays,
		forceRefresh: opts.forceRefresh,
		retries: 2
	});
	if (isCloudflareChallenge(html)) {
		throw new ProviderScrapeError('mediux_blocked', 'MediUX returned a Cloudflare challenge.');
	}
	// A page with no RSC marker may be a legitimate not-found page; only flag
	// malformed chunks when the page actually claims to contain an RSC payload.
	const scripts = [
		...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)
	]
		.map((match) => match[1])
		.join('');
	if (
		/self\.__next_f\.push\(\[\d+,"/.test(scripts) &&
		!decodeRscPayload(scripts) &&
		!/self\.__next_f\.push\(\[\d+,""\]\)/.test(scripts)
	) {
		throw new ProviderScrapeError(
			'mediux_payload_unreadable',
			'MediUX returned an unreadable RSC payload.'
		);
	}
	return parseListingSets(html, tmdbId, mediaType);
}
