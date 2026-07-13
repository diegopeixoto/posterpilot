import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { performReviewAction, parseReviewAction, ReviewActionError } from '$lib/server/review';
import { getActiveServerInstance } from '$lib/server/server-instances';

export const POST: RequestHandler = async ({ params, request }) => {
	try {
		const id = Number(params.id);
		const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
		if (!body || typeof body.serverId !== 'string') {
			throw new ReviewActionError('invalid_request');
		}
		const active = await getActiveServerInstance();
		if (!active || active.id !== body.serverId) throw new ReviewActionError('item_not_found');
		const context =
			typeof body.context === 'object' && body.context !== null && !Array.isArray(body.context)
				? (body.context as Record<string, unknown>)
				: null;
		return json(
			await performReviewAction(body.serverId, id, parseReviewAction(body.action), context)
		);
	} catch (error) {
		if (error instanceof ReviewActionError) {
			return json(
				{ error: { code: error.code } },
				{ status: error.code === 'item_not_found' ? 404 : 400 }
			);
		}
		return json({ error: { code: 'internal_error' } }, { status: 500 });
	}
};
