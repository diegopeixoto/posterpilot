import { json } from '@sveltejs/kit';
import {
	ServerInstanceError,
	assertServerInstanceType,
	type ServerInstanceType
} from './validation';

export type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function readJsonObject(request: { json(): Promise<unknown> }): Promise<JsonObject> {
	let value: unknown;
	try {
		value = await request.json();
	} catch {
		throw new ServerInstanceError('invalid_request');
	}
	if (!isJsonObject(value)) throw new ServerInstanceError('invalid_request');
	return value;
}

export function requireString(body: JsonObject, key: string): string {
	const value = body[key];
	if (typeof value !== 'string') throw new ServerInstanceError('invalid_request');
	return value;
}

export function optionalString(body: JsonObject, key: string): string | undefined {
	const value = body[key];
	if (value === undefined) return undefined;
	if (typeof value !== 'string') throw new ServerInstanceError('invalid_request');
	return value;
}

export function requireServerType(body: JsonObject, key = 'type'): ServerInstanceType {
	const value = requireString(body, key);
	assertServerInstanceType(value);
	return value;
}

export function optionalServerType(body: JsonObject, key = 'type'): ServerInstanceType | undefined {
	const value = optionalString(body, key);
	if (value === undefined) return undefined;
	assertServerInstanceType(value);
	return value;
}

export function optionalConnectionSettings(
	body: JsonObject,
	key = 'connectionSettings'
): Record<string, unknown> | null | undefined {
	const value = body[key];
	if (value === undefined || value === null) return value;
	if (!isJsonObject(value)) throw new ServerInstanceError('invalid_request');
	return value;
}

export function optionalBoolean(body: JsonObject, key: string): boolean | undefined {
	const value = body[key];
	if (value === undefined) return undefined;
	if (typeof value !== 'boolean') throw new ServerInstanceError('invalid_request');
	return value;
}

export function hasAnyOwnKey(body: JsonObject, keys: readonly string[]): boolean {
	return keys.some((key) => Object.prototype.hasOwnProperty.call(body, key));
}

function statusFor(error: ServerInstanceError): number {
	switch (error.code) {
		case 'invalid_request':
		case 'invalid_name':
		case 'invalid_server_type':
		case 'invalid_base_url':
		case 'credential_required':
		case 'disconnect_confirmation_required':
			return 400;
		case 'connection_unauthorized':
			return 401;
		case 'server_instance_not_found':
			return 404;
		case 'duplicate_name':
		case 'credential_update_conflict':
		case 'server_instance_disabled':
		case 'server_instance_disconnected':
		case 'server_instance_protected':
		case 'server_instance_in_use':
			return 409;
		case 'connection_unreachable':
			return 502;
		case 'credential_unavailable':
			return 500;
	}
}

/** Return locale-neutral structured errors and never serialize arbitrary exception messages. */
export function serverInstanceErrorResponse(error: unknown): Response {
	if (!(error instanceof ServerInstanceError)) {
		return json({ error: { code: 'internal_error' } }, { status: 500 });
	}
	const details = Object.keys(error.details).length > 0 ? { details: error.details } : {};
	return json({ error: { code: error.code, ...details } }, { status: statusFor(error) });
}
