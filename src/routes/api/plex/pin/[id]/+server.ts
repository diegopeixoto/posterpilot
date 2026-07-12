import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ensurePlexClientId, saveSettings } from '$lib/server/config';
import { PlexAuthError, pollPin } from '$lib/server/media-server/plex-auth';
import { logEvent } from '$lib/server/events';
import { materializeLegacyServerInstance } from '$lib/server/server-instances';

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
			await materializeLegacyServerInstance();
			await logEvent('info', 'settings', 'Plex connected (signed in via PIN)');
			return json({ authorized: true });
		}
		return json({ authorized: false });
	} catch (e) {
		// Only curated plex.tv error text is safe to surface; anything else stays generic.
		const message = e instanceof PlexAuthError ? e.message : 'Plex sign-in failed unexpectedly.';
		return json({ error: message }, { status: 502 });
	}
};
