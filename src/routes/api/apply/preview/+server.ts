import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	activeApplyServerInstanceId,
	previewDatabaseArtworkApply,
	resolveDatabaseApplyTargets
} from '$lib/server/plans/apply-runtime';
import { applyRouteError } from '$lib/server/plans/apply-route-error';
import { LibrarySelectionError, materializeLibrarySelection } from '$lib/server/library-selection';

/**
 * Materialize and persist the exact bulk plan. Discovery/candidate selection,
 * child ids, current identities, skips, and defaults are frozen here.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as {
		itemIds?: number[];
		method?: 'plex' | 'server' | 'kometa' | 'both';
		selection?: 'auto' | 'stored';
		resultSetFingerprint?: string | null;
		selectionScope?: { query?: string; fingerprint?: string };
	};
	try {
		const serverInstanceId = await activeApplyServerInstanceId();
		let itemIds = body.itemIds;
		let resultSetFingerprint = body.resultSetFingerprint ?? null;
		if (body.selectionScope) {
			if (
				typeof body.selectionScope.query !== 'string' ||
				typeof body.selectionScope.fingerprint !== 'string'
			) {
				return json({ error: 'invalid_request' }, { status: 400 });
			}
			const materialized = await materializeLibrarySelection(
				body.selectionScope.query,
				body.selectionScope.fingerprint
			);
			if (materialized.serverInstanceId !== serverInstanceId) {
				return json({ error: 'scope_mismatch' }, { status: 409 });
			}
			itemIds = materialized.itemIds;
			resultSetFingerprint = materialized.fingerprint;
		}
		if (!itemIds?.length) return json({ error: 'invalid_request' }, { status: 400 });
		const targets = await resolveDatabaseApplyTargets(itemIds, serverInstanceId);
		return json(
			await previewDatabaseArtworkApply({
				context: {
					source: 'bulk',
					resultSetFingerprint
				},
				targets,
				selectionMode: body.selection ?? 'auto',
				method: body.method
			})
		);
	} catch (error) {
		if (error instanceof LibrarySelectionError) {
			return json(
				{ error: error.code },
				{ status: error.code === 'result_set_changed' ? 409 : 400 }
			);
		}
		return applyRouteError(error);
	}
};
