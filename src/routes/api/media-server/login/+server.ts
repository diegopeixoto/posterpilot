import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { saveSettings } from '$lib/server/config';
import { loginByName } from '$lib/server/media-server/emby';
import { logEvent } from '$lib/server/events';

/**
 * Log in to Jellyfin/Emby with a username + password, exchanging them for an access
 * token that is stored (encrypted) as the server's credential — so the user never
 * has to hunt for an API key. The password is used only for this request and is
 * never persisted.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as {
		flavor?: string;
		baseUrl?: string;
		username?: string;
		password?: string;
	};
	const flavor = body.flavor;
	if (flavor !== 'jellyfin' && flavor !== 'emby') {
		return json({ error: 'Unknown media-server type.' }, { status: 400 });
	}
	const baseUrl = (body.baseUrl ?? '').trim();
	const username = (body.username ?? '').trim();
	const password = body.password ?? '';
	if (!baseUrl || !username) {
		return json({ error: 'A server URL and username are required.' }, { status: 400 });
	}
	try {
		const result = await loginByName(baseUrl, username, password, flavor);
		if (flavor === 'jellyfin') {
			await saveSettings({ jellyfinUrl: baseUrl, jellyfinApiKey: result.accessToken });
		} else {
			await saveSettings({ embyUrl: baseUrl, embyApiKey: result.accessToken });
		}
		await logEvent('info', 'settings', `Logged in to ${flavor}`, { user: result.userName });
		return json({ ok: true, userName: result.userName });
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
	}
};
