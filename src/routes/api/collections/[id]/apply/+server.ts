import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertCollectionApplyContextFresh } from '$lib/server/collections/apply-scope';
import { db } from '$lib/server/db';
import { enqueueJobDetailed } from '$lib/server/jobs/runner';
import {
	activeApplyServerInstanceId,
	confirmDatabaseArtworkApply
} from '$lib/server/plans/apply-runtime';
import { applyRouteError } from '$lib/server/plans/apply-route-error';
import { maintenanceResponse } from '$lib/server/maintenance-http';

export const POST: RequestHandler = async ({ params, request }) => {
	const blocked = maintenanceResponse();
	if (blocked) return blocked;
	const body = (await request.json().catch(() => ({}))) as {
		planId?: string;
		digest?: string;
	};
	if (
		!params.id ||
		!body.planId ||
		!body.digest ||
		Object.keys(body).some((key) => key !== 'planId' && key !== 'digest')
	) {
		return json({ error: { code: 'plan_confirmation_required' } }, { status: 400 });
	}
	try {
		const serverInstanceId = await activeApplyServerInstanceId();
		return json(
			await confirmDatabaseArtworkApply(
				{ planId: body.planId, digest: body.digest, serverInstanceId },
				async (payload) =>
					(
						await enqueueJobDetailed(payload, {
							persistedType: 'collection_apply',
							initiator: 'user',
							trigger: `collection:${params.id}`
						})
					).jobId,
				{
					validateContext: (payload) =>
						assertCollectionApplyContextFresh(db, payload, {
							collectionId: params.id,
							serverInstanceId
						})
				}
			)
		);
	} catch (error) {
		return applyRouteError(error);
	}
};
