import { eq, or } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import { settings } from '$lib/server/db/schema';
import { BackupServiceError } from './errors';
import type { BackupRecord } from './inventory';

const RETENTION_COUNT_KEY = 'backupRetentionMaxCount';
const RETENTION_AGE_KEY = 'backupRetentionMaxAgeDays';
const MAX_COUNT_LIMIT = 10_000;
const MAX_AGE_DAYS_LIMIT = 36_500;

export interface BackupRetentionPolicy {
	/** Maximum retained unprotected backups. null disables count pruning. */
	maxCount: number | null;
	/** Maximum age of an unprotected backup in days. null disables age pruning. */
	maxAgeDays: number | null;
}

export interface BackupRetentionPolicyUpdate {
	maxCount?: number | null;
	maxAgeDays?: number | null;
}

function parseStoredLimit(
	value: string | undefined,
	minimum: number,
	maximum: number
): number | null {
	if (value === undefined || value === '') return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function validateLimit(value: number | null, minimum: number, maximum: number): void {
	if (value === null) return;
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new BackupServiceError('retention_policy_invalid', 400);
	}
}

function validateRetentionPolicy(policy: BackupRetentionPolicy): void {
	validateLimit(policy.maxCount, 0, MAX_COUNT_LIMIT);
	validateLimit(policy.maxAgeDays, 1, MAX_AGE_DAYS_LIMIT);
}

export async function getBackupRetentionPolicy(
	database: LibSQLDatabase<typeof schema>
): Promise<BackupRetentionPolicy> {
	const rows = await database
		.select()
		.from(settings)
		.where(or(eq(settings.key, RETENTION_COUNT_KEY), eq(settings.key, RETENTION_AGE_KEY)));
	const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
	return {
		maxCount: parseStoredLimit(values[RETENTION_COUNT_KEY], 0, MAX_COUNT_LIMIT),
		maxAgeDays: parseStoredLimit(values[RETENTION_AGE_KEY], 1, MAX_AGE_DAYS_LIMIT)
	};
}

async function persistPolicyValue(
	database: LibSQLDatabase<typeof schema>,
	key: string,
	value: number | null
): Promise<void> {
	if (value === null) {
		await database.delete(settings).where(eq(settings.key, key));
		return;
	}
	const serialized = String(value);
	await database
		.insert(settings)
		.values({ key, value: serialized })
		.onConflictDoUpdate({ target: settings.key, set: { value: serialized } });
}

export async function updateBackupRetentionPolicy(
	database: LibSQLDatabase<typeof schema>,
	update: BackupRetentionPolicyUpdate
): Promise<BackupRetentionPolicy> {
	const current = await getBackupRetentionPolicy(database);
	const policy: BackupRetentionPolicy = {
		maxCount: update.maxCount === undefined ? current.maxCount : update.maxCount,
		maxAgeDays: update.maxAgeDays === undefined ? current.maxAgeDays : update.maxAgeDays
	};
	validateRetentionPolicy(policy);
	await persistPolicyValue(database, RETENTION_COUNT_KEY, policy.maxCount);
	await persistPolicyValue(database, RETENTION_AGE_KEY, policy.maxAgeDays);
	return policy;
}

/** Pure deterministic retention selection, returned oldest-first for deletion. */
export function selectRetentionCandidates(
	records: BackupRecord[],
	policy: BackupRetentionPolicy,
	now = new Date()
): BackupRecord[] {
	validateRetentionPolicy(policy);
	const eligible = records
		.filter(
			(record) =>
				record.status === 'completed' &&
				!record.protected &&
				(record.validationStatus === 'valid' || record.validationStatus === 'warning')
		)
		.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
	const selected = new Map<string, BackupRecord>();

	if (policy.maxCount !== null) {
		for (const record of eligible.slice(policy.maxCount)) selected.set(record.id, record);
	}
	if (policy.maxAgeDays !== null) {
		const cutoff = now.getTime() - policy.maxAgeDays * 24 * 60 * 60 * 1000;
		for (const record of eligible) {
			if (record.createdAt.getTime() < cutoff) selected.set(record.id, record);
		}
	}

	return [...selected.values()].sort(
		(left, right) => left.createdAt.getTime() - right.createdAt.getTime()
	);
}
