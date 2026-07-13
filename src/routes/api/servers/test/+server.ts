import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { testManagedServer } from '$lib/server/server-instances';
import {
	optionalConnectionSettings,
	optionalServerType,
	optionalString,
	readJsonObject,
	serverInstanceErrorResponse
} from '$lib/server/server-instances/http';
import { ServerInstanceError } from '$lib/server/server-instances/validation';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await readJsonObject(request);
		const id = optionalString(body, 'id');
		if (id !== undefined && id.trim() === '') {
			throw new ServerInstanceError('invalid_request');
		}
		const result = await testManagedServer({
			id,
			type: optionalServerType(body),
			baseUrl: optionalString(body, 'baseUrl'),
			credential: optionalString(body, 'credential'),
			connectionSettings: optionalConnectionSettings(body)
		});
		return json({ result });
	} catch (error) {
		return serverInstanceErrorResponse(error);
	}
};
