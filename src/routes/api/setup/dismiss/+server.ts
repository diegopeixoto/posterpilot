import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setSetupDismissed } from '$lib/server/setup-state';

export const POST: RequestHandler = async () => {
	await setSetupDismissed(true);
	return json({ ok: true });
};
