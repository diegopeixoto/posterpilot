import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';

const LOCK_KEY = 'kometaMigrationControlLock';
const DEFAULT_LEASE_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 25;

type LockDatabase = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete'>;

declare const CONTROL_LEASE_BRAND: unique symbol;
export type KometaMigrationControlLease = string & { readonly [CONTROL_LEASE_BRAND]: true };

interface StoredLease {
	version: 1;
	owner: string;
	token: string;
	expiresAt: number;
}

interface ActiveLease {
	value: string;
	token: KometaMigrationControlLease;
	expiresAt: number;
}

export interface KometaMigrationControlLockOptions {
	leaseMs?: number;
	pollIntervalMs?: number;
	now?: () => number;
	delay?: (milliseconds: number) => Promise<void>;
	owner?: () => string;
}

class KometaMigrationControlLockError extends Error {
	constructor(readonly code: 'corrupt' | 'lost') {
		super(`Kometa migration control lock ${code}`);
		this.name = 'KometaMigrationControlLockError';
	}
}

function serializeLease(lease: StoredLease): string {
	return JSON.stringify(lease);
}

function parseLease(value: string): StoredLease {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw new KometaMigrationControlLockError('corrupt');
	}
	if (
		!parsed ||
		typeof parsed !== 'object' ||
		Array.isArray(parsed) ||
		(parsed as Record<string, unknown>).version !== 1 ||
		typeof (parsed as Record<string, unknown>).owner !== 'string' ||
		(parsed as Record<string, unknown>).owner === '' ||
		typeof (parsed as Record<string, unknown>).token !== 'string' ||
		(parsed as Record<string, unknown>).token === '' ||
		!Number.isSafeInteger((parsed as Record<string, unknown>).expiresAt)
	) {
		throw new KometaMigrationControlLockError('corrupt');
	}
	return parsed as StoredLease;
}

function isBusyError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const code = (error as { code?: unknown }).code;
	if (typeof code === 'string') return code.startsWith('SQLITE_BUSY');
	return error.message.includes('database is locked');
}

async function tryAcquireLease(
	database: LockDatabase,
	owner: string,
	token: KometaMigrationControlLease,
	now: number,
	leaseMs: number
): Promise<ActiveLease | null> {
	const expiresAt = now + leaseMs;
	const nextValue = serializeLease({ version: 1, owner, token, expiresAt });
	try {
		const [current] = await database
			.select({ value: settings.value })
			.from(settings)
			.where(eq(settings.key, LOCK_KEY))
			.limit(1);
		if (!current) {
			const [inserted] = await database
				.insert(settings)
				.values({ key: LOCK_KEY, value: nextValue })
				.onConflictDoNothing()
				.returning({ key: settings.key });
			return inserted ? { value: nextValue, token, expiresAt } : null;
		}
		if (parseLease(current.value).expiresAt > now) return null;
		const [updated] = await database
			.update(settings)
			.set({ value: nextValue })
			.where(and(eq(settings.key, LOCK_KEY), eq(settings.value, current.value)))
			.returning({ key: settings.key });
		return updated ? { value: nextValue, token, expiresAt } : null;
	} catch (error) {
		if (isBusyError(error)) return null;
		throw error;
	}
}

async function renewLease(
	database: LockDatabase,
	current: ActiveLease,
	owner: string,
	now: number,
	leaseMs: number
): Promise<ActiveLease> {
	const expiresAt = now + leaseMs;
	const nextValue = serializeLease({ version: 1, owner, token: current.token, expiresAt });
	const [updated] = await database
		.update(settings)
		.set({ value: nextValue })
		.where(and(eq(settings.key, LOCK_KEY), eq(settings.value, current.value)))
		.returning({ key: settings.key });
	if (!updated) throw new KometaMigrationControlLockError('lost');
	return { value: nextValue, token: current.token, expiresAt };
}

async function releaseLease(database: LockDatabase, currentValue: string): Promise<void> {
	await database
		.delete(settings)
		.where(and(eq(settings.key, LOCK_KEY), eq(settings.value, currentValue)));
}

/** Verify the exact lease token from inside the transaction that performs a guarded write. */
export async function assertKometaMigrationControlLease(
	database: Pick<typeof db, 'select'>,
	lease: KometaMigrationControlLease
): Promise<void> {
	const [current] = await database
		.select({ value: settings.value })
		.from(settings)
		.where(eq(settings.key, LOCK_KEY))
		.limit(1);
	if (!current) throw new KometaMigrationControlLockError('lost');
	const stored = parseLease(current.value);
	if (stored.token !== lease || stored.expiresAt <= Date.now()) {
		throw new KometaMigrationControlLockError('lost');
	}
}

/**
 * Build a FIFO lock backed by one shared SQLite lease. Separate app processes have
 * independent queues but still serialize through the durable compare-and-set row.
 */
export function createKometaMigrationControlLock(
	database: LockDatabase,
	options: KometaMigrationControlLockOptions = {}
): <T>(
	operation: (assertOwned: () => Promise<KometaMigrationControlLease>) => Promise<T>
) => Promise<T> {
	const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
	const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000)
		throw new TypeError('Invalid lease duration');
	if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1) {
		throw new TypeError('Invalid lock poll interval');
	}
	const now = options.now ?? Date.now;
	const delay =
		options.delay ??
		((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
	const owner = options.owner ?? randomUUID;
	let tail: Promise<unknown> = Promise.resolve();

	async function run<T>(
		operation: (assertOwned: () => Promise<KometaMigrationControlLease>) => Promise<T>
	): Promise<T> {
		const leaseOwner = owner();
		const leaseToken = randomUUID() as KometaMigrationControlLease;
		let lease: ActiveLease | null = null;
		while (lease === null) {
			lease = await tryAcquireLease(database, leaseOwner, leaseToken, now(), leaseMs);
			if (lease === null) await delay(pollIntervalMs);
		}

		let renewalFailure: unknown = null;
		let renewal = Promise.resolve();
		const renewCurrentLease = async (): Promise<void> => {
			for (;;) {
				if (lease === null) throw new KometaMigrationControlLockError('lost');
				try {
					lease = await renewLease(database, lease, leaseOwner, now(), leaseMs);
					return;
				} catch (error) {
					if (!isBusyError(error)) throw error;
					// Busy means SQLite has not decided ownership. Retry the exact CAS;
					// only a token mismatch is a real lease loss.
					await delay(pollIntervalMs);
				}
			}
		};
		const renewIntervalMs = Math.max(250, Math.floor(leaseMs / 3));
		const timer = setInterval(() => {
			renewal = renewal.then(renewCurrentLease).catch((error) => {
				renewalFailure = error;
			});
		}, renewIntervalMs);
		timer.unref?.();
		const assertOwned = async (): Promise<KometaMigrationControlLease> => {
			await renewal;
			if (renewalFailure) throw renewalFailure;
			renewal = renewal.then(renewCurrentLease);
			await renewal;
			if (renewalFailure) throw renewalFailure;
			if (lease === null) throw new KometaMigrationControlLockError('lost');
			return lease.token;
		};

		try {
			const result = await operation(assertOwned);
			await assertOwned();
			return result;
		} finally {
			clearInterval(timer);
			await renewal.catch(() => undefined);
			if (lease !== null) await releaseLease(database, lease.value).catch(() => undefined);
		}
	}

	return function withLock<T>(
		operation: (assertOwned: () => Promise<KometaMigrationControlLease>) => Promise<T>
	): Promise<T> {
		const result = tail.then(
			() => run(operation),
			() => run(operation)
		);
		tail = result.then(
			() => undefined,
			() => undefined
		);
		return result;
	};
}

export const withKometaMigrationControlLock = createKometaMigrationControlLock(db);
