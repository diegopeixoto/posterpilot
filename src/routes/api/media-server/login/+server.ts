import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { saveSettings } from '$lib/server/config';
import { loginByName, MediaServerLoginError } from '$lib/server/media-server/emby';
import { logEvent } from '$lib/server/events';
import { materializeLegacyServerInstance } from '$lib/server/server-instances';

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
		// Make this the active server too, so the freshly stored credentials are
		// actually used (otherwise tests/syncs keep resolving the previous server
		// until the user separately presses Save).
		if (flavor === 'jellyfin') {
			await saveSettings({
				serverType: 'jellyfin',
				jellyfinUrl: baseUrl,
				jellyfinApiKey: result.accessToken
			});
		} else {
			await saveSettings({ serverType: 'emby', embyUrl: baseUrl, embyApiKey: result.accessToken });
		}
		await materializeLegacyServerInstance();
		await logEvent('info', 'settings', `Logged in to ${flavor}`, { user: result.userName });
		return json({ ok: true, userName: result.userName });
	} catch (e) {
		// 401 for rejected credentials, 502 for upstream/network failures. Only the
		// curated login-error text is safe to surface; anything unexpected stays generic.
		if (e instanceof MediaServerLoginError) {
			return json({ error: e.message }, { status: e.status });
		}
		return json({ error: 'Login failed unexpectedly. Check the server logs.' }, { status: 502 });
	}
};
