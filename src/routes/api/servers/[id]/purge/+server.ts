import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertMutationsAllowed } from '$lib/server/maintenance';
import { confirmServerPurge, previewServerPurge } from '$lib/server/server-instances/purge-runtime';

function responseError(error: unknown): Response {
	const code =
		typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
			? error.code
			: 'internal_error';
	const status =
		code === 'server_instance_not_found' || code === 'plan_not_found'
			? 404
			: code === 'invalid_request' || code === 'server_purge_invalid_plan'
				? 400
				: code === 'maintenance_mode'
					? 503
					: code.startsWith('server_purge_') || code.startsWith('plan_')
						? 409
						: 500;
	return json({ error: { code } }, { status });
}

async function body(request: Request): Promise<Record<string, unknown>> {
	try {
		const value = await request.json();
		if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
		return value as Record<string, unknown>;
	} catch {
		throw Object.assign(new Error('invalid_request'), { code: 'invalid_request' });
	}
}

/** Preview exact server-scoped deletion impact without deleting any record. */
export const POST: RequestHandler = async ({ params }) => {
	try {
		assertMutationsAllowed();
		if (!params.id) throw Object.assign(new Error('invalid_request'), { code: 'invalid_request' });
		return json({ preview: await previewServerPurge(params.id) });
	} catch (error) {
		return responseError(error);
	}
};

/** Confirm the unchanged single-use purge preview. */
export const DELETE: RequestHandler = async ({ params, request }) => {
	try {
		assertMutationsAllowed();
		if (!params.id) throw Object.assign(new Error('invalid_request'), { code: 'invalid_request' });
		const input = await body(request);
		if (
			input.confirm !== true ||
			typeof input.planId !== 'string' ||
			typeof input.digest !== 'string'
		) {
			throw Object.assign(new Error('invalid_request'), { code: 'invalid_request' });
		}
		return json({
			result: await confirmServerPurge({
				serverInstanceId: params.id,
				planId: input.planId,
				digest: input.digest
			})
		});
	} catch (error) {
		return responseError(error);
	}
};
