import { type Handle, json, redirect } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { env } from '$env/dynamic/private';
import { db, migrateDb, restoreBootResult } from '$lib/server/db';
import { recoverInterruptedRevisionGroups } from '$lib/server/artwork-revisions/group-recovery';
import { finalizeApplicationRestoreBoot } from '$lib/server/backups/restore-boot';
import { enqueueJobDetailed, markInterruptedJobs } from '$lib/server/jobs/runner';
import {
	configureAutomationScheduler,
	startAutomationScheduler
} from '$lib/server/automation/scheduler-runtime';
import { materializeLegacyServerInstance } from '$lib/server/server-instances';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { registerServerLocaleStrategy } from '$lib/i18n/strategy.server';
import { getAuthState } from '$lib/server/config';
import { warnIfKeyFileInsecure } from '$lib/server/secrets/key';
import { classifyPath, safeRedirectTarget } from '$lib/server/auth/guard';
import { decideLocalBypass } from '$lib/server/auth/local-address';
import { verifySessionToken } from '$lib/server/auth/session';
import { getSessionKey, issueSessionCookie, SESSION_COOKIE } from '$lib/server/auth/server';
import { pruneOperationPlans } from '$lib/server/plans/operation-plan-store';
import { maintenanceMode } from '$lib/server/maintenance';
import { maintenanceBlocksRequest } from '$lib/server/maintenance-http';
import { reconcileThumbCacheDisk } from '$lib/server/posters/thumb-cache';

// Run database migrations once at server startup, before any request is handled.
await migrateDb();

// A staged restore is not committed until migrations and local readiness pass.
// On failure the pending marker remains, so the next boot restores rollback state.
await finalizeApplicationRestoreBoot(restoreBootResult);

// Preserve the existing environment/persisted single-server connection as the
// protected default instance before any scoped job or request can resolve it.
await materializeLegacyServerInstance();

// Migration 0008 wiped the thumbnail index (credential-bearing cached URLs must
// not survive) but could not touch the files; drop any bytes with no index row
// before requests or recovered jobs can write new entries.
await reconcileThumbCacheDisk().catch(() => undefined);

// Mutation previews are ephemeral and may freeze sensitive configuration. Remove
// expired plans immediately and consumed plans after a short audit/debug window.
const PLAN_CONSUMED_RETENTION_MS = 24 * 60 * 60 * 1000;
const PLAN_PRUNE_INTERVAL_MS = 60 * 60 * 1000;
async function pruneEphemeralPlans(): Promise<void> {
	await pruneOperationPlans({
		consumedBefore: new Date(Date.now() - PLAN_CONSUMED_RETENTION_MS)
	});
}
await pruneEphemeralPlans();
const operationPlanPruner = setInterval(() => {
	void pruneEphemeralPlans().catch(() => undefined);
}, PLAN_PRUNE_INTERVAL_MS);
operationPlanPruner.unref();

// Configure scheduling before durable recovery can resume a sync that emits an
// automation event. The scheduler module deliberately does not import the worker.
configureAutomationScheduler((payload, options) => enqueueJobDetailed(payload, options));

// Re-enter durable pending/retry work and recover only expired worker leases.
await markInterruptedJobs();

// Request-scoped undo/upload groups have no job to recover them: a restart
// mid-execution leaves them `pending` forever. Close them from the outcomes
// recorded before the interruption so history never shows a phantom run.
await recoverInterruptedRevisionGroups(db).catch(() => undefined);

// Poll persisted interval/calendar occurrences after recovery. The timer is
// unreferenced so it never delays process shutdown.
startAutomationScheduler();

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
			// getClientAddress() can throw; leave clientAddress null (treated as non-local).
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

// Once a restore is staged (maintenance mode), every write would be silently
// discarded by the boot-time database swap. Individual runtimes assert this
// invariant too, but the blanket gate here means new endpoints inherit it
// instead of each author having to remember `assertMutationsAllowed()`.
const handleMaintenance: Handle = async ({ event, resolve }) => {
	if (maintenanceMode() && maintenanceBlocksRequest(event.url.pathname, event.request.method)) {
		return json({ error: { code: 'maintenance_mode' } }, { status: 503 });
	}
	return resolve(event);
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

export const handle: Handle = sequence(
	handleSecurityHeaders,
	handleAuth,
	handleMaintenance,
	handleParaglide
);
