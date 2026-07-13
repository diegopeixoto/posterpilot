export const SERVER_INSTANCE_NAME_MAX_LENGTH = 80;

export type ServerInstanceType = 'plex' | 'jellyfin' | 'emby';

export type ServerInstanceErrorCode =
	| 'invalid_request'
	| 'invalid_name'
	| 'duplicate_name'
	| 'invalid_server_type'
	| 'invalid_base_url'
	| 'credential_required'
	| 'credential_update_conflict'
	| 'connection_unauthorized'
	| 'connection_unreachable'
	| 'server_instance_not_found'
	| 'server_instance_disabled'
	| 'server_instance_disconnected'
	| 'server_instance_protected'
	| 'server_instance_in_use'
	| 'disconnect_confirmation_required'
	| 'credential_unavailable';

/** Locale-neutral domain error; route adapters translate `code` later. */
export class ServerInstanceError extends Error {
	constructor(
		public readonly code: ServerInstanceErrorCode,
		public readonly details: Readonly<Record<string, string | number | boolean>> = {}
	) {
		super(code);
		this.name = 'ServerInstanceError';
	}
}

export interface NormalizedServerInstanceName {
	name: string;
	normalizedName: string;
}

/**
 * Normalize visible spacing/canonical Unicode while preserving the user's casing.
 * The comparison key is case-insensitive and stable across locale changes.
 */
export function normalizeServerInstanceName(input: string): NormalizedServerInstanceName {
	if (typeof input !== 'string') throw new ServerInstanceError('invalid_name');

	const name = input.normalize('NFKC').trim().replace(/\s+/gu, ' ');
	const length = Array.from(name).length;
	if (length === 0 || length > SERVER_INSTANCE_NAME_MAX_LENGTH || /[\p{Cc}\p{Cf}]/u.test(name)) {
		throw new ServerInstanceError('invalid_name', {
			maxLength: SERVER_INSTANCE_NAME_MAX_LENGTH
		});
	}

	return {
		name,
		normalizedName: name.toLocaleLowerCase('en-US')
	};
}

/** Normalize and validate a server base URL without accepting embedded credentials. */
export function normalizeServerBaseUrl(input: string): string {
	if (typeof input !== 'string' || input.trim() === '') {
		throw new ServerInstanceError('invalid_base_url');
	}

	let parsed: URL;
	try {
		parsed = new URL(input.trim());
	} catch {
		throw new ServerInstanceError('invalid_base_url');
	}

	if (
		(parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
		!parsed.hostname ||
		parsed.username !== '' ||
		parsed.password !== '' ||
		parsed.search !== '' ||
		parsed.hash !== ''
	) {
		throw new ServerInstanceError('invalid_base_url');
	}

	return parsed.toString().replace(/\/$/u, '');
}

export function assertServerInstanceType(value: string): asserts value is ServerInstanceType {
	if (value !== 'plex' && value !== 'jellyfin' && value !== 'emby') {
		throw new ServerInstanceError('invalid_server_type');
	}
}

const MASKED_CREDENTIAL = /^(?:\*|•|●){4,}$/u;

/** Empty/masked form submissions deliberately mean “preserve the stored secret”. */
export function hasCredentialReplacement(value: string | undefined): value is string {
	if (typeof value !== 'string') return false;
	const trimmed = value.trim();
	return trimmed !== '' && !MASKED_CREDENTIAL.test(trimmed);
}
