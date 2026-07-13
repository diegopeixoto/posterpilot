import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	confirmActiveItemArtworkUndo,
	previewActiveItemArtworkUndo
} from '$lib/server/artwork-revisions/undo-runtime';
import { assertUndoPlanPayload, UNDO_PLAN_KIND } from '$lib/server/artwork-revisions/undo-plan';
import { collectionHistory } from '$lib/server/collections/history-runtime';
import { operationPlanStore } from '$lib/server/plans/operation-plan-store';
import { getActiveServerInstance } from '$lib/server/server-instances';

function responseError(error: unknown): Response {
	const code =
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		typeof error.code === 'string' &&
		/^[A-Za-z0-9._:-]{1,96}$/.test(error.code)
			? error.code
			: 'collection_undo_failed';
	const status =
		code === 'collection_action_not_found' || code === 'item_not_found'
			? 404
			: code === 'maintenance_mode'
				? 503
				: code.startsWith('invalid_')
					? 400
					: code.includes('stale') || code.includes('mismatch') || code.includes('consumed')
						? 409
						: 422;
	return json({ error: { code } }, { status });
}

async function activeGroupScope(collectionId: string, revisionGroupId: string) {
	const active = await getActiveServerInstance();
	if (!active) throw Object.assign(new Error(), { code: 'server_instance_not_found' });
	const group = await collectionHistory.get(active.id, collectionId, revisionGroupId);
	if (!group) throw Object.assign(new Error(), { code: 'collection_action_not_found' });
	if (!group.anchorItemId) {
		throw Object.assign(new Error(), { code: 'collection_action_not_restorable' });
	}
	return { active, group, anchorItemId: group.anchorItemId };
}

async function activeRevisionScope(collectionId: string, revisionId: string) {
	const active = await getActiveServerInstance();
	if (!active) throw Object.assign(new Error(), { code: 'server_instance_not_found' });
	const result = await collectionHistory.getRevision(active.id, collectionId, revisionId);
	if (!result) throw Object.assign(new Error(), { code: 'collection_action_not_found' });
	if (!result.revision.restorable || !result.revision.mediaItemId) {
		throw Object.assign(new Error(), { code: 'collection_action_not_restorable' });
	}
	return { active, ...result, anchorItemId: result.revision.mediaItemId };
}

export const POST: RequestHandler = async ({ params, request }) => {
	const body = (await request.json().catch(() => ({}))) as {
		revisionGroupId?: string;
		revisionId?: string;
	};
	const revisionGroupId =
		typeof body.revisionGroupId === 'string' && body.revisionGroupId ? body.revisionGroupId : null;
	const revisionId =
		typeof body.revisionId === 'string' && body.revisionId ? body.revisionId : null;
	if (
		!params.id ||
		Number(revisionGroupId !== null) + Number(revisionId !== null) !== 1 ||
		Object.keys(body).some((key) => key !== 'revisionGroupId' && key !== 'revisionId')
	) {
		return json({ error: { code: 'invalid_request' } }, { status: 400 });
	}
	try {
		const preview = revisionId
			? await (async () => {
					const scope = await activeRevisionScope(params.id, revisionId);
					return previewActiveItemArtworkUndo({
						mediaItemId: scope.anchorItemId,
						scope: { kind: 'revision', revisionId: scope.revision.id }
					});
				})()
			: await (async () => {
					const scope = await activeGroupScope(params.id, revisionGroupId!);
					return previewActiveItemArtworkUndo({
						mediaItemId: scope.anchorItemId,
						scope: { kind: 'group', revisionGroupId: scope.group.id }
					});
				})();
		return json({ ok: true, preview });
	} catch (error) {
		return responseError(error);
	}
};

export const PUT: RequestHandler = async ({ params, request }) => {
	const body = (await request.json().catch(() => ({}))) as {
		planId?: string;
		digest?: string;
	};
	if (
		!params.id ||
		typeof body.planId !== 'string' ||
		!body.planId ||
		typeof body.digest !== 'string' ||
		!body.digest ||
		Object.keys(body).some((key) => key !== 'planId' && key !== 'digest')
	) {
		return json({ error: { code: 'invalid_request' } }, { status: 400 });
	}
	try {
		const active = await getActiveServerInstance();
		if (!active) throw Object.assign(new Error(), { code: 'server_instance_not_found' });
		const stored = await operationPlanStore.validate<unknown>(body.planId, {
			kind: UNDO_PLAN_KIND,
			digest: body.digest,
			serverInstanceId: active.id
		});
		assertUndoPlanPayload(stored.payload);
		const scope =
			stored.payload.scope.kind === 'group'
				? await activeGroupScope(params.id, stored.payload.scope.revisionGroupId)
				: stored.payload.scope.kind === 'revision'
					? await activeRevisionScope(params.id, stored.payload.scope.revisionId)
					: null;
		if (!scope) throw Object.assign(new Error(), { code: 'plan_scope_mismatch' });
		// A grouped collection undo can span every member, so it runs on the durable
		// worker: the response carries the job to follow instead of a finished result.
		const job = await confirmActiveItemArtworkUndo({
			mediaItemId: scope.anchorItemId,
			planId: body.planId,
			digest: body.digest
		});
		return json({ ok: true, job }, { status: 202 });
	} catch (error) {
		return responseError(error);
	}
};
