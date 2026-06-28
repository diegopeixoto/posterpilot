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

// ThePosterDB serves assets from /api/assets/<id>.
const ASSET_RE = /https?:\/\/theposterdb\.com\/api\/assets\/\d+/g;

/** Extract poster asset URLs from a ThePosterDB page into one set. */
export function parseThePosterDb(html: string): ArtworkSet[] {
	const urls = Array.from(new Set(html.match(ASSET_RE) ?? []));
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
