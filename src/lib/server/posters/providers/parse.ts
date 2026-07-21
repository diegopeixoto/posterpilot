import { tmdbImageUrl } from '$lib/server/tmdb/metadata';
import type { TmdbMediaType } from '$lib/server/types';
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
}
interface TmdbImagesResponse {
	posters?: TmdbImage[];
	backdrops?: TmdbImage[];
}

/** Build a single TMDB set (posters + backdrops) from an images response. */
export function parseTmdbImages(json: unknown): ArtworkSet[] {
	const data = (json ?? {}) as TmdbImagesResponse;
	const posters = (data.posters ?? [])
		.slice(0, MAX_PER_KIND)
		.map((p) => ({
			url: tmdbImageUrl(p.file_path, 'w500'),
			width: p.width ?? null,
			height: p.height ?? null
		}))
		.filter(
			(p): p is { url: string; width: number | null; height: number | null } => p.url !== null
		)
		.map((p) => ({
			setId: 'tmdb',
			setAuthor: null,
			url: p.url,
			kind: 'poster' as const,
			season: null,
			episode: null,
			width: p.width,
			height: p.height
		}));
	const backdrops = (data.backdrops ?? [])
		.slice(0, MAX_PER_KIND)
		.map((b) => ({
			url: tmdbImageUrl(b.file_path, 'w1280'),
			width: b.width ?? null,
			height: b.height ?? null
		}))
		.filter(
			(b): b is { url: string; width: number | null; height: number | null } => b.url !== null
		)
		.map((b) => ({
			setId: 'tmdb',
			setAuthor: null,
			url: b.url,
			kind: 'background' as const,
			season: null,
			episode: null,
			width: b.width,
			height: b.height
		}));
	const candidates = [...posters, ...backdrops];
	return candidates.length ? [{ setId: 'tmdb', author: null, candidates }] : [];
}

interface FanartImage {
	url?: string;
	season?: string;
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
			.map((i) => ({
				setId: 'fanarttv',
				setAuthor: null,
				url: i.url!,
				kind,
				season: kind === 'season' && i.season && /^\d+$/.test(i.season) ? Number(i.season) : null,
				episode: null
			}));

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
 * posters. Prefer an exact title match on the right year, then the same title on any
 * year. Nothing matching yields null — a mismatched set would paint another film's
 * artwork onto the library, which is worse than none.
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
	const sameYear = want.year
		? matches.find((match) => match.year === String(want.year))
		: undefined;
	return (sameYear ?? matches[0]).id;
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
		url,
		kind: 'poster' as const,
		season: null,
		episode: null
	}));
	return [{ setId: 'theposterdb', author: null, candidates }];
}
