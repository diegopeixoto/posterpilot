import { fetchJson, fetchText } from '$lib/server/http';
import type { AppConfig } from '$lib/server/config';
import type { ScoreWeights } from '$lib/server/posters/score';
import { BROWSER_USER_AGENT } from '$lib/server/ua';
import {
	parseThePosterDbAssets,
	parseThePosterDbSearchResults
} from '$lib/server/posters/providers/parse';
import {
	getThePosterDbSession,
	invalidateThePosterDbSession
} from '$lib/server/posters/providers/theposterdb-session';
import { sha256Bytes } from '$lib/server/revisions/verification';
import { downloadRemoteArtwork } from '$lib/server/remote-artwork';
import { tmdbAuth } from '$lib/server/tmdb/auth';
import {
	buildThePosterDbCollectionArtworkCandidates,
	parseTmdbCollectionArtworkCandidates,
	type NativeCollectionArtworkCandidate
} from './native-artwork-candidates';

const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const THEPOSTERDB_BASE_URL = 'https://theposterdb.com';
const MAX_CANDIDATE_BYTES = 30 * 1024 * 1024;
const TRUSTED_CANDIDATE_HOSTS: Record<NativeCollectionArtworkCandidate['provider'], string> = {
	tmdb: 'image.tmdb.org',
	theposterdb: 'images.theposterdb.com'
};

export interface NativeCollectionCandidateBytes {
	bytes: ArrayBuffer;
	contentType: string;
	sha256: string;
}

/** Fetch the official TMDB collection-images endpoint using the existing cache policy. */
export async function fetchTmdbNativeCollectionArtworkCandidates(
	tmdbCollectionId: string,
	tmdbKey: string,
	weights: ScoreWeights
): Promise<NativeCollectionArtworkCandidate[]> {
	if (!/^[1-9]\d*$/.test(tmdbCollectionId) || !tmdbKey) return [];
	const auth = tmdbAuth(tmdbKey);
	const suffix = auth.query ? `?${auth.query}` : '';
	const json = await fetchJson<unknown>(
		`${TMDB_API_BASE}/collection/${tmdbCollectionId}/images${suffix}`,
		{
			headers: auth.headers,
			cacheTtlDays: 30,
			timeoutMs: 15_000
		}
	);
	return parseTmdbCollectionArtworkCandidates(json, tmdbCollectionId, weights);
}

/** Prefer an exact (case-insensitive) name match; otherwise the first (most relevant) result. */
function pickBestCollectionMatch(
	results: Array<{ url: string; title: string }>,
	collectionName: string
): { url: string; title: string } | null {
	if (!results.length) return null;
	const normalized = collectionName.trim().toLocaleLowerCase('en-US');
	const exact = results.find((r) => r.title.trim().toLocaleLowerCase('en-US') === normalized);
	return exact ?? results[0];
}

function fetchThePosterDbPage(
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

/**
 * Search ThePosterDB's "Collections" section by the native collection's display name
 * and, on a match, parse its poster-collection page the same way a title page is
 * parsed. No public API and no TMDB-id mapping exist for this section, so — like the
 * per-item ThePosterDB provider — this is a best-effort title search that returns []
 * gracefully on any mismatch, auth failure, or unexpected markup rather than ever
 * breaking the TMDB candidate source it runs alongside. The scrape is anonymous when
 * no ThePosterDB account is configured; with credentials it signs in first and
 * re-authenticates once if a response comes back looking logged-out.
 */
export async function fetchThePosterDbNativeCollectionArtworkCandidates(
	collectionName: string,
	tmdbCollectionId: string,
	weights: ScoreWeights,
	config: AppConfig
): Promise<NativeCollectionArtworkCandidate[]> {
	if (!/^[1-9]\d*$/.test(tmdbCollectionId)) return [];
	let cookie = await getThePosterDbSession(config.thePosterDbUsername, config.thePosterDbPassword);

	const term = encodeURIComponent(collectionName.trim());
	const searchUrl = `${THEPOSTERDB_BASE_URL}/search?term=${term}&section=collections`;
	const searchHtml = await fetchThePosterDbPage(searchUrl, cookie, config);
	let results = parseThePosterDbSearchResults(searchHtml);
	let match = pickBestCollectionMatch(results, collectionName);

	if (!match && cookie) {
		invalidateThePosterDbSession();
		cookie = await getThePosterDbSession(config.thePosterDbUsername, config.thePosterDbPassword);
		if (!cookie) return [];
		const retryHtml = await fetchThePosterDbPage(searchUrl, cookie, config, {
			forceRefresh: true
		});
		results = parseThePosterDbSearchResults(retryHtml);
		match = pickBestCollectionMatch(results, collectionName);
	}
	if (!match) return [];

	let pageHtml = await fetchThePosterDbPage(match.url, cookie, config);
	let sets = parseThePosterDbAssets(pageHtml);
	if (!sets.length && cookie) {
		invalidateThePosterDbSession();
		cookie = await getThePosterDbSession(config.thePosterDbUsername, config.thePosterDbPassword);
		if (!cookie) return [];
		pageHtml = await fetchThePosterDbPage(match.url, cookie, config, {
			forceRefresh: true
		});
		sets = parseThePosterDbAssets(pageHtml);
	}
	return buildThePosterDbCollectionArtworkCandidates(sets, tmdbCollectionId, weights);
}

/** Freeze the exact raster bytes that will be sent to the native collection entity. */
export async function fetchNativeCollectionCandidateBytes(
	candidate: NativeCollectionArtworkCandidate
): Promise<NativeCollectionCandidateBytes> {
	const trustedHost = TRUSTED_CANDIDATE_HOSTS[candidate.provider];
	const downloaded = await downloadRemoteArtwork(candidate.url, {
		maxBytes: MAX_CANDIDATE_BYTES,
		timeoutMs: 15_000,
		maxRedirects: 3,
		validateUrl: (target) =>
			target.protocol === 'https:' &&
			!target.username &&
			!target.password &&
			!target.port &&
			target.hostname.toLowerCase() === trustedHost
	});
	return {
		bytes: downloaded.bytes,
		contentType: downloaded.contentType,
		sha256: sha256Bytes(downloaded.bytes)
	};
}
