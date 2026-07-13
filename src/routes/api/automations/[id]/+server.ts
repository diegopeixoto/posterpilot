import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { automationStore } from '$lib/server/automation/runtime';
import type { AutomationDefinitionInput } from '$lib/server/automation/model';
import { assertMutationsAllowed } from '$lib/server/maintenance';
import { getActiveServerInstance } from '$lib/server/server-instances';

function failure(code: string, status: number, field?: string): Response {
	return json({ error: { code, ...(field ? { field } : {}) } }, { status });
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
	const field =
		typeof error === 'object' &&
		error !== null &&
		'field' in error &&
		typeof error.field === 'string'
			? error.field
			: undefined;
	const status =
		code === 'automation_not_found' || code === 'server_instance_not_found'
			? 404
			: code === 'duplicate_automation_name' || code === 'server_scope_mismatch'
				? 409
				: code === 'maintenance_mode'
					? 503
					: code.startsWith('invalid_')
						? 400
						: 500;
	return failure(code, status, field);
}

async function body(request: Request): Promise<Record<string, unknown>> {
	try {
		const value = await request.json();
		if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
		return value as Record<string, unknown>;
	} catch {
		throw Object.assign(new Error('invalid_request'), {
			code: 'invalid_request',
			field: 'body'
		});
	}
}

export const PUT: RequestHandler = async ({ params, request }) => {
	try {
		assertMutationsAllowed();
		const active = await getActiveServerInstance();
		if (!active) throw Object.assign(new Error(), { code: 'server_instance_not_found' });
		if (!params.id) return failure('invalid_request', 400, 'id');
		const input = await body(request);
		const schedule = await automationStore.update(params.id, active.id, {
			...(input as unknown as AutomationDefinitionInput),
			serverInstanceId: active.id
		});
		return json({ schedule });
	} catch (error) {
		return responseError(error);
	}
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	try {
		assertMutationsAllowed();
		const active = await getActiveServerInstance();
		if (!active) throw Object.assign(new Error(), { code: 'server_instance_not_found' });
		if (!params.id) return failure('invalid_request', 400, 'id');
		const input = await body(request);
		if (typeof input.enabled !== 'boolean' || Object.keys(input).some((key) => key !== 'enabled')) {
			return failure('invalid_request', 400, 'enabled');
		}
		const schedule = await automationStore.setEnabled(params.id, active.id, input.enabled);
		return json({ schedule });
	} catch (error) {
		return responseError(error);
	}
};

export const DELETE: RequestHandler = async ({ params, request }) => {
	try {
		assertMutationsAllowed();
		const active = await getActiveServerInstance();
		if (!active) throw Object.assign(new Error(), { code: 'server_instance_not_found' });
		if (!params.id) return failure('invalid_request', 400, 'id');
		const input = await body(request);
		if (input.confirm !== true || Object.keys(input).some((key) => key !== 'confirm')) {
			return failure('invalid_request', 400, 'confirm');
		}
		await automationStore.remove(params.id, active.id);
		return json({ ok: true });
	} catch (error) {
		return responseError(error);
	}
};
