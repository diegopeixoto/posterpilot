import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { enqueueJob } from '$lib/server/jobs/runner';
import {
	activeApplyServerInstanceId,
	confirmDatabaseArtworkApply
} from '$lib/server/plans/apply-runtime';
import { applyRouteError } from '$lib/server/plans/apply-route-error';
import { maintenanceResponse } from '$lib/server/maintenance-http';

export const POST: RequestHandler = async ({ request }) => {
	const blocked = maintenanceResponse();
	if (blocked) return blocked;
	const body = (await request.json().catch(() => ({}))) as {
		planId?: string;
		digest?: string;
	};
	if (!body.planId || !body.digest) {
		return json({ error: 'plan_confirmation_required' }, { status: 400 });
	}
	try {
		const serverInstanceId = await activeApplyServerInstanceId();
		return json(
			await confirmDatabaseArtworkApply(
				{ planId: body.planId, digest: body.digest, serverInstanceId },
				enqueueJob
			)
		);
	} catch (error) {
		return applyRouteError(error);
	}
};
