import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveConfig } from '$lib/server/config';
import {
	safeStagedArtworkContentType,
	safeStagedArtworkUrl
} from '$lib/server/collections/staged-artwork-url';
import { getCollectionCandidatePreviewSource } from '$lib/server/collections/suggestion-store';
import { getActiveServerInstance } from '$lib/server/server-instances';
import { getOrFetchThumb } from '$lib/server/posters/thumb-cache';

const DAY_MS = 86_400_000;
const MB = 1024 * 1024;

export const GET: RequestHandler = async ({ params }) => {
	const candidateId = Number(params.candidateId);
	if (!Number.isSafeInteger(candidateId) || candidateId <= 0) throw error(400, 'invalid id');
	const active = await getActiveServerInstance();
	if (!active) throw error(404, 'candidate not found');
	const stored = await getCollectionCandidatePreviewSource(active.id, params.id, candidateId);
	const source = stored ? safeStagedArtworkUrl(stored) : null;
	if (!source) throw error(404, 'candidate not found');

	try {
		const config = await resolveConfig();
		const { bytes, contentType } = await getOrFetchThumb(source, {
			ttlMs: config.thumbCacheTtlDays * DAY_MS,
			maxBytes: config.thumbCacheMaxMb * MB
		});
		const safeContentType = safeStagedArtworkContentType(contentType);
		if (!safeContentType) throw new Error('unsupported candidate artwork type');
		return new Response(new Uint8Array(bytes), {
			headers: {
				'content-type': safeContentType,
				'cache-control': 'private, max-age=604800, immutable',
				'x-content-type-options': 'nosniff',
				'content-security-policy': "default-src 'none'; sandbox"
			}
		});
	} catch {
		throw error(502, 'candidate artwork fetch failed');
	}
};
