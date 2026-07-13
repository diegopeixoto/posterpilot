import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { nativeCollectionArtworkErrorResponse } from '$lib/server/collections/native-artwork-http';
import { previewNativeCollectionArtwork } from '$lib/server/collections/native-artwork-runtime';
import { getActiveServerInstance } from '$lib/server/server-instances';

export const POST: RequestHandler = async ({ params, request }) => {
	const body = (await request.json().catch(() => null)) as {
		selections?: { poster?: string; background?: string };
	} | null;
	if (
		!params.id ||
		!body ||
		Object.keys(body).some((key) => key !== 'selections') ||
		!body.selections ||
		Object.keys(body.selections).some((key) => key !== 'poster' && key !== 'background')
	) {
		return json({ error: { code: 'invalid_request' } }, { status: 400 });
	}
	const active = await getActiveServerInstance();
	if (!active) return json({ error: { code: 'server_instance_not_found' } }, { status: 404 });
	try {
		return json(
			await previewNativeCollectionArtwork({
				serverInstanceId: active.id,
				mediaCollectionId: params.id,
				selections: body.selections
			})
		);
	} catch (error) {
		return nativeCollectionArtworkErrorResponse(error);
	}
};
