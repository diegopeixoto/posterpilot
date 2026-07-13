import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readNativeCollectionCurrentArtwork } from '$lib/server/collections/native-artwork-runtime';
import { safeStagedArtworkContentType } from '$lib/server/collections/staged-artwork-url';
import { getActiveServerInstance } from '$lib/server/server-instances';

export const GET: RequestHandler = async ({ params }) => {
	if (params.kind !== 'poster' && params.kind !== 'background') throw error(400, 'invalid_request');
	const active = await getActiveServerInstance();
	if (!active) throw error(404, 'server_instance_not_found');
	try {
		const artwork = await readNativeCollectionCurrentArtwork(active.id, params.id, params.kind);
		if (!artwork) throw error(404, 'native_collection_artwork_not_found');
		const contentType = safeStagedArtworkContentType(artwork.contentType ?? '');
		if (!contentType) throw error(415, 'native_collection_artwork_type_invalid');
		return new Response(new Uint8Array(artwork.data), {
			headers: {
				'content-type': contentType,
				'cache-control': 'private, no-store',
				'x-content-type-options': 'nosniff',
				'content-security-policy': "default-src 'none'; sandbox"
			}
		});
	} catch (caught) {
		if (caught && typeof caught === 'object' && 'status' in caught) throw caught;
		throw error(502, 'native_collection_artwork_fetch_failed');
	}
};
