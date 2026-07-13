import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { TmdbMediaType } from '$lib/server/types';
import { ManualMatchError } from '$lib/server/tmdb/manual-match';
import {
	manualMatchErrorResponse,
	parseManualMatchScope,
	readManualMatchBody
} from '$lib/server/tmdb/manual-match-http';
import {
	clearManualTmdbMatch,
	confirmManualTmdbMatch
} from '$lib/server/tmdb/manual-match-runtime';

function mediaType(value: unknown): TmdbMediaType {
	if (value !== 'movie' && value !== 'tv') throw new ManualMatchError('invalid_request');
	return value;
}

export const POST: RequestHandler = async ({ params, request, locals }) => {
	try {
		const { serverInstanceId, itemId } = parseManualMatchScope(params);
		const body = await readManualMatchBody(request);
		if (typeof body.tmdbId !== 'string') throw new ManualMatchError('invalid_request');
		const item = await confirmManualTmdbMatch(serverInstanceId, itemId, {
			tmdbId: body.tmdbId,
			mediaType: mediaType(body.mediaType),
			language: locals.locale
		});
		return json({ item });
	} catch (error) {
		return manualMatchErrorResponse(error);
	}
};

export const DELETE: RequestHandler = async ({ params }) => {
	try {
		const { serverInstanceId, itemId } = parseManualMatchScope(params);
		return json(await clearManualTmdbMatch(serverInstanceId, itemId));
	} catch (error) {
		return manualMatchErrorResponse(error);
	}
};
