import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	manualMatchErrorResponse,
	parseManualMatchScope
} from '$lib/server/tmdb/manual-match-http';
import { listTmdbResolutionAudit } from '$lib/server/tmdb/manual-match-runtime';

export const GET: RequestHandler = async ({ params }) => {
	try {
		const { serverInstanceId, itemId } = parseManualMatchScope(params);
		return json({ entries: await listTmdbResolutionAudit(serverInstanceId, itemId) });
	} catch (error) {
		return manualMatchErrorResponse(error);
	}
};
