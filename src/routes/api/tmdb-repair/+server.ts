import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { enqueueJob } from '$lib/server/jobs/runner';
import { jobEnqueueErrorResponse } from '$lib/server/jobs/http';
import { maintenanceErrorResponse, maintenanceResponse } from '$lib/server/maintenance-http';
import { getActiveServerInstance } from '$lib/server/server-instances';
import { countPendingTmdbRepairs } from '$lib/server/tmdb/repair';

export const POST: RequestHandler = async () => {
	const blocked = maintenanceResponse();
	if (blocked) return blocked;
	const activeServer = await getActiveServerInstance();
	if (!activeServer) {
		return json({ error: { code: 'server_instance_not_found' } }, { status: 409 });
	}
	const pendingCount = await countPendingTmdbRepairs(activeServer.id);
	if (pendingCount === 0) return json({ jobId: null, pendingCount: 0 });

	try {
		const jobId = await enqueueJob({
			kind: 'tmdb_repair',
			serverInstanceId: activeServer.id
		});
		return json({ jobId, pendingCount });
	} catch (error) {
		const maintenance = maintenanceErrorResponse(error);
		if (maintenance) return maintenance;
		const conflict = jobEnqueueErrorResponse(error);
		if (conflict) return conflict;
		throw error;
	}
};
