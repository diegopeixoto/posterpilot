import { type Handle, json, redirect } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { env } from '$env/dynamic/private';
import { migrateDb } from '$lib/server/db';
import { markInterruptedJobs } from '$lib/server/jobs/runner';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { registerServerLocaleStrategy } from '$lib/i18n/strategy.server';
import { getAuthState } from '$lib/server/config';
import { warnIfKeyFileInsecure } from '$lib/server/secrets/key';
import { classifyPath, safeRedirectTarget } from '$lib/server/auth/guard';
import { decideLocalBypass } from '$lib/server/auth/local-address';
import { verifySessionToken } from '$lib/server/auth/session';
import { getSessionKey, issueSessionCookie, SESSION_COOKIE } from '$lib/server/auth/server';

// Run database migrations once at server startup, before any request is handled.
await migrateDb();

// Any job left "pending"/"running" by a previous crash is marked interrupted.
await markInterruptedJobs();

// Boot-time hygiene: warn if the encryption key file is group/world-accessible.
warnIfKeyFileInsecure();

// Register the highest-precedence "custom-setting" locale strategy (reads the
// persisted `language` app setting) before any request is handled.
registerServerLocaleStrategy();

/**
 * Optional authentication guard. Runs before Paraglide. Resolves the effective auth
 * mode (env override + fail-open guard live in `getAuthState`), applies the `local`
 * bypass, verifies the session cookie, and enforces the route guard: public routes
 * pass through, other APIs get `401` JSON, other pages redirect to `/login`.
 */
const handleAuth: Handle = async ({ event, resolve }) => {
	const auth = await getAuthState();
	event.locals.authMode = auth.mode;
	event.locals.authed = false;
	event.locals.authUser = null;

	// Auth off → everything is allowed; nothing to check.
	if (auth.mode === 'disabled') {
		event.locals.authed = true;
		return resolve(event);
	}

	// `local` mode: local addresses always win (bypass unconditionally). Fail-closed
	// behind a proxy that isn't explicitly trusted.
	if (auth.mode === 'local') {
		const headers = event.request.headers;
		const hasForwardedHeader = headers.has('x-forwarded-for') || headers.has('forwarded');
		let clientAddress: string | null = null;
		try {
			clientAddress = event.getClientAddress();
		} catch {
			clientAddress = null;
		}
		const bypass = decideLocalBypass({
			clientAddress,
			addressHeaderConfigured: !!env.ADDRESS_HEADER && env.ADDRESS_HEADER !== '',
			hasForwardedHeader
		});
		if (bypass) {
			event.locals.authed = true;
			return resolve(event);
		}
	}

	// Verify the session cookie.
	const now = Date.now();
	const token = event.cookies.get(SESSION_COOKIE);
	const verified = verifySessionToken(token, auth.sessionVersion, getSessionKey(), now);
	if (verified) {
		event.locals.authed = true;
		event.locals.authUser = verified.payload.u;
		// Sliding expiry: re-issue an active-but-aging token so the user never expires.
		if (verified.needsRefresh) {
			issueSessionCookie(
				event.cookies,
				verified.payload.u,
				auth.sessionVersion,
				event.url.protocol === 'https:',
				now
			);
		}
		return resolve(event);
	}

	// Unauthenticated — decide how to reject based on the route class.
	const cls = classifyPath(event.url.pathname);
	if (cls === 'public') return resolve(event);
	if (cls === 'api') return json({ error: 'unauthorized' }, { status: 401 });

	const redirectTo = safeRedirectTarget(event.url.pathname + event.url.search) ?? '/';
	throw redirect(303, `/login?redirectTo=${encodeURIComponent(redirectTo)}`);
};

/**
 * Baseline security response headers on every response. HSTS only over HTTPS (an
 * HTTP LAN install must not receive it), mirroring the conditional `Secure` cookie.
 */
const handleSecurityHeaders: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Content-Security-Policy', "frame-ancestors 'none'");
	response.headers.set('Referrer-Policy', 'same-origin');
	response.headers.set('X-Robots-Tag', 'noindex');
	if (event.url.protocol === 'https:') {
		response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}
	return response;
};

/**
 * Resolve the active locale per request via Paraglide (custom-setting setting →
 * Accept-Language → English) and make it the ambient locale for SSR. The resolved
 * locale is stashed on `event.locals` for the root layout load.
 */
const handleParaglide: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ request, locale }) => {
		event.locals.locale = locale;
		return resolve(
			{ ...event, request },
			{
				transformPageChunk: ({ html }) => html.replace('%lang%', locale)
			}
		);
	});

export const handle: Handle = sequence(handleSecurityHeaders, handleAuth, handleParaglide);
