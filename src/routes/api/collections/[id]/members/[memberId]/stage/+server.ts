import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	clearCollectionMemberSelection,
	CollectionSuggestionStoreError,
	stageCollectionMemberCandidate
} from '$lib/server/collections/suggestion-store';
import { getActiveServerInstance } from '$lib/server/server-instances';

function statusFor(errorCode: CollectionSuggestionStoreError['code']): number {
	if (errorCode === 'collection_not_found') return 404;
	if (
		errorCode === 'collection_member_scope_mismatch' ||
		errorCode === 'collection_candidate_scope_mismatch'
	) {
		return 404;
	}
	return 400;
}

function mediaItemId(value: string): number {
	const id = Number(value);
	if (!Number.isSafeInteger(id) || id <= 0)
		throw error(400, 'invalid_collection_suggestion_request');
	return id;
}

async function run(
	params: { id: string; memberId: string },
	request: Request,
	action: 'stage' | 'clear'
) {
	const active = await getActiveServerInstance();
	if (!active) throw error(404, 'collection_not_found');
	const body = (await request.json().catch(() => null)) as {
		kind?: unknown;
		candidateId?: unknown;
	} | null;
	if (typeof body?.kind !== 'string') {
		throw error(400, 'invalid_collection_suggestion_request');
	}
	try {
		const input = {
			serverInstanceId: active.id,
			collectionId: params.id,
			mediaItemId: mediaItemId(params.memberId),
			kind: body.kind
		};
		const result =
			action === 'stage'
				? await stageCollectionMemberCandidate({
						...input,
						candidateId: typeof body.candidateId === 'number' ? body.candidateId : Number.NaN
					})
				: await clearCollectionMemberSelection(input);
		return json({ ok: true, ...result });
	} catch (cause) {
		if (cause instanceof CollectionSuggestionStoreError) {
			throw error(statusFor(cause.code), cause.code);
		}
		throw cause;
	}
}

export const PUT: RequestHandler = async ({ params, request }) => run(params, request, 'stage');
export const DELETE: RequestHandler = async ({ params, request }) => run(params, request, 'clear');
