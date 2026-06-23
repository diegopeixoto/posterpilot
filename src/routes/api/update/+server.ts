import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkForUpdate } from '$lib/server/update';

/** Client-polled update check (cached server-side). Non-blocking for page loads. */
export const GET: RequestHandler = async () => json(await checkForUpdate());
