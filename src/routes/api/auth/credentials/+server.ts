import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import {
	getAuthState,
	isAuthModeEnvManaged,
	setStoredAuthMode,
	setAuthCredentials,
	bumpAuthSessionVersion
} from '$lib/server/config';
import { hashPassword } from '$lib/server/auth/password';
import { issueSessionCookie } from '$lib/server/auth/server';
import { logEvent } from '$lib/server/events';

const bodySchema = z.object({
	mode: z.enum(['disabled', 'enabled', 'local']),
	username: z.string().trim().min(1).max(200).optional(),
	// Password is never trimmed; empty string means "unchanged".
	password: z.string().min(1).max(1024).optional()
});

/**
 * Set the auth mode and/or credentials. Enabling requires credentials (already
 * stored or supplied). On a credential change the session version is bumped
 * (invalidating other sessions) and a fresh cookie is issued to the requester in
 * the same response, so whoever just enabled auth is not logged out by their own
 * save. Disabling preserves stored credentials. The password is never logged.
 */
export const POST: RequestHandler = async ({ request, cookies, url }) => {
	// The mode is locked while AUTH_MODE is set in the environment.
	if (isAuthModeEnvManaged()) {
		return json(
			{ error: 'auth mode is locked by the AUTH_MODE environment variable' },
			{ status: 409 }
		);
	}

	const parsed = bodySchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		return json({ error: 'invalid request' }, { status: 400 });
	}
	const { mode, username, password } = parsed.data;

	const state = await getAuthState();
	const isHttps = url.protocol === 'https:';

	// Determine the resulting credentials.
	const finalUsername = username ?? state.username;
	const changingPassword = password !== undefined;
	const willHaveCredentials = !!finalUsername && (changingPassword || !!state.passwordHash);

	if (mode !== 'disabled' && !willHaveCredentials) {
		return json(
			{ error: 'enabling authentication requires a username and password' },
			{ status: 400 }
		);
	}

	// Persist credentials if a new password (and/or username) was supplied.
	let sessionVersion = state.sessionVersion;
	if (changingPassword) {
		if (!finalUsername) {
			return json({ error: 'a username is required to set a password' }, { status: 400 });
		}
		const hash = await hashPassword(password);
		await setAuthCredentials(finalUsername, hash);
		sessionVersion = await bumpAuthSessionVersion(); // invalidate existing sessions
	} else if (username && username !== state.username) {
		// Username-only change (keep the existing hash).
		if (state.passwordHash) await setAuthCredentials(username, state.passwordHash);
	}

	await setStoredAuthMode(mode);

	// Keep the author logged in: issue a fresh cookie for the (now-current) version
	// whenever auth ends up enabled.
	if (mode !== 'disabled' && finalUsername) {
		issueSessionCookie(cookies, finalUsername, sessionVersion, isHttps, Date.now());
	}

	await logEvent(
		'info',
		'auth',
		`Authentication ${mode === 'disabled' ? 'disabled' : `set to ${mode}`}`,
		{
			mode,
			credentialsChanged: changingPassword
		}
	);

	return json({ ok: true, mode });
};
