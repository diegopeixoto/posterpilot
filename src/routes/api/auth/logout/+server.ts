import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clearSessionCookie } from '$lib/server/auth/server';
import { logEvent } from '$lib/server/events';

/** Clear the session cookie. Public route (reachable while unauthenticated). */
export const POST: RequestHandler = async ({ cookies, url, locals }) => {
	clearSessionCookie(cookies, url.protocol === 'https:');
	if (locals.authUser) {
		await logEvent('info', 'auth', 'Logout', { user: locals.authUser });
	}
	return json({ ok: true });
};
