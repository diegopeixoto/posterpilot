import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseSelectionInput } from '$lib/server/kometa/selection';
import { previewSync } from '$lib/server/kometa/sync';

/** Compute the diff a Kometa config sync would make. Never writes. */
export const POST: RequestHandler = async ({ request }) => {
	const sel = parseSelectionInput(await request.json().catch(() => ({})));
	return json(await previewSync(sel));
};
