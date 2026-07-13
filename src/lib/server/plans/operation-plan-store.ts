import { randomUUID } from 'node:crypto';
import { and, eq, isNotNull, isNull, lte, or, gt } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { operationPlans } from '$lib/server/db/schema';
import {
	canonicalJson,
	canonicalJsonDigest,
	hashCanonicalJsonText,
	type JsonValue
} from './canonical-json';
import { decodeOperationPlanPayload, encodeOperationPlanPayload } from './operation-plan-payload';

/** Plans are deliberately short-lived so confirmation always follows a recent preview. */
export const DEFAULT_OPERATION_PLAN_TTL_MS = 15 * 60 * 1000;

export type OperationPlanErrorCode =
	| 'plan_not_found'
	| 'plan_expired'
	| 'plan_consumed'
	| 'plan_corrupt'
	| 'plan_kind_mismatch'
	| 'plan_digest_mismatch'
	| 'plan_payload_mismatch'
	| 'plan_scope_mismatch'
	| 'plan_stale';

/** A safe, locale-neutral operation-plan failure suitable for route adapters to map. */
export class OperationPlanError extends Error {
	constructor(
		readonly code: OperationPlanErrorCode,
		readonly planId: string
	) {
		super(operationPlanErrorMessage(code, planId));
		this.name = 'OperationPlanError';
	}
}

function operationPlanErrorMessage(code: OperationPlanErrorCode, planId: string): string {
	switch (code) {
		case 'plan_not_found':
			return `Operation plan ${planId} was not found`;
		case 'plan_expired':
			return `Operation plan ${planId} has expired`;
		case 'plan_consumed':
			return `Operation plan ${planId} has already been consumed`;
		case 'plan_corrupt':
			return `Operation plan ${planId} failed its integrity check`;
		case 'plan_kind_mismatch':
			return `Operation plan ${planId} has an unexpected kind`;
		case 'plan_digest_mismatch':
			return `Operation plan ${planId} has an unexpected digest`;
		case 'plan_payload_mismatch':
			return `Operation plan ${planId} does not match the expected payload`;
		case 'plan_scope_mismatch':
			return `Operation plan ${planId} has an unexpected scope`;
		case 'plan_stale':
			return `Operation plan ${planId} changed while it was being consumed`;
	}
}

export interface OperationPlan<T = JsonValue> {
	id: string;
	kind: string;
	serverInstanceId: string | null;
	librarySectionKey: string | null;
	payload: T;
	digest: string;
	createdAt: Date;
	expiresAt: Date;
	consumedAt: Date | null;
}

export interface CreateOperationPlanInput<T> {
	kind: string;
	payload: T;
	serverInstanceId?: string | null;
	librarySectionKey?: string | null;
	/** Relative lifetime. Mutually exclusive with `expiresAt`. */
	ttlMs?: number;
	/** Absolute expiry. Mutually exclusive with `ttlMs`. */
	expiresAt?: Date;
}

export interface OperationPlanExpectations {
	kind?: string;
	digest?: string;
	payload?: unknown;
	serverInstanceId?: string | null;
	librarySectionKey?: string | null;
}

export interface PruneOperationPlansOptions {
	/** Override the store clock for this prune pass. */
	now?: Date;
	/** Optionally prune consumed rows at or before this retention boundary. */
	consumedBefore?: Date;
}

export interface OperationPlanStoreOptions {
	clock?: () => Date;
	generateId?: () => string;
	defaultTtlMs?: number;
	payloadCodec?: {
		encode(canonicalPayload: string): string;
		decode(storedPayload: string): string;
	};
}

type OperationPlanDatabase = typeof db;
type OperationPlanRow = typeof operationPlans.$inferSelect;

function cloneDate(value: Date): Date {
	return new Date(value.getTime());
}

function checkedNow(clock: () => Date, override?: Date): Date {
	const now = cloneDate(override ?? clock());
	if (!Number.isFinite(now.getTime())) throw new TypeError('Operation plan time must be valid');
	return now;
}

const identityPayloadCodec = {
	encode: (payload: string) => payload,
	decode: (payload: string) => payload
};

function decodePlan<T>(
	row: OperationPlanRow,
	payloadCodec: NonNullable<OperationPlanStoreOptions['payloadCodec']>
): OperationPlan<T> {
	let payload: unknown;
	try {
		const canonicalPayload = payloadCodec.decode(row.payload);
		payload = JSON.parse(canonicalPayload);
		if (canonicalJson(payload) !== canonicalPayload) {
			throw new Error('payload is not canonical');
		}
		if (hashCanonicalJsonText(canonicalPayload) !== row.digest) {
			throw new Error('digest does not match payload');
		}
	} catch {
		throw new OperationPlanError('plan_corrupt', row.id);
	}

	return {
		id: row.id,
		kind: row.kind,
		serverInstanceId: row.serverInstanceId,
		librarySectionKey: row.librarySectionKey,
		payload: payload as T,
		digest: row.digest,
		createdAt: cloneDate(row.createdAt),
		expiresAt: cloneDate(row.expiresAt),
		consumedAt: row.consumedAt ? cloneDate(row.consumedAt) : null
	};
}

function assertPlanExpectations(
	plan: OperationPlan<unknown>,
	expectations: OperationPlanExpectations,
	now: Date
): void {
	if (plan.consumedAt !== null) throw new OperationPlanError('plan_consumed', plan.id);
	if (plan.expiresAt.getTime() <= now.getTime()) {
		throw new OperationPlanError('plan_expired', plan.id);
	}
	if (expectations.kind !== undefined && expectations.kind !== plan.kind) {
		throw new OperationPlanError('plan_kind_mismatch', plan.id);
	}
	if (expectations.digest !== undefined && expectations.digest !== plan.digest) {
		throw new OperationPlanError('plan_digest_mismatch', plan.id);
	}
	if (
		Object.hasOwn(expectations, 'serverInstanceId') &&
		expectations.serverInstanceId !== plan.serverInstanceId
	) {
		throw new OperationPlanError('plan_scope_mismatch', plan.id);
	}
	if (
		Object.hasOwn(expectations, 'librarySectionKey') &&
		expectations.librarySectionKey !== plan.librarySectionKey
	) {
		throw new OperationPlanError('plan_scope_mismatch', plan.id);
	}
	if (
		Object.hasOwn(expectations, 'payload') &&
		canonicalJsonDigest(expectations.payload).digest !== plan.digest
	) {
		throw new OperationPlanError('plan_payload_mismatch', plan.id);
	}
}

function assertKind(kind: string): void {
	if (kind.length === 0 || kind.trim() !== kind) {
		throw new TypeError('Operation plan kind must be a non-empty, trimmed string');
	}
}

function assertPositiveTtl(ttlMs: number): void {
	if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
		throw new RangeError('Operation plan TTL must be a positive finite number');
	}
}

/**
 * Build a store over a Drizzle database. The injected clock/id generator keep the
 * lifecycle deterministic in tests while the default singleton uses wall time and UUIDs.
 */
export function createOperationPlanStore(
	database: OperationPlanDatabase,
	options: OperationPlanStoreOptions = {}
) {
	const clock = options.clock ?? (() => new Date());
	const generateId = options.generateId ?? randomUUID;
	const defaultTtlMs = options.defaultTtlMs ?? DEFAULT_OPERATION_PLAN_TTL_MS;
	const payloadCodec = options.payloadCodec ?? identityPayloadCodec;
	assertPositiveTtl(defaultTtlMs);

	async function create<T>(input: CreateOperationPlanInput<T>): Promise<OperationPlan<T>> {
		assertKind(input.kind);
		if (input.ttlMs !== undefined && input.expiresAt !== undefined) {
			throw new TypeError('Specify either ttlMs or expiresAt, not both');
		}

		const createdAt = checkedNow(clock);
		const expiresAt = input.expiresAt
			? checkedNow(clock, input.expiresAt)
			: new Date(createdAt.getTime() + (input.ttlMs ?? defaultTtlMs));
		if (input.ttlMs !== undefined) assertPositiveTtl(input.ttlMs);
		if (expiresAt.getTime() <= createdAt.getTime()) {
			throw new RangeError('Operation plan expiry must be after its creation time');
		}

		const id = generateId();
		if (!id) throw new TypeError('Operation plan id generator returned an empty id');
		const { canonicalJson: payload, digest } = canonicalJsonDigest(input.payload);
		const [row] = await database
			.insert(operationPlans)
			.values({
				id,
				kind: input.kind,
				serverInstanceId: input.serverInstanceId ?? null,
				librarySectionKey: input.librarySectionKey ?? null,
				payload: payloadCodec.encode(payload),
				digest,
				createdAt,
				expiresAt,
				consumedAt: null
			})
			.returning();

		return decodePlan<T>(row, payloadCodec);
	}

	async function loadRow(id: string): Promise<OperationPlanRow | null> {
		const [row] = await database
			.select()
			.from(operationPlans)
			.where(eq(operationPlans.id, id))
			.limit(1);
		return row ?? null;
	}

	async function load<T = JsonValue>(id: string): Promise<OperationPlan<T> | null> {
		const row = await loadRow(id);
		return row ? decodePlan<T>(row, payloadCodec) : null;
	}

	async function validate<T = JsonValue>(
		id: string,
		expectations: OperationPlanExpectations = {},
		nowOverride?: Date
	): Promise<OperationPlan<T>> {
		const row = await loadRow(id);
		if (!row) throw new OperationPlanError('plan_not_found', id);
		const plan = decodePlan<T>(row, payloadCodec);
		const now = checkedNow(clock, nowOverride);
		assertPlanExpectations(plan, expectations, now);
		return plan;
	}

	async function consume<T = JsonValue>(
		id: string,
		expectations: OperationPlanExpectations = {},
		nowOverride?: Date
	): Promise<OperationPlan<T>> {
		const now = checkedNow(clock, nowOverride);
		const stored = await loadRow(id);
		if (!stored) throw new OperationPlanError('plan_not_found', id);
		const plan = decodePlan<T>(stored, payloadCodec);
		assertPlanExpectations(plan, expectations, now);

		// Compare-and-set is the single-use boundary. Including every immutable stored
		// field prevents a concurrently altered row from being consumed after validation.
		const [row] = await database
			.update(operationPlans)
			.set({ consumedAt: now })
			.where(
				and(
					eq(operationPlans.id, plan.id),
					eq(operationPlans.kind, plan.kind),
					eq(operationPlans.payload, stored.payload),
					eq(operationPlans.digest, plan.digest),
					eq(operationPlans.createdAt, plan.createdAt),
					eq(operationPlans.expiresAt, plan.expiresAt),
					plan.serverInstanceId === null
						? isNull(operationPlans.serverInstanceId)
						: eq(operationPlans.serverInstanceId, plan.serverInstanceId),
					plan.librarySectionKey === null
						? isNull(operationPlans.librarySectionKey)
						: eq(operationPlans.librarySectionKey, plan.librarySectionKey),
					isNull(operationPlans.consumedAt),
					gt(operationPlans.expiresAt, now)
				)
			)
			.returning();

		if (row) return decodePlan<T>(row, payloadCodec);

		// Classify a lost race precisely (replay, expiry, deletion, or corruption).
		// If the replacement row is otherwise valid, require a new preview as stale.
		await validate<T>(id, expectations, now);
		throw new OperationPlanError('plan_stale', id);
	}

	async function prune(pruneOptions: PruneOperationPlansOptions = {}): Promise<number> {
		const now = checkedNow(clock, pruneOptions.now);
		const condition = pruneOptions.consumedBefore
			? or(
					lte(operationPlans.expiresAt, now),
					and(
						isNotNull(operationPlans.consumedAt),
						lte(operationPlans.consumedAt, checkedNow(clock, pruneOptions.consumedBefore))
					)
				)
			: lte(operationPlans.expiresAt, now);
		const deleted = await database
			.delete(operationPlans)
			.where(condition)
			.returning({ id: operationPlans.id });
		return deleted.length;
	}

	return { create, load, validate, consume, prune };
}

export const operationPlanStore = createOperationPlanStore(db, {
	payloadCodec: {
		encode: encodeOperationPlanPayload,
		decode: decodeOperationPlanPayload
	}
});

export function pruneOperationPlans(options: PruneOperationPlansOptions = {}): Promise<number> {
	return operationPlanStore.prune(options);
}
