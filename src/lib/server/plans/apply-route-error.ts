import { json } from '@sveltejs/kit';
import { ApplyPlannerError } from './apply-planner';
import { OperationPlanError } from './operation-plan-store';
import { MaintenanceModeError } from '$lib/server/maintenance';
import { jobEnqueueErrorResponse } from '$lib/server/jobs/http';

/** Consistent locale-neutral API failures; UI catalogs own user-facing copy. */
export function applyRouteError(error: unknown): Response {
	const conflict = jobEnqueueErrorResponse(error);
	if (conflict) return conflict;
	if (error instanceof MaintenanceModeError) {
		return json({ error: { code: error.code } }, { status: 503 });
	}
	if (error instanceof OperationPlanError) {
		const status =
			error.code === 'plan_not_found'
				? 404
				: error.code === 'plan_expired'
					? 410
					: error.code === 'plan_corrupt'
						? 500
						: 409;
		return json({ error: error.code, planId: error.planId }, { status });
	}
	if (error instanceof ApplyPlannerError) {
		const status = error.code === 'item_not_found' || error.code === 'scope_mismatch' ? 404 : 400;
		return json({ error: error.code }, { status });
	}
	return json({ error: 'apply_failed' }, { status: 500 });
}
