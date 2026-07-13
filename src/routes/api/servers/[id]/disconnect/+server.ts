import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { disconnectManagedServer } from '$lib/server/server-instances';
import {
	optionalBoolean,
	readJsonObject,
	serverInstanceErrorResponse
} from '$lib/server/server-instances/http';
import { ServerInstanceError } from '$lib/server/server-instances/validation';

export const POST: RequestHandler = async ({ params, request }) => {
	try {
		if (!params.id) throw new ServerInstanceError('invalid_request');
		const body = await readJsonObject(request);
		const server = await disconnectManagedServer(
			params.id,
			optionalBoolean(body, 'confirm') ?? false
		);
		return json({ server });
	} catch (error) {
		return serverInstanceErrorResponse(error);
	}
};
