import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseSelectionInput } from '$lib/server/kometa/selection';
import { runSync } from '$lib/server/kometa/sync';

/** Apply the Kometa config sync: atomic write + backup, persist selections. */
export const POST: RequestHandler = async ({ request }) => {
	const sel = parseSelectionInput(await request.json().catch(() => ({})));
	return json(await runSync(sel));
};
