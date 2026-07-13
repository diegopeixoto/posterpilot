import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveConfig } from '$lib/server/config';
import { getNativeCollectionCandidatePreviewSource } from '$lib/server/collections/native-artwork-runtime';
import { safeStagedArtworkContentType } from '$lib/server/collections/staged-artwork-url';
import { getOrFetchThumb } from '$lib/server/posters/thumb-cache';
import { getActiveServerInstance } from '$lib/server/server-instances';

const DAY_MS = 86_400_000;
const MB = 1024 * 1024;

export const GET: RequestHandler = async ({ params }) => {
	const active = await getActiveServerInstance();
	if (!active) throw error(404, 'server_instance_not_found');
	try {
		const source = await getNativeCollectionCandidatePreviewSource(
			active.id,
			params.id,
			params.candidateId
		);
		const config = await resolveConfig();
		const artwork = await getOrFetchThumb(source, {
			ttlMs: config.thumbCacheTtlDays * DAY_MS,
			maxBytes: config.thumbCacheMaxMb * MB
		});
		const contentType = safeStagedArtworkContentType(artwork.contentType);
		if (!contentType) throw new Error('invalid_type');
		return new Response(new Uint8Array(artwork.bytes), {
			headers: {
				'content-type': contentType,
				'cache-control': 'private, max-age=604800, immutable',
				'x-content-type-options': 'nosniff',
				'content-security-policy': "default-src 'none'; sandbox"
			}
		});
	} catch {
		throw error(404, 'native_collection_candidate_not_found');
	}
};
