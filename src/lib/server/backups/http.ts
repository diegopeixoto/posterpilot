import { json } from '@sveltejs/kit';
import { BackupServiceError, asBackupServiceError, type BackupServiceErrorCode } from './errors';

export async function readBackupJsonObject(request: Request): Promise<Record<string, unknown>> {
	let value: unknown;
	try {
		value = await request.json();
	} catch (error) {
		throw new BackupServiceError('request_invalid', 400, { cause: error });
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new BackupServiceError('request_invalid', 400);
	}
	return value as Record<string, unknown>;
}

export function backupApiError(
	error: unknown,
	fallbackCode: BackupServiceErrorCode,
	fallbackStatus = 500
): Response {
	const safe = asBackupServiceError(error, fallbackCode, fallbackStatus);
	return json(
		{ error: { code: safe.code } },
		{ status: safe.status, headers: { 'Cache-Control': 'no-store' } }
	);
}
