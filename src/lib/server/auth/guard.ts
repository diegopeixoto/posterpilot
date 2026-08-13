/**
 * Route classification + redirect safety for the auth guard. Pure and `$env`-free.
 *
 * The guard hook uses `classifyPath` to decide how an unauthenticated request is
 * handled (public passthrough, `401` JSON for APIs, or redirect for pages) and
 * `safeRedirectTarget` to sanitize the `redirectTo` value against open redirects.
 */

export type PathClass = 'public' | 'api' | 'page';

// Exact paths reachable without a session.
const PUBLIC_EXACT = new Set(['/api/health', '/api/ready', '/login', '/api/auth/logout']);
// Probes must still answer when the settings database is failed or wedged. Other
// public routes (especially `/login`) need the real auth state in `locals`.
const AUTH_STATE_INDEPENDENT_EXACT = new Set(['/api/health', '/api/ready']);
// Static assets served from the app root that stay public.
const STATIC_EXT =
	/\.(?:ico|png|jpe?g|svg|webp|gif|css|js|mjs|woff2?|ttf|map|webmanifest|txt|xml)$/i;

/** Classify a request path for the auth guard. */
export function classifyPath(pathname: string): PathClass {
	if (PUBLIC_EXACT.has(pathname)) return 'public';
	if (pathname.startsWith('/api/automation-webhooks/')) return 'public';
	if (pathname.startsWith('/_app/')) return 'public';
	if (STATIC_EXT.test(pathname)) return 'public';
	if (pathname.startsWith('/api/')) return 'api';
	return 'page';
}

/** True only for probes that must bypass the database-backed auth-state lookup. */
export function bypassesAuthStateLookup(pathname: string): boolean {
	return AUTH_STATE_INDEPENDENT_EXACT.has(pathname);
}

/**
 * Sanitize a `redirectTo` value into a safe same-site path, or `null` if unsafe.
 * Must be an absolute path (`/…`), not protocol-relative (`//`), and free of
 * backslashes (which some browsers normalize to `/`).
 */
export function safeRedirectTarget(target: string | null | undefined): string | null {
	if (!target) return null;
	if (!target.startsWith('/')) return null;
	if (target.startsWith('//')) return null;
	if (target.includes('\\')) return null;
	return target;
}
