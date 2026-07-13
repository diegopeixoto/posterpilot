import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteReviewView, ReviewViewError, updateReviewView } from '$lib/server/review';
import { getActiveServerInstance } from '$lib/server/server-instances';

async function activeServerId(requested: unknown): Promise<string> {
	const active = await getActiveServerInstance();
	if (!active || typeof requested !== 'string' || requested !== active.id) {
		throw new ReviewViewError('invalid_request');
	}
	return active.id;
}

function responseError(error: unknown): Response {
	if (!(error instanceof ReviewViewError)) {
		return json({ error: { code: 'internal_error' } }, { status: 500 });
	}
	const status =
		error.code === 'view_not_found' ? 404 : error.code === 'duplicate_name' ? 409 : 400;
	return json({ error: { code: error.code } }, { status });
}

export const PATCH: RequestHandler = async ({ params, request }) => {
	try {
		const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
		if (!body) throw new ReviewViewError('invalid_request');
		const serverId = await activeServerId(body.serverId);
		return json({
			view: await updateReviewView(serverId, params.id, {
				name: body.name,
				librarySectionKey: body.librarySectionKey,
				filters: body.filters,
				sort: body.sort
			})
		});
	} catch (error) {
		return responseError(error);
	}
};

export const DELETE: RequestHandler = async ({ params, url }) => {
	try {
		const serverId = await activeServerId(url.searchParams.get('serverId'));
		return json({
			view: await deleteReviewView(serverId, params.id)
		});
	} catch (error) {
		return responseError(error);
	}
};
