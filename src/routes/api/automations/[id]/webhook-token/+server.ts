import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { automationStore } from '$lib/server/automation/runtime';
import { assertMutationsAllowed } from '$lib/server/maintenance';
import { getActiveServerInstance } from '$lib/server/server-instances';

function failure(code: string, status: number): Response {
	return json({ error: { code } }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function responseError(error: unknown): Response {
	const code =
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		typeof error.code === 'string' &&
		/^[A-Za-z0-9._:-]{1,96}$/.test(error.code)
			? error.code
			: 'automation_request_failed';
	const status =
		code === 'automation_not_found' || code === 'server_instance_not_found'
			? 404
			: code === 'maintenance_mode'
				? 503
				: 500;
	return failure(code, status);
}

export const POST: RequestHandler = async ({ params, url }) => {
	try {
		assertMutationsAllowed();
		const active = await getActiveServerInstance();
		if (!active) return failure('server_instance_not_found', 404);
		if (!params.id) return failure('invalid_request', 400);
		const { token } = await automationStore.rotateWebhookToken(params.id, active.id);
		return json(
			{
				token,
				endpoint: `${url.origin}/api/automation-webhooks/${encodeURIComponent(params.id)}`,
				header: 'X-PosterPilot-Webhook-Token'
			},
			{ headers: { 'Cache-Control': 'no-store' } }
		);
	} catch (error) {
		return responseError(error);
	}
};

export const DELETE: RequestHandler = async ({ params }) => {
	try {
		assertMutationsAllowed();
		const active = await getActiveServerInstance();
		if (!active) return failure('server_instance_not_found', 404);
		if (!params.id) return failure('invalid_request', 400);
		await automationStore.clearWebhookToken(params.id, active.id);
		return json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
	} catch (error) {
		return responseError(error);
	}
};
