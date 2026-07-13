import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	CollectionSuggestionStoreError,
	stageCollectionFamily
} from '$lib/server/collections/suggestion-store';
import { getActiveServerInstance } from '$lib/server/server-instances';

function statusFor(errorCode: CollectionSuggestionStoreError['code']): number {
	if (errorCode === 'collection_not_found') return 404;
	if (errorCode === 'collection_suggestion_stale') return 409;
	return 400;
}

export const POST: RequestHandler = async ({ params, request }) => {
	const active = await getActiveServerInstance();
	if (!active) throw error(404, 'collection_not_found');
	const body = (await request.json().catch(() => null)) as { suggestionId?: unknown } | null;
	if (typeof body?.suggestionId !== 'string') {
		throw error(400, 'invalid_collection_suggestion_request');
	}
	try {
		const result = await stageCollectionFamily(active.id, params.id, body.suggestionId);
		return json({ ok: true, ...result });
	} catch (cause) {
		if (cause instanceof CollectionSuggestionStoreError) {
			throw error(statusFor(cause.code), cause.code);
		}
		throw cause;
	}
};
