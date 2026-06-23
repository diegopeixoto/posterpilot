import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ensurePlexClientId, saveSettings } from '$lib/server/config';
import { pollPin } from '$lib/server/media-server/plex-auth';
import { logEvent } from '$lib/server/events';

/**
 * Poll a plex.tv PIN. On success, persist the acquired token as `plexToken` and
 * report `{ authorized: true }` (without echoing the token). While pending,
 * reports `{ authorized: false }`.
 */
export const GET: RequestHandler = async ({ params }) => {
	const id = Number.parseInt(params.id ?? '', 10);
	if (!Number.isFinite(id)) {
		return json({ error: 'Invalid PIN id' }, { status: 400 });
	}
	try {
		const clientId = await ensurePlexClientId();
		const token = await pollPin(id, clientId);
		if (token) {
			await saveSettings({ plexToken: token, serverType: 'plex' });
			await logEvent('info', 'settings', 'Plex connected (signed in via PIN)');
			return json({ authorized: true });
		}
		return json({ authorized: false });
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
	}
};
