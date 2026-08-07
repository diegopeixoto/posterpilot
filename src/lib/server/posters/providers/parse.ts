import { tmdbImageUrl } from '$lib/server/tmdb/metadata';
import type { ArtworkLanguageProvenance, TmdbMediaType } from '$lib/server/types';
import type { ArtworkSet } from './types';

/**
 * Pure response parsers for the artwork providers. Kept free of HTTP/config/$env
 * imports so they can be unit-tested in isolation; the provider objects own the
 * network calls and pass raw responses here.
 */

const MAX_PER_KIND = 20;

interface TmdbImage {
	file_path?: string;
	width?: number;
	height?: number;
	iso_639_1?: string | null;
}
interface TmdbImagesResponse {
	posters?: TmdbImage[];
	backdrops?: TmdbImage[];
}

interface CandidateLanguage {
	language: string | null;
	languageProvenance: ArtworkLanguageProvenance;
}

function candidateLanguage(value: unknown): CandidateLanguage {
	if (value === null || value === '') {
		return { language: null, languageProvenance: 'untagged' };
	}
	if (typeof value === 'string') {
		const base = value.trim().toLowerCase().split('-')[0];
		if (/^[a-z]{2}$/.test(base)) {
			return { language: base, languageProvenance: 'tagged' };
		}
	}
	return { language: null, languageProvenance: 'unknown' };
}

function unknownMetadata(providerAssetId: string | null = null) {
	return {
		providerAssetId,
		previewUrl: null,
		width: null,
		height: null,
		language: null,
		languageProvenance: 'unknown' as const
	};
}

function tmdbCandidate(
	image: TmdbImage,
	kind: 'poster' | 'background',
	previewSize: 'w500' | 'w1280'
) {
	const url = tmdbImageUrl(image.file_path, 'original');
	const previewUrl = tmdbImageUrl(image.file_path, previewSize);
	if (!url || !previewUrl || !image.file_path) return null;
	return {
		setId: 'tmdb',
		setAuthor: null,
		providerAssetId: image.file_path,
		url,
		previewUrl,
		kind,
		season: null,
		episode: null,
		width: image.width ?? null,
		height: image.height ?? null,
		...candidateLanguage(image.iso_639_1)
	};
}

/** Build a single TMDB set (posters + backdrops) from an images response. */
export function parseTmdbImages(json: unknown): ArtworkSet[] {
	const data = (json ?? {}) as TmdbImagesResponse;
	const posters = (data.posters ?? [])
		.slice(0, MAX_PER_KIND)
		.map((image) => tmdbCandidate(image, 'poster', 'w500'))
		.filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);
	const backdrops = (data.backdrops ?? [])
		.slice(0, MAX_PER_KIND)
		.map((image) => tmdbCandidate(image, 'background', 'w1280'))
		.filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);
	const candidates = [...posters, ...backdrops];
	return candidates.length ? [{ setId: 'tmdb', author: null, candidates }] : [];
}

interface FanartImage {
	id?: string | number;
	url?: string;
	season?: string;
	lang?: string | null;
}
interface FanartResponse {
	movieposter?: FanartImage[];
	tvposter?: FanartImage[];
	moviebackground?: FanartImage[];
	showbackground?: FanartImage[];
	seasonposter?: FanartImage[];
}

/** Build a Fanart.tv set from the API response for the given media type. */
export function parseFanart(json: unknown, mediaType: TmdbMediaType): ArtworkSet[] {
	const d = (json ?? {}) as FanartResponse;
	const posterSrc = mediaType === 'tv' ? d.tvposter : d.movieposter;
	const bgSrc = mediaType === 'tv' ? d.showbackground : d.moviebackground;

	const mk = (imgs: FanartImage[] | undefined, kind: 'poster' | 'background' | 'season') =>
		(imgs ?? [])
			.filter((i) => Boolean(i.url))
			.map((i) => {
				const providerAssetId =
					typeof i.id === 'string' || typeof i.id === 'number' ? String(i.id).trim() || null : null;
				return {
					setId: 'fanarttv',
					setAuthor: null,
					providerAssetId,
					url: i.url!,
					previewUrl: null,
					kind,
					season: kind === 'season' && i.season && /^\d+$/.test(i.season) ? Number(i.season) : null,
					episode: null,
					width: null,
					height: null,
					...candidateLanguage(i.lang)
				};
			});

	const candidates = [
		...mk(posterSrc, 'poster'),
		...mk(bgSrc, 'background'),
		...(mediaType === 'tv' ? mk(d.seasonposter, 'season') : [])
	];
	return candidates.length ? [{ setId: 'fanarttv', author: null, candidates }] : [];
}

// A poster page serves its images from the CDN, as
// images.theposterdb.com/.../posters/optimized/<section>/<id>/<hash>.jpg
const CDN_RE =
	/https?:\/\/images\.theposterdb\.com\/[^\s"'\\)]*?\/posters\/optimized\/[^\s"'\\)]+?\.(?:jpg|webp|png)/gi;
// Older/alternate download form, kept as a fallback.
const ASSET_RE = /https?:\/\/theposterdb\.com\/api\/assets\/\d+/g;
// A search page links each hit as `<a href=".../posters/<id>"…><strong>Title</strong> (Year)</a>`.
const RESULT_RE = /\/posters\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g;
const RESULT_TITLE_RE = /<strong>([\s\S]*?)<\/strong>/;
const RESULT_YEAR_RE = /\((\d{4})\)/;

/** Compare titles ignoring case, accents and punctuation ("WALL·E" === "Wall-E"). */
function normalizeTitle(value: string): string {
	return (
		value
			.normalize('NFKD')
			// Combining marks only: \p{Diacritic} also matches standalone punctuation such
			// as the middle dot in "WALL·E", which would collapse it to "walle" and stop it
			// matching "Wall-E".
			.replace(/\p{Mn}/gu, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, ' ')
			.trim()
	);
}

/**
 * The id of the search hit that actually matches the wanted title, or null.
 *
 * The top-ranked hit is not the answer: searching "Saving Private Ryan 1998" ranks
 * the documentary "Making 'Saving Private Ryan' (2004)" first, whose page holds no
 * posters. Prefer an exact title match on the right year; a hit that lists no year
 * is acceptable (nothing disproves it), but a hit listing a DIFFERENT year is a
 * different film — "Dune (1984)" is not "Dune (2021)" — and yields null rather
 * than painting another film's artwork onto the library, which is worse than none.
 */
export function bestThePosterDbResultId(
	html: string,
	want: { title: string; year: number | null }
): string | null {
	const wanted = normalizeTitle(want.title);
	if (!wanted) return null;
	const matches: { id: string; year: string | null }[] = [];
	for (const [, id, inner] of html.matchAll(RESULT_RE)) {
		const title = inner.match(RESULT_TITLE_RE)?.[1];
		if (!title || normalizeTitle(title) !== wanted) continue;
		matches.push({ id, year: inner.match(RESULT_YEAR_RE)?.[1] ?? null });
	}
	if (!matches.length) return null;
	if (!want.year) return matches[0].id;
	const sameYear = matches.find((match) => match.year === String(want.year));
	const yearless = matches.find((match) => match.year === null);
	return (sameYear ?? yearless)?.id ?? null;
}

/** Extract poster URLs from a ThePosterDB poster page into one set. */
export function parseThePosterDb(html: string): ArtworkSet[] {
	// The CDN serves each poster as both .webp and .jpg; collapse the pair (prefer
	// .jpg) so one poster yields one candidate instead of two identical ones.
	const byKey = new Map<string, string>();
	for (const url of html.match(CDN_RE) ?? []) {
		const key = url.replace(/\.(?:jpg|webp|png)$/i, '');
		if (!byKey.has(key) || /\.jpg$/i.test(url)) byKey.set(key, url);
	}
	let urls = [...byKey.values()];
	if (!urls.length) urls = Array.from(new Set(html.match(ASSET_RE) ?? []));
	if (!urls.length) return [];
	const candidates = urls.map((url) => ({
		setId: 'theposterdb',
		setAuthor: null,
		...unknownMetadata(url.match(/\/api\/assets\/(\d+)$/)?.[1] ?? null),
		url,
		kind: 'poster' as const,
		season: null,
		episode: null
	}));
	return [{ setId: 'theposterdb', author: null, candidates }];
}

/** A matching title found on a ThePosterDB search-results page. */
export interface ThePosterDbSearchResult {
	/** The title's poster-collection page, e.g. https://theposterdb.com/posters/2578 */
	url: string;
	title: string;
	year: number | null;
}

// Search results link to each matching title's poster-collection page
// (theposterdb.com/posters/<id>) with the title/year as the link text; they embed no
// poster images (see parseThePosterDbAssets below). Complements RESULT_RE above: this
// form keeps the absolute page URL, which the collection scrapers follow directly.
const SEARCH_RESULT_RE =
	/href="(https:\/\/theposterdb\.com\/posters\/\d+)"[\s\S]{0,300}?<strong>([^<]+)<\/strong>\s*(?:\((\d{4})\))?/g;

/** Extract matching titles (with their poster-collection page URL) from a search page. */
export function parseThePosterDbSearchResults(html: string): ThePosterDbSearchResult[] {
	const results: ThePosterDbSearchResult[] = [];
	const seen = new Set<string>();
	for (const match of html.matchAll(SEARCH_RESULT_RE)) {
		const [, url, rawTitle, rawYear] = match;
		if (seen.has(url)) continue;
		seen.add(url);
		results.push({
			url,
			title: rawTitle.trim(),
			year: rawYear ? Number(rawYear) : null
		});
	}
	return results;
}

// Each card on a title's poster-collection page is one contributor's poster for that
// title: a <picture> with webp + jpeg <source> variants of the same image (only the webp
// is captured here — matching both would report the same poster twice, which is exactly
// the "duplicate" images this used to produce), a numeric poster id, an "uploaded by
// <user>" byline, and a link to that contributor's set. The setId is that contributor's
// real ThePosterDB set id (theposterdb.com/set/<id>), not the individual poster id: a
// creator's set is often one consistent design spanning a whole franchise (e.g. one set
// covering Batman Begins + The Dark Knight + The Dark Knight Rises), and reusing the real
// set id — instead of a per-poster one — is what lets the app's cross-title "suggested
// visual family" grouping (see collections/suggestions.ts, exact_set identity) recognize
// that same set across multiple collection members, the same way it already does for
// MediUX sets. Bounded lookaheads (rather than unbounded `[\s\S]*?`) keep a malformed or
// missing field on one card from binding to the next card's data instead of just failing
// to match.
const CARD_RE =
	/<source class="w-100 rounded-poster" type="image\/webp" srcset="(https:\/\/images\.theposterdb\.com\/prod\/public\/images\/posters\/optimized\/(?:movies|shows)\/\d+\/[A-Za-z0-9_-]+\.webp)">[\s\S]{0,1500}?data-poster-id=['"](\d+)['"][\s\S]{0,600}?uploaded-by[^>]*>by <a href="https:\/\/theposterdb\.com\/user\/[^"]+">([^<]+)<\/a>[\s\S]{0,600}?href="https:\/\/theposterdb\.com\/set\/(\d+)"/g;

/** One poster on a ThePosterDB collection-set page ("More Posters From This Set"). */
export interface ThePosterDbSetPoster {
	/** Numeric poster id (data-poster-id / the download-asset id). */
	posterId: string;
	/** movie → a franchise member; collection → the collection entity's own poster. */
	type: 'movie' | 'collection' | 'show';
	url: string;
	/** Title text on the card, minus the trailing "(YYYY)" when present. */
	title: string;
	year: number | null;
	/** The contributor set id (theposterdb.com/set/<id>), shared by every card. */
	setId: string;
}

// A collection-set page lists one poster per franchise film plus (usually) one
// collection-type poster for the collection entity. Each card carries the film title +
// year, the poster type, the asset URL, and the shared set id — everything needed to map
// a set poster onto the matching collection member. Note this markup differs from a
// title page's cards (a data-poster-type attribute right after the poster id), which is
// why CARD_RE above does not match here and a dedicated parser is required. Bounded
// lookaheads keep a malformed card from binding to the next card's fields.
// Attribute quoting differs by page: a browser-saved copy normalizes to double quotes,
// but the live server markup uses single quotes on data-poster-id / data-poster-type —
// so match either with ['"].
const SET_CARD_RE =
	/type="image\/webp" srcset="(https:\/\/images\.theposterdb\.com\/prod\/public\/images\/posters\/optimized\/(?:movies|shows|collections)\/\d+\/[A-Za-z0-9_-]+\.webp)">[\s\S]{0,800}?data-poster-id=['"](\d+)['"] data-poster-type=['"](movie|collection|show)['"][\s\S]{0,400}?<p class="p-0 mb-1 text-break">([^<]+)<\/p>[\s\S]{0,600}?href="https:\/\/theposterdb\.com\/set\/(\d+)"/g;

/** Split a card title like "Cash Out (2024)" into name + year (year null when absent). */
function splitTitleYear(raw: string): { title: string; year: number | null } {
	const trimmed = raw.trim();
	const m = /^(.*\S)\s*\((\d{4})\)$/.exec(trimmed);
	return m ? { title: m[1].trim(), year: Number(m[2]) } : { title: trimmed, year: null };
}

/** Extract every poster (with its film title/year and type) from a ThePosterDB set page. */
export function parseThePosterDbSet(html: string): ThePosterDbSetPoster[] {
	const posters: ThePosterDbSetPoster[] = [];
	const seen = new Set<string>();
	for (const [, url, posterId, type, rawTitle, setId] of html.matchAll(SET_CARD_RE)) {
		if (seen.has(posterId)) continue;
		seen.add(posterId);
		const { title, year } = splitTitleYear(rawTitle);
		posters.push({ posterId, type: type as ThePosterDbSetPoster['type'], url, title, year, setId });
	}
	return posters;
}

/** Extract poster assets (grouped by contributor set) from a ThePosterDB title page. */
export function parseThePosterDbAssets(html: string): ArtworkSet[] {
	const seenPosterIds = new Set<string>();
	const sets: ArtworkSet[] = [];
	for (const [, url, posterId, rawAuthor, tpdbSetId] of html.matchAll(CARD_RE)) {
		// The same poster can appear more than once when a card has linked/related sets.
		if (seenPosterIds.has(posterId)) continue;
		seenPosterIds.add(posterId);
		const setId = `theposterdb-${tpdbSetId}`;
		const author = rawAuthor.trim();
		sets.push({
			setId,
			author,
			candidates: [
				{
					setId,
					setAuthor: author,
					...unknownMetadata(posterId),
					url,
					kind: 'poster',
					season: null,
					episode: null
				}
			]
		});
	}
	if (sets.length) return sets;

	// The per-card structure changed shape (or the page is an older layout): fall back
	// to the flat unattributed CDN/asset scrape that predates contributor-card parsing.
	return parseThePosterDb(html);
}
