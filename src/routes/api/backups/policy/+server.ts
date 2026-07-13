import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	readApplicationBackupRetentionPolicy,
	saveApplicationBackupRetentionPolicy,
	type BackupRetentionPolicyUpdate
} from '$lib/server/backups';
import { BackupServiceError } from '$lib/server/backups';
import { backupApiError, readBackupJsonObject } from '$lib/server/backups/http';

export const GET: RequestHandler = async () => {
	try {
		return json(
			{ policy: await readApplicationBackupRetentionPolicy() },
			{ headers: { 'Cache-Control': 'no-store' } }
		);
	} catch (error) {
		return backupApiError(error, 'retention_policy_failed');
	}
};

export const PUT: RequestHandler = async ({ request }) => {
	try {
		const body = await readBackupJsonObject(request);
		const keys = Object.keys(body);
		if (keys.length === 0 || keys.some((key) => key !== 'maxCount' && key !== 'maxAgeDays')) {
			throw new BackupServiceError('retention_policy_invalid', 400);
		}
		const update: BackupRetentionPolicyUpdate = {};
		for (const key of ['maxCount', 'maxAgeDays'] as const) {
			if (!(key in body)) continue;
			const value = body[key];
			if (value !== null && typeof value !== 'number') {
				throw new BackupServiceError('retention_policy_invalid', 400);
			}
			update[key] = value;
		}
		return json(
			{ policy: await saveApplicationBackupRetentionPolicy(update) },
			{ headers: { 'Cache-Control': 'no-store' } }
		);
	} catch (error) {
		return backupApiError(error, 'retention_policy_failed');
	}
};
