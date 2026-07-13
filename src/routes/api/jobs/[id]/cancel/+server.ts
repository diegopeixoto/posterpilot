import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cancelJob } from '$lib/server/jobs/runner';
import { getJob } from '$lib/server/queries';
import { getActiveServerInstance } from '$lib/server/server-instances';

export const POST: RequestHandler = async ({ params }) => {
	const id = Number(params.id);
	const active = await getActiveServerInstance();
	if (!active || !Number.isSafeInteger(id) || !(await getJob(id, active.id))) {
		return json({ error: { code: 'job_not_found' } }, { status: 404 });
	}
	await cancelJob(id);
	return json({ ok: true });
};
