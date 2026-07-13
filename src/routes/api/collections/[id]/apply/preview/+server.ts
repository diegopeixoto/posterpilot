import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	CollectionApplyScopeError,
	loadCollectionApplyScope
} from '$lib/server/collections/apply-scope';
import { db } from '$lib/server/db';
import {
	activeApplyServerInstanceId,
	previewDatabaseArtworkApply,
	resolveDatabaseApplyTargets
} from '$lib/server/plans/apply-runtime';
import { applyRouteError } from '$lib/server/plans/apply-route-error';

function scopeError(error: CollectionApplyScopeError): Response {
	const status = error.code === 'collection_not_found' ? 404 : 400;
	return json({ error: { code: error.code } }, { status });
}

export const POST: RequestHandler = async ({ params, request }) => {
	const body = (await request.json().catch(() => ({}))) as {
		method?: 'plex' | 'server' | 'kometa' | 'both';
	};
	if (
		!params.id ||
		Object.keys(body).some((key) => key !== 'method') ||
		(body.method !== undefined && !['plex', 'server', 'kometa', 'both'].includes(body.method))
	) {
		return json({ error: { code: 'invalid_request' } }, { status: 400 });
	}
	try {
		const serverInstanceId = await activeApplyServerInstanceId();
		const scope = await loadCollectionApplyScope(db, serverInstanceId, params.id, {
			requireLocalMembers: true
		});
		const targets = await resolveDatabaseApplyTargets(scope.itemIds, serverInstanceId);
		return json(
			await previewDatabaseArtworkApply({
				context: {
					source: 'collection',
					collectionId: scope.collectionId,
					membershipFingerprint: scope.membershipFingerprint
				},
				targets,
				selectionMode: 'stored',
				method: body.method
			})
		);
	} catch (error) {
		if (error instanceof CollectionApplyScopeError) return scopeError(error);
		return applyRouteError(error);
	}
};
