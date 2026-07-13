import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { confirmRawConfig, loadRaw, previewRawConfig } from '$lib/server/kometa/sync';
import { applyRouteError } from '$lib/server/plans/apply-route-error';
import { PRIVATE_NO_STORE_HEADERS, privateNoStore } from '$lib/server/kometa/http-cache';

/** Read the current raw config.yml text (for the raw editor). */
export const GET: RequestHandler = async () =>
	json(await loadRaw(), { headers: PRIVATE_NO_STORE_HEADERS });

/** Validate + preview raw config.yml text. This endpoint never writes. */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as { text?: unknown };
	const text = typeof body.text === 'string' ? body.text : '';
	return json(await previewRawConfig(text), { headers: PRIVATE_NO_STORE_HEADERS });
};

/** Confirm an unchanged, single-use raw preview. */
export const PUT: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	if (typeof body.planId !== 'string' || typeof body.digest !== 'string') {
		return json({ error: 'preview_required' }, { status: 409, headers: PRIVATE_NO_STORE_HEADERS });
	}
	try {
		return json(await confirmRawConfig({ planId: body.planId, digest: body.digest }), {
			headers: PRIVATE_NO_STORE_HEADERS
		});
	} catch (error) {
		return privateNoStore(applyRouteError(error));
	}
};
