import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	confirmNativeCollectionArtworkUndo,
	previewNativeCollectionArtworkUndo
} from '$lib/server/collections/native-artwork-runtime';
import type { NativeCollectionUndoScope } from '$lib/server/collections/native-artwork-undo';
import { assertMutationsAllowed } from '$lib/server/maintenance';
import { getActiveServerInstance } from '$lib/server/server-instances';

function safeError(error: unknown): Response {
	const candidate =
		error !== null &&
		typeof error === 'object' &&
		'code' in error &&
		typeof error.code === 'string' &&
		/^[A-Za-z0-9._:-]{1,96}$/.test(error.code)
			? error.code
			: 'native_collection_undo_failed';
	const status =
		candidate === 'maintenance_mode' || candidate.includes('unavailable')
			? 503
			: candidate === 'collection_not_found' || candidate === 'undo_scope_not_found'
				? 404
				: candidate.startsWith('invalid_')
					? 400
					: candidate.includes('stale') ||
						  candidate.includes('mismatch') ||
						  candidate.includes('consumed') ||
						  candidate.includes('already_undone')
						? 409
						: 422;
	return json({ error: { code: candidate } }, { status });
}

function object(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function undoScope(value: unknown): NativeCollectionUndoScope | null {
	if (value === undefined || value === null) return { kind: 'collection' };
	const source = object(value);
	if (!source || typeof source.kind !== 'string') return null;
	switch (source.kind) {
		case 'collection':
			return Object.keys(source).length === 1 ? { kind: 'collection' } : null;
		case 'slot':
			return Object.keys(source).every((key) => key === 'kind' || key === 'slot') &&
				(source.slot === 'poster' || source.slot === 'background')
				? { kind: 'slot', slot: source.slot }
				: null;
		case 'revision':
			return Object.keys(source).every((key) => key === 'kind' || key === 'revisionId') &&
				typeof source.revisionId === 'string'
				? { kind: 'revision', revisionId: source.revisionId }
				: null;
		case 'group':
			return Object.keys(source).every((key) => key === 'kind' || key === 'revisionGroupId') &&
				typeof source.revisionGroupId === 'string'
				? { kind: 'group', revisionGroupId: source.revisionGroupId }
				: null;
		default:
			return null;
	}
}

export const POST: RequestHandler = async ({ params, request }) => {
	const body = object(await request.json().catch(() => ({})));
	const scope = body ? undoScope(body.scope) : null;
	if (!body || !scope || Object.keys(body).some((key) => key !== 'scope')) {
		return json({ error: { code: 'invalid_request' } }, { status: 400 });
	}
	const active = await getActiveServerInstance();
	if (!active) return json({ error: { code: 'server_instance_not_found' } }, { status: 404 });
	try {
		assertMutationsAllowed();
		return json({
			ok: true,
			preview: await previewNativeCollectionArtworkUndo({
				serverInstanceId: active.id,
				mediaCollectionId: params.id,
				scope
			})
		});
	} catch (error) {
		return safeError(error);
	}
};

export const PUT: RequestHandler = async ({ params, request }) => {
	const body = object(await request.json().catch(() => null));
	if (
		!body ||
		typeof body.planId !== 'string' ||
		typeof body.digest !== 'string' ||
		Object.keys(body).some((key) => key !== 'planId' && key !== 'digest')
	) {
		return json({ error: { code: 'invalid_request' } }, { status: 400 });
	}
	const active = await getActiveServerInstance();
	if (!active) return json({ error: { code: 'server_instance_not_found' } }, { status: 404 });
	try {
		assertMutationsAllowed();
		const result = await confirmNativeCollectionArtworkUndo({
			serverInstanceId: active.id,
			mediaCollectionId: params.id,
			planId: body.planId,
			digest: body.digest
		});
		return json(
			{
				ok: result.status === 'success',
				...(result.status === 'success'
					? {}
					: { error: { code: result.status === 'partial' ? 'undo_partial' : 'undo_failed' } }),
				result
			},
			{ status: result.status === 'success' ? 200 : result.status === 'partial' ? 207 : 409 }
		);
	} catch (error) {
		return safeError(error);
	}
};
