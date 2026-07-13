import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { enqueueJob } from '$lib/server/jobs/runner';
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
	const body = (await request.json().catch(() => ({}))) as { full?: boolean };
	try {
		const jobId = await enqueueJob({
			kind: 'sync',
			serverInstanceId: activeServer.id,
			full: body.full === true
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
