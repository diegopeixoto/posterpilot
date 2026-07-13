import { fetchJson } from '$lib/server/http';
import type { ScoreWeights } from '$lib/server/posters/score';
import { sha256Bytes } from '$lib/server/revisions/verification';
import { tmdbAuth } from '$lib/server/tmdb/auth';
import { safeStagedArtworkContentType } from './staged-artwork-url';
import {
	parseTmdbCollectionArtworkCandidates,
	type NativeCollectionArtworkCandidate
} from './native-artwork-candidates';

const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const MAX_CANDIDATE_BYTES = 30 * 1024 * 1024;

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

/** Freeze the exact raster bytes that will be sent to the native collection entity. */
export async function fetchNativeCollectionCandidateBytes(
	candidate: NativeCollectionArtworkCandidate
): Promise<NativeCollectionCandidateBytes> {
	const parsed = new URL(candidate.url);
	if (parsed.protocol !== 'https:' || parsed.hostname !== 'image.tmdb.org') {
		throw new TypeError('native_collection_candidate_source_invalid');
	}
	const response = await fetch(parsed, {
		redirect: 'error',
		signal: AbortSignal.timeout(15_000)
	});
	if (!response.ok) throw new Error('native_collection_candidate_unavailable');
	const declaredLength = Number(response.headers.get('content-length'));
	if (Number.isFinite(declaredLength) && declaredLength > MAX_CANDIDATE_BYTES) {
		throw new Error('native_collection_candidate_too_large');
	}
	const contentType = safeStagedArtworkContentType(response.headers.get('content-type') ?? '');
	if (!contentType) throw new Error('native_collection_candidate_type_invalid');
	const bytes = await response.arrayBuffer();
	if (bytes.byteLength === 0 || bytes.byteLength > MAX_CANDIDATE_BYTES) {
		throw new Error('native_collection_candidate_size_invalid');
	}
	return { bytes, contentType, sha256: sha256Bytes(bytes) };
}
