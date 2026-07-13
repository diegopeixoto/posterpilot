import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ApplyAndNextError, completeReviewAfterVerifiedApply } from '$lib/server/review';
import { getActiveServerInstance } from '$lib/server/server-instances';

export const POST: RequestHandler = async ({ params, request }) => {
	const mediaItemId = Number(params.id);
	const body = (await request.json().catch(() => null)) as { jobId?: unknown } | null;
	const jobId = Number(body?.jobId);
	const active = await getActiveServerInstance();
	if (
		!active ||
		!Number.isSafeInteger(mediaItemId) ||
		mediaItemId <= 0 ||
		!Number.isSafeInteger(jobId) ||
		jobId <= 0
	) {
		return json({ error: { code: 'invalid_request' } }, { status: 400 });
	}
	try {
		return json(
			await completeReviewAfterVerifiedApply({
				serverInstanceId: active.id,
				mediaItemId,
				jobId
			})
		);
	} catch (error) {
		if (error instanceof ApplyAndNextError) {
			const status =
				error.code === 'item_not_found' || error.code === 'job_not_found'
					? 404
					: error.code === 'invalid_request'
						? 400
						: 409;
			return json({ error: { code: error.code } }, { status });
		}
		return json({ error: { code: 'internal_error' } }, { status: 500 });
	}
};
