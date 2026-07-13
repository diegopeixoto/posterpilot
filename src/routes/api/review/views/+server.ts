import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createReviewView, listReviewViews, ReviewViewError } from '$lib/server/review';
import { getActiveServerInstance } from '$lib/server/server-instances';

async function activeServerId(requested: unknown): Promise<string> {
	const active = await getActiveServerInstance();
	if (!active || typeof requested !== 'string' || requested !== active.id) {
		throw new ReviewViewError('invalid_request');
	}
	return active.id;
}

function errorResponse(error: unknown): Response {
	if (!(error instanceof ReviewViewError)) {
		return json({ error: { code: 'internal_error' } }, { status: 500 });
	}
	const status =
		error.code === 'view_not_found' ? 404 : error.code === 'duplicate_name' ? 409 : 400;
	return json({ error: { code: error.code } }, { status });
}

export const GET: RequestHandler = async ({ url }) => {
	try {
		const serverId = await activeServerId(url.searchParams.get('serverId'));
		return json({ views: await listReviewViews(serverId) });
	} catch (error) {
		return errorResponse(error);
	}
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
		if (!body) throw new ReviewViewError('invalid_request');
		const serverId = await activeServerId(body.serverId);
		const view = await createReviewView(serverId, {
			name: body.name,
			librarySectionKey: body.librarySectionKey,
			filters: body.filters,
			sort: body.sort
		});
		return json({ view }, { status: 201 });
	} catch (error) {
		return errorResponse(error);
	}
};
