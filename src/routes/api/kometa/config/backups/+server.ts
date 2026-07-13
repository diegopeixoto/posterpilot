import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getBackups } from '$lib/server/kometa/sync';
import { PRIVATE_NO_STORE_HEADERS } from '$lib/server/kometa/http-cache';

/** List the timestamped backups for the configured config.yml. */
export const GET: RequestHandler = async () =>
	json({ backups: await getBackups() }, { headers: PRIVATE_NO_STORE_HEADERS });
