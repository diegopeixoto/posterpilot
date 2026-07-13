import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { addManagedServer, listManagedServers } from '$lib/server/server-instances';
import {
	optionalConnectionSettings,
	readJsonObject,
	requireServerType,
	requireString,
	serverInstanceErrorResponse
} from '$lib/server/server-instances/http';

export const GET: RequestHandler = async () => {
	try {
		return json(await listManagedServers());
	} catch (error) {
		return serverInstanceErrorResponse(error);
	}
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await readJsonObject(request);
		const server = await addManagedServer({
			name: requireString(body, 'name'),
			type: requireServerType(body),
			baseUrl: requireString(body, 'baseUrl'),
			credential: requireString(body, 'credential'),
			connectionSettings: optionalConnectionSettings(body)
		});
		return json({ server }, { status: 201 });
	} catch (error) {
		return serverInstanceErrorResponse(error);
	}
};
