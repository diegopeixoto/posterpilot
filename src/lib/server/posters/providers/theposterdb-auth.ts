import { BROWSER_USER_AGENT } from '$lib/server/ua';

/**
 * ThePosterDB session login.
 *
 * ThePosterDB serves a placeholder image (`missing_poster.jpg`) instead of real artwork
 * to anonymous requests on some poster/title pages — a signed-in session gets the actual
 * assets. This module drives their classic Laravel login form (`GET /login` for a CSRF
 * `_token` + session cookies, `POST /login` with credentials) and returns a `Cookie`
 * header value for subsequent authenticated requests. There is no public API for this,
 * so the form shape is scraped defensively: any layout change surfaces as a clear
 * ThePosterDbAuthError rather than a silent empty result.
 */

const BASE_URL = 'https://theposterdb.com';
const LOGIN_URL = `${BASE_URL}/login`;

export class ThePosterDbAuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ThePosterDbAuthError';
	}
}

/** Extract the Laravel CSRF `_token` hidden-input value from the login page's HTML. */
export function extractLoginToken(html: string): string | null {
	const match = html.match(/name="_token"\s+value="([^"]+)"/);
	return match?.[1] ?? null;
}

/** True when a post-login response looks like the login form re-rendered (i.e. rejected). */
export function looksLikeRejectedLogin(html: string): boolean {
	return /name="_token"\s+value="[^"]+"[\s\S]*name="password"/.test(html);
}

/** Flatten a `Headers`' `Set-Cookie` entries into a single `Cookie` request header value. */
function cookieHeader(res: Response): string {
	return res.headers
		.getSetCookie()
		.map((raw) => raw.split(';')[0])
		.filter((pair) => pair.includes('='))
		.join('; ');
}

/** Merge two `Cookie` header values, letting `overrides` win on same-named cookies. */
function mergeCookies(base: string, overrides: string): string {
	const jar = new Map<string, string>();
	for (const part of `${base}; ${overrides}`.split(';')) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		const eq = trimmed.indexOf('=');
		if (eq === -1) continue;
		jar.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
	}
	return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

/**
 * Sign in to ThePosterDB and return a `Cookie` header value good for subsequent
 * authenticated requests. Throws ThePosterDbAuthError on any failure — bad
 * credentials, an unreachable site, or a page layout this module can't parse.
 */
export async function loginToThePosterDb(username: string, password: string): Promise<string> {
	let getRes: Response;
	try {
		getRes = await fetch(LOGIN_URL, {
			headers: { 'User-Agent': BROWSER_USER_AGENT, Accept: 'text/html' },
			signal: AbortSignal.timeout(15_000)
		});
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		throw new ThePosterDbAuthError(`Could not reach ThePosterDB (${reason}).`);
	}
	if (!getRes.ok) {
		throw new ThePosterDbAuthError(`ThePosterDB login page returned HTTP ${getRes.status}.`);
	}
	const loginPageHtml = await getRes.text();
	const token = extractLoginToken(loginPageHtml);
	if (!token) {
		throw new ThePosterDbAuthError(
			'Could not find the ThePosterDB login form (its page layout may have changed).'
		);
	}
	const preAuthCookie = cookieHeader(getRes);

	const body = new URLSearchParams({ _token: token, login: username, password });
	let postRes: Response;
	try {
		postRes = await fetch(LOGIN_URL, {
			method: 'POST',
			headers: {
				'User-Agent': BROWSER_USER_AGENT,
				Accept: 'text/html',
				'Content-Type': 'application/x-www-form-urlencoded',
				Cookie: preAuthCookie,
				Referer: LOGIN_URL
			},
			body: body.toString(),
			redirect: 'manual',
			signal: AbortSignal.timeout(15_000)
		});
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		throw new ThePosterDbAuthError(`ThePosterDB login request failed (${reason}).`);
	}

	// A successful login redirects (302) away from /login. A rejected one re-renders
	// the login form (200) with the same fields present.
	if (postRes.status === 200) {
		const html = await postRes.text();
		if (looksLikeRejectedLogin(html)) {
			throw new ThePosterDbAuthError('ThePosterDB rejected the username or password.');
		}
	} else if (postRes.status !== 302) {
		throw new ThePosterDbAuthError(`ThePosterDB login returned HTTP ${postRes.status}.`);
	}
	const location = postRes.headers.get('location');
	if (location?.includes('/login')) {
		throw new ThePosterDbAuthError('ThePosterDB rejected the username or password.');
	}

	const postAuthCookie = cookieHeader(postRes);
	if (!postAuthCookie) {
		throw new ThePosterDbAuthError('ThePosterDB did not return a session after login.');
	}
	return mergeCookies(preAuthCookie, postAuthCookie);
}
