import { fetchText } from '$lib/server/http';
import type { AppConfig } from '$lib/server/config';
import { BROWSER_USER_AGENT } from '$lib/server/ua';
import {
	parseThePosterDbSearchResults,
	parseThePosterDbSet
} from '$lib/server/posters/providers/parse';
import {
	getThePosterDbSession,
	invalidateThePosterDbSession
} from '$lib/server/posters/providers/theposterdb-session';
import {
	matchThePosterDbSetToMembers,
	normalizeTitle,
	type CollectionMemberRef,
	type ThePosterDbCollectionSet
} from './theposterdb-collection-match';

export type {
	CollectionMemberRef,
	SetMemberMatch,
	ThePosterDbCollectionSet
} from './theposterdb-collection-match';

const BASE_URL = 'https://theposterdb.com';

/** Cap how many contributor sets we open per collection to bound outbound requests. */
const MAX_SETS_TO_TRY = 6;

function fetchPage(
	url: string,
	cookie: string | null,
	config: AppConfig,
	opts?: { forceRefresh?: boolean }
) {
	return fetchText(url, {
		headers: {
			'User-Agent': BROWSER_USER_AGENT,
			Accept: 'text/html',
			...(cookie ? { Cookie: cookie } : {})
		},
		cacheTtlDays: config.httpCacheTtlDays,
		forceRefresh: opts?.forceRefresh,
		retries: 1
	});
}

function pickBestCollectionMatch(
	results: Array<{ url: string; title: string }>,
	collectionName: string
): { url: string; title: string } | null {
	if (!results.length) return null;
	const normalized = normalizeTitle(collectionName);
	return results.find((r) => normalizeTitle(r.title) === normalized) ?? results[0];
}

/**
 * Best-effort: search ThePosterDB's Collections section for the collection name, open the
 * best match's set page, parse its per-film posters, and map them onto the members. Any
 * miss, auth failure, or markup change returns null/empty so this never breaks the rest
 * of collection discovery. The scrape runs anonymously when no ThePosterDB account is
 * configured; with credentials it signs in first and retries once with a fresh session
 * on a search miss, mirroring the per-item provider.
 */
export async function fetchThePosterDbCollectionSet(
	collectionName: string,
	members: CollectionMemberRef[],
	config: AppConfig
): Promise<ThePosterDbCollectionSet | null> {
	let cookie = await getThePosterDbSession(config.thePosterDbUsername, config.thePosterDbPassword);

	const searchUrl = `${BASE_URL}/search?term=${encodeURIComponent(
		collectionName.trim()
	)}&section=collections`;
	let match = pickBestCollectionMatch(
		parseThePosterDbSearchResults(await fetchPage(searchUrl, cookie, config)),
		collectionName
	);
	if (!match && cookie) {
		// A stale session can serve logged-out markup; re-login once and search again.
		invalidateThePosterDbSession();
		cookie = await getThePosterDbSession(config.thePosterDbUsername, config.thePosterDbPassword);
		if (!cookie) return null;
		match = pickBestCollectionMatch(
			parseThePosterDbSearchResults(
				await fetchPage(searchUrl, cookie, config, { forceRefresh: true })
			),
			collectionName
		);
	}
	if (!match) return null;

	// match.url is the collection's poster LISTING (one collection poster per contributor),
	// not a per-film set. Each listing card links to that contributor's set (/set/<id>);
	// only some sets also carry a poster per franchise film. Fetch the candidate sets and
	// keep the one that covers the most members. Bounded so a large listing can't fan out.
	const listingHtml = await fetchPage(match.url, cookie, config);
	const setIds = [...new Set(Array.from(listingHtml.matchAll(/\/set\/(\d+)/g)).map((m) => m[1]))];
	if (!setIds.length) return null;

	let best: ThePosterDbCollectionSet | null = null;
	for (const setId of setIds.slice(0, MAX_SETS_TO_TRY)) {
		const posters = parseThePosterDbSet(
			await fetchPage(`${BASE_URL}/set/${setId}`, cookie, config)
		);
		if (!posters.length) continue;
		const mapped = matchThePosterDbSetToMembers(posters, members);
		const candidate: ThePosterDbCollectionSet = { setId: posters[0].setId, ...mapped };
		if (!best || candidate.matches.length > best.matches.length) best = candidate;
		if (best.matches.length >= members.length) break; // full coverage — stop early
	}
	return best;
}
