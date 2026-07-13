import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ensurePlexClientId } from '$lib/server/config';
import { createPin, PlexAuthError } from '$lib/server/media-server/plex-auth';

/**
 * Create a strong plex.tv PIN. Returns the pin id + code to show the user (who
 * authorizes it at https://plex.tv/link). The client polls GET /api/plex/pin/[id]
 * until the token is acquired and stored.
 */
export const POST: RequestHandler = async () => {
	try {
		const clientId = await ensurePlexClientId();
		const pin = await createPin(clientId);
		return json({
			id: pin.id,
			code: pin.code,
			expiresAt: pin.expiresAt,
			authUrl: `https://app.plex.tv/auth#?clientID=${encodeURIComponent(
				clientId
			)}&code=${encodeURIComponent(pin.code)}&context%5Bdevice%5D%5Bproduct%5D=PosterPilot`,
			linkUrl: 'https://plex.tv/link'
		});
	} catch (e) {
		// Only curated plex.tv error text is safe to surface; anything else stays generic.
		const message = e instanceof PlexAuthError ? e.message : 'Plex sign-in failed unexpectedly.';
		return json({ error: message }, { status: 502 });
	}
};
