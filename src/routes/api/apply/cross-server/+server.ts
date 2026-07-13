import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { enqueueJob } from '$lib/server/jobs/runner';
import { maintenanceResponse } from '$lib/server/maintenance-http';
import { applyRouteError } from '$lib/server/plans/apply-route-error';
import { confirmDatabaseCrossServerApply } from '$lib/server/plans/cross-server-apply-runtime';

export const POST: RequestHandler = async ({ request }) => {
	const blocked = maintenanceResponse();
	if (blocked) return blocked;
	const body = (await request.json().catch(() => ({}))) as {
		planId?: string;
		digest?: string;
		sourceItem?: { serverInstanceId?: string; mediaItemId?: number };
		destinationServerInstanceIds?: string[];
		match?: { namespace?: 'tmdb' | 'imdb' | 'tvdb'; value?: string };
	};
	if (
		!body.planId ||
		!body.digest ||
		!body.sourceItem?.serverInstanceId ||
		!body.sourceItem.mediaItemId ||
		!body.destinationServerInstanceIds ||
		!body.match?.namespace ||
		!body.match.value
	) {
		return json({ error: 'plan_confirmation_required' }, { status: 400 });
	}
	try {
		return json(
			await confirmDatabaseCrossServerApply(
				{
					planId: body.planId,
					digest: body.digest,
					sourceItem: {
						serverInstanceId: body.sourceItem.serverInstanceId,
						mediaItemId: body.sourceItem.mediaItemId
					},
					destinationServerInstanceIds: body.destinationServerInstanceIds,
					match: { namespace: body.match.namespace, value: body.match.value }
				},
				enqueueJob
			)
		);
	} catch (error) {
		return applyRouteError(error);
	}
};
