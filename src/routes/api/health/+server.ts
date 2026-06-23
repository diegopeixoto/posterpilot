import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { version } from '$lib/version';

/**
 * Unauthenticated health probe for container orchestrators (Docker/Unraid).
 * Returns 200 with the app status and version; performs no I/O.
 */
export const GET: RequestHandler = () => json({ status: 'ok', version });
