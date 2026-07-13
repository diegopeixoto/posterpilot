import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { nativeCollectionArtworkErrorResponse } from '$lib/server/collections/native-artwork-http';
import { getNativeCollectionArtworkWorkspace } from '$lib/server/collections/native-artwork-runtime';
import { getActiveServerInstance } from '$lib/server/server-instances';

export const GET: RequestHandler = async ({ params }) => {
	if (!params.id) return json({ error: { code: 'invalid_request' } }, { status: 400 });
	const active = await getActiveServerInstance();
	if (!active) return json({ error: { code: 'server_instance_not_found' } }, { status: 404 });
	try {
		return json(await getNativeCollectionArtworkWorkspace(active.id, params.id));
	} catch (error) {
		return nativeCollectionArtworkErrorResponse(error);
	}
};
