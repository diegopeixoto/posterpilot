import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { disableManagedServer } from '$lib/server/server-instances';
import { serverInstanceErrorResponse } from '$lib/server/server-instances/http';
import { ServerInstanceError } from '$lib/server/server-instances/validation';

export const POST: RequestHandler = async ({ params }) => {
	try {
		if (!params.id) throw new ServerInstanceError('invalid_request');
		return json({ server: await disableManagedServer(params.id) });
	} catch (error) {
		return serverInstanceErrorResponse(error);
	}
};
