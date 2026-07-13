import { json } from '@sveltejs/kit';
import { ManualMatchError } from './manual-match';

export async function readManualMatchBody(request: {
	json(): Promise<unknown>;
}): Promise<Record<string, unknown>> {
	let value: unknown;
	try {
		value = await request.json();
	} catch {
		throw new ManualMatchError('invalid_request');
	}
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new ManualMatchError('invalid_request');
	}
	return value as Record<string, unknown>;
}

export function parseManualMatchScope(params: { serverId?: string; id?: string }): {
	serverInstanceId: string;
	itemId: number;
} {
	const serverInstanceId = params.serverId?.trim() ?? '';
	const itemId = Number(params.id);
	if (!serverInstanceId || !Number.isSafeInteger(itemId) || itemId <= 0) {
		throw new ManualMatchError('invalid_request');
	}
	return { serverInstanceId, itemId };
}

function statusFor(error: ManualMatchError): number {
	switch (error.code) {
		case 'invalid_request':
			return 400;
		case 'media_item_not_found':
			return 404;
		case 'tmdb_not_configured':
		case 'tmdb_candidate_unavailable':
		case 'manual_pin_not_found':
			return 409;
		case 'tmdb_unavailable':
			return 502;
	}
}

/** Serialize only locale-neutral codes; arbitrary upstream/DB messages stay private. */
export function manualMatchErrorResponse(error: unknown): Response {
	if (!(error instanceof ManualMatchError)) {
		return json(
			{ error: { code: 'internal_error' }, correlationId: crypto.randomUUID() },
			{ status: 500 }
		);
	}
	return json({ error: { code: error.code } }, { status: statusFor(error) });
}
