import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getAuthState } from '$lib/server/config';
import { verifyPassword } from '$lib/server/auth/password';
import { safeRedirectTarget } from '$lib/server/auth/guard';
import { FAILURE_DELAY_MS } from '$lib/server/auth/login-throttle';
import { issueSessionCookie, loginThrottle } from '$lib/server/auth/server';
import { logEvent } from '$lib/server/events';

/** If auth is off (or already satisfied), there is nothing to log in to. */
export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.authMode === 'disabled') throw redirect(303, '/');
	if (locals.authed)
		throw redirect(303, safeRedirectTarget(url.searchParams.get('redirectTo')) ?? '/');
	return {};
};

function clientKey(getClientAddress: () => string): string {
	try {
		return getClientAddress();
	} catch {
		return 'unknown';
	}
}

export const actions: Actions = {
	default: async ({ request, cookies, url, getClientAddress }) => {
		const form = await request.formData();
		const username = String(form.get('username') ?? '');
		const password = String(form.get('password') ?? '');
		const redirectTo = safeRedirectTarget(String(form.get('redirectTo') ?? '')) ?? '/';
		const key = clientKey(getClientAddress);
		const now = Date.now();

		if (loginThrottle.isLocked(key, now)) {
			await logEvent('warn', 'auth', 'Login blocked (throttled)', { client: key });
			return fail(429, { error: 'locked', username });
		}

		const state = await getAuthState();
		// Guard against the fail-open state (mode disabled with no creds).
		if (state.mode === 'disabled') throw redirect(303, '/');

		const ok =
			!!state.username &&
			!!state.passwordHash &&
			username === state.username &&
			(await verifyPassword(password, state.passwordHash));

		if (!ok) {
			const locked = loginThrottle.recordFailure(key, now);
			await new Promise((r) => setTimeout(r, FAILURE_DELAY_MS));
			await logEvent('warn', 'auth', 'Login failed', { client: key, locked });
			return fail(401, { error: locked ? 'locked' : 'invalid', username });
		}

		loginThrottle.reset(key);
		issueSessionCookie(
			cookies,
			state.username!,
			state.sessionVersion,
			url.protocol === 'https:',
			now
		);
		await logEvent('info', 'auth', 'Login success', { user: state.username, client: key });
		throw redirect(303, redirectTo);
	}
};
