import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { enqueueJob } from '$lib/server/jobs/runner';
import { LibrarySelectionError, materializeLibrarySelection } from '$lib/server/library-selection';
import { maintenanceErrorResponse, maintenanceResponse } from '$lib/server/maintenance-http';
import { getActiveServerInstance } from '$lib/server/server-instances';
import { jobEnqueueErrorResponse } from '$lib/server/jobs/http';

export const POST: RequestHandler = async ({ request }) => {
	const blocked = maintenanceResponse();
	if (blocked) return blocked;
	const activeServer = await getActiveServerInstance();
	if (!activeServer) {
		return json({ error: { code: 'server_instance_not_found' } }, { status: 409 });
	}
	const body = (await request.json().catch(() => ({}))) as {
		itemIds?: number[];
		forceRefresh?: boolean;
		selectionScope?: { query?: string; fingerprint?: string };
	};
	let itemIds = body.itemIds;
	if (body.selectionScope) {
		try {
			if (
				typeof body.selectionScope.query !== 'string' ||
				typeof body.selectionScope.fingerprint !== 'string'
			) {
				return json({ error: { code: 'invalid_request' } }, { status: 400 });
			}
			const materialized = await materializeLibrarySelection(
				body.selectionScope.query,
				body.selectionScope.fingerprint
			);
			if (materialized.serverInstanceId !== activeServer.id) {
				return json({ error: { code: 'result_set_changed' } }, { status: 409 });
			}
			itemIds = materialized.itemIds;
		} catch (error) {
			if (error instanceof LibrarySelectionError) {
				return json(
					{ error: { code: error.code } },
					{ status: error.code === 'result_set_changed' ? 409 : 400 }
				);
			}
			return json({ error: { code: 'internal_error' } }, { status: 500 });
		}
	}
	if ((body.selectionScope || Array.isArray(body.itemIds)) && !itemIds?.length) {
		return json({ error: { code: 'invalid_request' } }, { status: 400 });
	}
	try {
		const jobId = await enqueueJob({
			kind: 'discover',
			serverInstanceId: activeServer.id,
			itemIds,
			forceRefresh: body.forceRefresh
		});
		return json({ jobId });
	} catch (error) {
		const response = maintenanceErrorResponse(error);
		if (response) return response;
		const conflict = jobEnqueueErrorResponse(error);
		if (conflict) return conflict;
		throw error;
	}
};
