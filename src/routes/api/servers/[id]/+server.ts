import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { updateManagedServer } from '$lib/server/server-instances';
import {
	hasAnyOwnKey,
	optionalConnectionSettings,
	optionalServerType,
	optionalString,
	readJsonObject,
	serverInstanceErrorResponse
} from '$lib/server/server-instances/http';
import { ServerInstanceError } from '$lib/server/server-instances/validation';

const UPDATE_KEYS = ['name', 'type', 'baseUrl', 'credential', 'connectionSettings'] as const;

export const PATCH: RequestHandler = async ({ params, request }) => {
	try {
		if (!params.id) throw new ServerInstanceError('invalid_request');
		const body = await readJsonObject(request);
		if (!hasAnyOwnKey(body, UPDATE_KEYS)) throw new ServerInstanceError('invalid_request');
		const server = await updateManagedServer(params.id, {
			name: optionalString(body, 'name'),
			type: optionalServerType(body),
			baseUrl: optionalString(body, 'baseUrl'),
			credential: optionalString(body, 'credential'),
			connectionSettings: optionalConnectionSettings(body)
		});
		return json({ server });
	} catch (error) {
		return serverInstanceErrorResponse(error);
	}
};
