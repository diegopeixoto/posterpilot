import { json } from '@sveltejs/kit';
import { OperationPlanError } from '$lib/server/plans/operation-plan-store';
import { NativeCollectionArtworkServiceError } from './native-artwork-service';

/** Map locale-neutral native collection failures without exposing provider details. */
export function nativeCollectionArtworkErrorResponse(error: unknown): Response {
	if (error instanceof NativeCollectionArtworkServiceError) {
		const status =
			error.code === 'collection_not_found'
				? 404
				: error.code === 'invalid_request'
					? 400
					: error.code === 'native_collection_candidate_not_found'
						? 404
						: error.code === 'native_collection_server_unavailable' ||
							  error.code === 'native_collection_candidate_source_unavailable' ||
							  error.code === 'native_collection_candidate_unavailable'
							? 503
							: 409;
		return json({ error: { code: error.code } }, { status });
	}
	if (error instanceof OperationPlanError) {
		const status =
			error.code === 'plan_not_found'
				? 404
				: error.code === 'plan_expired' ||
					  error.code === 'plan_consumed' ||
					  error.code === 'plan_stale'
					? 409
					: 400;
		return json({ error: { code: error.code } }, { status });
	}
	return json({ error: { code: 'native_collection_operation_failed' } }, { status: 500 });
}
