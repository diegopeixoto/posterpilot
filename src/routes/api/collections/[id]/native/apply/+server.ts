import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { nativeCollectionArtworkErrorResponse } from '$lib/server/collections/native-artwork-http';
import { confirmNativeCollectionArtwork } from '$lib/server/collections/native-artwork-runtime';
import { maintenanceResponse } from '$lib/server/maintenance-http';
import { getActiveServerInstance } from '$lib/server/server-instances';

export const POST: RequestHandler = async ({ params, request }) => {
	const blocked = maintenanceResponse();
	if (blocked) return blocked;
	const body = (await request.json().catch(() => null)) as {
		planId?: string;
		digest?: string;
	} | null;
	if (
		!params.id ||
		!body?.planId ||
		!body.digest ||
		Object.keys(body).some((key) => key !== 'planId' && key !== 'digest')
	) {
		return json({ error: { code: 'plan_confirmation_required' } }, { status: 400 });
	}
	const active = await getActiveServerInstance();
	if (!active) return json({ error: { code: 'server_instance_not_found' } }, { status: 404 });
	try {
		return json(
			await confirmNativeCollectionArtwork({
				serverInstanceId: active.id,
				mediaCollectionId: params.id,
				planId: body.planId,
				digest: body.digest
			})
		);
	} catch (error) {
		return nativeCollectionArtworkErrorResponse(error);
	}
};
