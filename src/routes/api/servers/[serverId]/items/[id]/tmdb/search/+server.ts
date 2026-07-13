import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ManualMatchError } from '$lib/server/tmdb/manual-match';
import {
	manualMatchErrorResponse,
	parseManualMatchScope
} from '$lib/server/tmdb/manual-match-http';
import { searchManualTmdb } from '$lib/server/tmdb/manual-match-runtime';
import type { TmdbManualSearchType } from '$lib/server/tmdb/manual-search';

function searchType(value: string | null): TmdbManualSearchType {
	const type = value ?? 'both';
	if (type !== 'movie' && type !== 'tv' && type !== 'both') {
		throw new ManualMatchError('invalid_request');
	}
	return type;
}

export const GET: RequestHandler = async ({ params, url, locals }) => {
	try {
		const { serverInstanceId, itemId } = parseManualMatchScope(params);
		const rawYear = url.searchParams.get('year');
		const year = rawYear === null ? undefined : Number(rawYear);
		const results = await searchManualTmdb(serverInstanceId, itemId, {
			query: url.searchParams.get('q') ?? '',
			year,
			mediaType: searchType(url.searchParams.get('type')),
			language: locals.locale
		});
		return json({ results });
	} catch (error) {
		return manualMatchErrorResponse(error);
	}
};
