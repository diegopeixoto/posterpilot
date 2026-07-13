import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listNativeCollectionArtworkHistory } from '$lib/server/collections/native-artwork-runtime';
import { getActiveServerInstance } from '$lib/server/server-instances';

export const GET: RequestHandler = async ({ params }) => {
	const active = await getActiveServerInstance();
	if (!active) return json({ error: { code: 'server_instance_not_found' } }, { status: 404 });
	try {
		return json({ entries: await listNativeCollectionArtworkHistory(active.id, params.id) });
	} catch {
		return json({ error: { code: 'native_collection_history_failed' } }, { status: 500 });
	}
};
