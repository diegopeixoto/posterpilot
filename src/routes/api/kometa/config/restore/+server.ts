import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { confirmRestoreConfig, previewRestoreConfig } from '$lib/server/kometa/sync';
import { applyRouteError } from '$lib/server/plans/apply-route-error';
import { PRIVATE_NO_STORE_HEADERS, privateNoStore } from '$lib/server/kometa/http-cache';

/** Preview a named backup against current config.yml. Never writes. */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as { name?: unknown };
	const name = typeof body.name === 'string' ? body.name : '';
	return json(await previewRestoreConfig(name), { headers: PRIVATE_NO_STORE_HEADERS });
};

/** Confirm an unchanged, single-use restore preview. */
export const PUT: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	if (typeof body.planId !== 'string' || typeof body.digest !== 'string') {
		return json({ error: 'preview_required' }, { status: 409, headers: PRIVATE_NO_STORE_HEADERS });
	}
	try {
		return json(await confirmRestoreConfig({ planId: body.planId, digest: body.digest }), {
			headers: PRIVATE_NO_STORE_HEADERS
		});
	} catch (error) {
		return privateNoStore(applyRouteError(error));
	}
};
