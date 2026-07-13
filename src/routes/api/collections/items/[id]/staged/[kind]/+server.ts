import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveConfig } from '$lib/server/config';
import {
	safeStagedArtworkContentType,
	safeStagedArtworkUrl
} from '$lib/server/collections/staged-artwork-url';
import { getMediaItem } from '$lib/server/queries';
import { getActiveServerInstance } from '$lib/server/server-instances';
import { getOrFetchThumb } from '$lib/server/posters/thumb-cache';

const DAY_MS = 86_400_000;
const MB = 1024 * 1024;

/** Credentials-safe image projection for a member's current staged root slot. */
export const GET: RequestHandler = async ({ params }) => {
	const id = Number(params.id);
	if (!Number.isSafeInteger(id) || id <= 0) throw error(400, 'invalid id');
	if (params.kind !== 'poster' && params.kind !== 'background') throw error(400, 'invalid kind');

	const active = await getActiveServerInstance();
	if (!active) throw error(404, 'server instance not found');
	const item = await getMediaItem(id, active.id);
	if (!item) throw error(404, 'item not found');
	const selected = params.kind === 'poster' ? item.selectedPosterUrl : item.selectedBackgroundUrl;
	const source = selected ? safeStagedArtworkUrl(selected) : null;
	if (!source) throw error(404, 'staged artwork not available');

	try {
		const config = await resolveConfig();
		const { bytes, contentType } = await getOrFetchThumb(source, {
			ttlMs: config.thumbCacheTtlDays * DAY_MS,
			maxBytes: config.thumbCacheMaxMb * MB
		});
		const safeContentType = safeStagedArtworkContentType(contentType);
		if (!safeContentType) throw new Error('unsupported staged artwork type');
		return new Response(new Uint8Array(bytes), {
			headers: {
				'content-type': safeContentType,
				'cache-control': 'private, max-age=604800, immutable',
				'x-content-type-options': 'nosniff',
				'content-security-policy': "default-src 'none'; sandbox"
			}
		});
	} catch {
		throw error(502, 'staged artwork fetch failed');
	}
};
