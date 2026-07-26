import { scorePoster, type ScoreWeights } from '$lib/server/posters/score';
import { hashCanonicalJson } from '$lib/server/plans/canonical-json';
import { tmdbImageUrl } from '$lib/server/tmdb/metadata';
import type { ArtworkSet } from '$lib/server/posters/providers/types';

export type NativeCollectionArtworkKind = 'poster' | 'background';
export type NativeCollectionArtworkProvider = 'tmdb' | 'theposterdb';

export interface NativeCollectionArtworkCandidate {
	id: string;
	tmdbCollectionId: string;
	provider: NativeCollectionArtworkProvider;
	providerAssetId: string;
	kind: NativeCollectionArtworkKind;
	language: string | null;
	width: number | null;
	height: number | null;
	score: number;
	url: string;
	previewUrl: string;
	fingerprint: string;
}

interface TmdbCollectionImage {
	file_path?: unknown;
	iso_639_1?: unknown;
	width?: unknown;
	height?: unknown;
}

interface TmdbCollectionImagesResponse {
	posters?: unknown;
	backdrops?: unknown;
}

const MAX_SOURCE_IMAGES_PER_KIND = 200;
const MAX_CANDIDATES_PER_KIND = 24;
const SAFE_FILE_PATH = /^\/[A-Za-z0-9_./-]{1,255}\.(?:avif|jpe?g|png|webp)$/i;

function positiveDimension(value: unknown): number | null {
	return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function language(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== 'string') return null;
	const normalized = value.trim();
	return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(normalized) ? normalized : null;
}

function images(value: unknown): TmdbCollectionImage[] {
	return Array.isArray(value)
		? value
				.slice(0, MAX_SOURCE_IMAGES_PER_KIND)
				.filter(
					(entry): entry is TmdbCollectionImage =>
						entry !== null && typeof entry === 'object' && !Array.isArray(entry)
				)
		: [];
}

function candidate(
	tmdbCollectionId: string,
	kind: NativeCollectionArtworkKind,
	image: TmdbCollectionImage,
	weights: ScoreWeights
): NativeCollectionArtworkCandidate | null {
	if (
		typeof image.file_path !== 'string' ||
		!SAFE_FILE_PATH.test(image.file_path) ||
		image.file_path.includes('..')
	) {
		return null;
	}
	const url = tmdbImageUrl(image.file_path, 'original');
	const previewUrl = tmdbImageUrl(image.file_path, kind === 'poster' ? 'w500' : 'w1280');
	if (!url || !previewUrl) return null;
	const width = positiveDimension(image.width);
	const height = positiveDimension(image.height);
	const candidateIdentity = {
		provider: 'tmdb' as const,
		tmdbCollectionId,
		providerAssetId: image.file_path,
		kind,
		language: language(image.iso_639_1),
		width,
		height,
		url
	};
	return {
		id: hashCanonicalJson({
			provider: candidateIdentity.provider,
			tmdbCollectionId,
			providerAssetId: candidateIdentity.providerAssetId,
			kind
		}),
		...candidateIdentity,
		score: scorePoster(candidateIdentity, weights),
		previewUrl,
		fingerprint: hashCanonicalJson(candidateIdentity)
	};
}

/** Parse, bound, deduplicate, and deterministically rank TMDB collection artwork. */
export function parseTmdbCollectionArtworkCandidates(
	json: unknown,
	tmdbCollectionId: string,
	weights: ScoreWeights
): NativeCollectionArtworkCandidate[] {
	if (!/^[1-9]\d*$/.test(tmdbCollectionId)) return [];
	const response =
		json !== null && typeof json === 'object' && !Array.isArray(json)
			? (json as TmdbCollectionImagesResponse)
			: {};
	const parsed = [
		...images(response.posters).flatMap((image) => {
			const value = candidate(tmdbCollectionId, 'poster', image, weights);
			return value ? [value] : [];
		}),
		...images(response.backdrops).flatMap((image) => {
			const value = candidate(tmdbCollectionId, 'background', image, weights);
			return value ? [value] : [];
		})
	];
	const deduplicated = new Map(
		parsed.map((entry) => [`${entry.kind}:${entry.providerAssetId}`, entry] as const)
	);
	const byKind = (kind: NativeCollectionArtworkKind) =>
		[...deduplicated.values()]
			.filter((entry) => entry.kind === kind)
			.sort(
				(left, right) =>
					right.score - left.score ||
					left.providerAssetId.localeCompare(right.providerAssetId) ||
					left.id.localeCompare(right.id)
			)
			.slice(0, MAX_CANDIDATES_PER_KIND);
	return [...byKind('poster'), ...byKind('background')];
}

const MAX_THEPOSTERDB_CANDIDATES = 24;

/**
 * Convert ThePosterDB "Collections"-section poster sets (same card markup as a
 * title page, already parsed by `parseThePosterDbAssets`) into native collection
 * artwork candidates. ThePosterDB never exposes a backdrop/background asset on
 * these pages, so this only ever produces `poster` candidates.
 */
export function buildThePosterDbCollectionArtworkCandidates(
	sets: ArtworkSet[],
	tmdbCollectionId: string,
	weights: ScoreWeights
): NativeCollectionArtworkCandidate[] {
	if (!/^[1-9]\d*$/.test(tmdbCollectionId)) return [];
	const seenUrls = new Set<string>();
	const parsed: NativeCollectionArtworkCandidate[] = [];
	for (const set of sets) {
		for (const item of set.candidates) {
			if (item.kind !== 'poster' || item.season !== null || item.episode !== null) continue;
			if (seenUrls.has(item.url)) continue;
			seenUrls.add(item.url);
			const candidateIdentity = {
				provider: 'theposterdb' as const,
				tmdbCollectionId,
				providerAssetId: item.url,
				kind: 'poster' as const,
				language: null,
				width: null,
				height: null,
				url: item.url
			};
			parsed.push({
				id: hashCanonicalJson({
					provider: candidateIdentity.provider,
					tmdbCollectionId,
					providerAssetId: candidateIdentity.providerAssetId,
					kind: candidateIdentity.kind
				}),
				...candidateIdentity,
				score: scorePoster(candidateIdentity, weights),
				previewUrl: item.url,
				fingerprint: hashCanonicalJson(candidateIdentity)
			});
		}
	}
	return parsed
		.sort(
			(left, right) =>
				right.score - left.score ||
				left.providerAssetId.localeCompare(right.providerAssetId) ||
				left.id.localeCompare(right.id)
		)
		.slice(0, MAX_THEPOSTERDB_CANDIDATES);
}

export function nativeCollectionCandidateSetFingerprint(
	candidates: NativeCollectionArtworkCandidate[]
): string {
	return hashCanonicalJson(
		candidates.map((entry) => ({ id: entry.id, fingerprint: entry.fingerprint }))
	);
}
