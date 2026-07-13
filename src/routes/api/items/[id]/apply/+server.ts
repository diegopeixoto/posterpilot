import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { enqueueJob } from '$lib/server/jobs/runner';
import {
	activeApplyServerInstanceId,
	confirmDatabaseArtworkApply,
	previewDatabaseArtworkApply,
	resolveDatabaseApplyTargets
} from '$lib/server/plans/apply-runtime';
import { applyRouteError } from '$lib/server/plans/apply-route-error';
import { maintenanceResponse } from '$lib/server/maintenance-http';

export const POST: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) return json({ error: 'invalid_request' }, { status: 400 });

	const body = (await request.json().catch(() => ({}))) as {
		method?: 'plex' | 'server' | 'kometa' | 'both';
		planId?: string;
		digest?: string;
	};
	if (body.planId || body.digest) {
		const blocked = maintenanceResponse();
		if (blocked) return blocked;
	}
	try {
		const serverInstanceId = await activeApplyServerInstanceId();
		if (body.planId || body.digest) {
			if (!body.planId || !body.digest) {
				return json({ error: 'plan_confirmation_required' }, { status: 400 });
			}
			return json(
				await confirmDatabaseArtworkApply(
					{ planId: body.planId, digest: body.digest, serverInstanceId, targetItemId: id },
					enqueueJob
				)
			);
		}

		const [target] = await resolveDatabaseApplyTargets([id], serverInstanceId);
		return json(
			await previewDatabaseArtworkApply({
				context: { source: 'single' },
				targets: [target],
				selectionMode: 'stored',
				method: body.method
			})
		);
	} catch (error) {
		return applyRouteError(error);
	}
};
