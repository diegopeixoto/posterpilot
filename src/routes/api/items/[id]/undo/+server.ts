import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	confirmActiveItemArtworkUndo,
	previewActiveItemArtworkUndo
} from '$lib/server/artwork-revisions/undo-runtime';
import { parseActiveItemUndoScope } from '$lib/server/artwork-revisions/undo-http';
import { assertMutationsAllowed } from '$lib/server/maintenance';

const SAFE_ERROR_CODES = new Set([
	'maintenance_mode',
	'invalid_request',
	'invalid_scope',
	'invalid_plan',
	'invalid_undo_plan',
	'invalid_undo_execution_input',
	'undo_plan_digest_mismatch',
	'server_instance_not_found',
	'item_not_found',
	'undo_scope_not_found',
	'revision_already_undone',
	'target_scope_mismatch',
	'snapshot_scope_mismatch',
	'server_scope_mismatch',
	'target_unresolved',
	'plan_persist_failed',
	'plan_scope_mismatch',
	'plan_not_found',
	'plan_expired',
	'plan_consumed',
	'plan_corrupt',
	'plan_kind_mismatch',
	'plan_digest_mismatch',
	'plan_payload_mismatch',
	'plan_stale',
	'kometa_server_binding_missing',
	'kometa_server_binding_incompatible',
	'kometa_server_binding_unavailable',
	'kometa_server_binding_mismatch',
	'undo_kometa_unavailable',
	'undo_kometa_write_failed'
]);

type JsonObject = Record<string, unknown>;

function failure(code: string, status: number, field?: string): Response {
	return json({ error: { code, ...(field ? { field } : {}) } }, { status });
}

function statusFor(code: string): number {
	switch (code) {
		case 'maintenance_mode':
		case 'kometa_server_binding_unavailable':
		case 'undo_kometa_unavailable':
			return 503;
		case 'item_not_found':
		case 'undo_scope_not_found':
		case 'plan_not_found':
			return 404;
		case 'server_instance_not_found':
		case 'revision_already_undone':
		case 'target_scope_mismatch':
		case 'snapshot_scope_mismatch':
		case 'server_scope_mismatch':
		case 'target_unresolved':
		case 'plan_scope_mismatch':
		case 'plan_expired':
		case 'plan_consumed':
		case 'plan_corrupt':
		case 'plan_kind_mismatch':
		case 'plan_digest_mismatch':
		case 'plan_payload_mismatch':
		case 'plan_stale':
		case 'kometa_server_binding_missing':
		case 'kometa_server_binding_incompatible':
		case 'kometa_server_binding_mismatch':
			return 409;
		case 'invalid_request':
		case 'invalid_scope':
		case 'invalid_plan':
		case 'invalid_undo_plan':
		case 'invalid_undo_execution_input':
		case 'undo_plan_digest_mismatch':
			return 400;
		default:
			return 500;
	}
}

function safeError(error: unknown): Response {
	const candidate =
		typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
			? error.code
			: null;
	const code = candidate && SAFE_ERROR_CODES.has(candidate) ? candidate : 'undo_failed';
	return failure(code, statusFor(code));
}

function itemId(raw: string): number | null {
	const value = Number(raw);
	return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function object(value: unknown): JsonObject | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as JsonObject)
		: null;
}

async function jsonBody(request: Request, emptyAllowed: boolean): Promise<JsonObject | null> {
	const raw = await request.text();
	if (raw.trim() === '') return emptyAllowed ? {} : null;
	try {
		return object(JSON.parse(raw));
	} catch {
		return null;
	}
}

function nonEmptyString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 && value.trim() === value ? value : null;
}

/** Preview only. The operation-plan row is the sole durable side effect. */
export const POST: RequestHandler = async ({ params, request }) => {
	const mediaItemId = itemId(params.id);
	if (mediaItemId === null) return failure('invalid_request', 400, 'id');
	const body = await jsonBody(request, true);
	if (!body) return failure('invalid_request', 400, 'body');
	const scope = parseActiveItemUndoScope(body);
	if (!scope) return failure('invalid_request', 400, 'scope');
	try {
		assertMutationsAllowed();
		const preview = await previewActiveItemArtworkUndo({ mediaItemId, scope });
		return json({ ok: true, preview });
	} catch (error) {
		return safeError(error);
	}
};

/**
 * Confirm the exact single-use plan returned by POST. The plan is consumed and
 * handed to the durable worker, so the response carries the job to follow rather
 * than the outcome: a long undo reports progress and survives a restart.
 */
export const PUT: RequestHandler = async ({ params, request }) => {
	const mediaItemId = itemId(params.id);
	if (mediaItemId === null) return failure('invalid_request', 400, 'id');
	const body = await jsonBody(request, false);
	if (!body) return failure('invalid_request', 400, 'body');
	const planId = nonEmptyString(body.planId);
	const digest = nonEmptyString(body.digest);
	if (!planId || !digest) return failure('invalid_request', 400);
	try {
		assertMutationsAllowed();
		const job = await confirmActiveItemArtworkUndo({ mediaItemId, planId, digest });
		return json({ ok: true, job }, { status: 202 });
	} catch (error) {
		return safeError(error);
	}
};
