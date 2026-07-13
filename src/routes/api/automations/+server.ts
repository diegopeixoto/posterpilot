import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { automationStore } from '$lib/server/automation/runtime';
import type { AutomationDefinitionInput } from '$lib/server/automation/model';
import { assertMutationsAllowed } from '$lib/server/maintenance';
import { getActiveServerInstance } from '$lib/server/server-instances';

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
		code === 'server_instance_not_found' ||
		code === 'library_scope_not_found' ||
		code === 'review_view_not_found'
			? 404
			: code === 'duplicate_automation_name'
				? 409
				: code === 'maintenance_mode'
					? 503
					: code.startsWith('invalid_')
						? 400
						: 500;
	return json({ error: { code, ...(field ? { field } : {}) } }, { status });
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

export const GET: RequestHandler = async ({ url }) => {
	const active = await getActiveServerInstance();
	if (!active) return json({ schedules: [], occurrences: [] });
	const rawLimit = url.searchParams.get('historyLimit');
	const historyLimit = rawLimit === null ? 50 : Number(rawLimit);
	try {
		const [schedules, occurrences] = await Promise.all([
			automationStore.list(active.id),
			automationStore.history(active.id, historyLimit)
		]);
		return json({ schedules, occurrences });
	} catch (error) {
		return responseError(error);
	}
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		assertMutationsAllowed();
		const active = await getActiveServerInstance();
		if (!active) throw Object.assign(new Error(), { code: 'server_instance_not_found' });
		const input = await body(request);
		const schedule = await automationStore.create({
			...(input as unknown as AutomationDefinitionInput),
			serverInstanceId: active.id
		});
		return json({ schedule }, { status: 201 });
	} catch (error) {
		return responseError(error);
	}
};
