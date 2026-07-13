import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runSync } from '$lib/server/kometa/sync';
import { applyRouteError } from '$lib/server/plans/apply-route-error';
import { PRIVATE_NO_STORE_HEADERS, privateNoStore } from '$lib/server/kometa/http-cache';

/** Confirm one exact structured preview. Direct selection writes are rejected. */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	if (typeof body.planId !== 'string' || typeof body.digest !== 'string') {
		return json({ error: 'preview_required' }, { status: 409, headers: PRIVATE_NO_STORE_HEADERS });
	}
	try {
		return json(await runSync({ planId: body.planId, digest: body.digest }), {
			headers: PRIVATE_NO_STORE_HEADERS
		});
	} catch (error) {
		return privateNoStore(applyRouteError(error));
	}
};
