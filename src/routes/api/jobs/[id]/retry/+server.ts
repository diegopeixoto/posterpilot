import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { JobConflictError } from '$lib/server/jobs/runner';
import { JobRetryError, retryFailedJob } from '$lib/server/jobs/retry';
import { maintenanceResponse } from '$lib/server/maintenance-http';
import { getActiveServerInstance } from '$lib/server/server-instances';

export const POST: RequestHandler = async ({ params, request }) => {
	const blocked = maintenanceResponse();
	if (blocked) return blocked;
	const parentJobId = Number(params.id);
	const active = await getActiveServerInstance();
	if (!active || !Number.isSafeInteger(parentJobId) || parentJobId <= 0) {
		return json({ error: { code: 'job_not_found' } }, { status: 404 });
	}
	const body = (await request.json().catch(() => ({}))) as { outcomeIds?: number[] };
	if (body.outcomeIds !== undefined && !Array.isArray(body.outcomeIds)) {
		return json({ error: { code: 'job_retry_selection_invalid' } }, { status: 400 });
	}
	try {
		const result = await retryFailedJob({
			parentJobId,
			serverInstanceId: active.id,
			outcomeIds: body.outcomeIds
		});
		return json({
			jobId: result.jobIds[0],
			jobIds: result.jobIds,
			reused: result.reused,
			outcomeIds: result.outcomeIds
		});
	} catch (error) {
		if (error instanceof JobConflictError) {
			return json(
				{
					error: {
						code: error.code,
						conflictingJobId: error.conflictingJobId,
						conflictingJobType: error.conflictingJobType
					}
				},
				{ status: 409 }
			);
		}
		if (error instanceof JobRetryError) {
			const status =
				error.code === 'job_not_found'
					? 404
					: error.code === 'job_retry_selection_invalid'
						? 400
						: 409;
			return json({ error: { code: error.code } }, { status });
		}
		return json({ error: { code: 'internal_error' } }, { status: 500 });
	}
};
