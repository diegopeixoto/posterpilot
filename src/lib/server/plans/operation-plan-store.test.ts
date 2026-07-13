import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('$lib/server/db', async () => {
	const { createClient } = await import('@libsql/client');
	const { drizzle } = await import('drizzle-orm/libsql');
	const schema = await import('$lib/server/db/schema');
	const client = createClient({ url: ':memory:' });
	await client.execute(`
		CREATE TABLE operation_plans (
			id TEXT PRIMARY KEY NOT NULL,
			kind TEXT NOT NULL,
			server_instance_id TEXT,
			library_section_key TEXT,
			payload TEXT NOT NULL,
			digest TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			expires_at INTEGER NOT NULL,
			consumed_at INTEGER
		)
	`);
	return {
		db: drizzle(client, { schema }),
		migrateDb: async () => undefined
	};
});

import { db } from '$lib/server/db';
import { operationPlans } from '$lib/server/db/schema';
import {
	DEFAULT_OPERATION_PLAN_TTL_MS,
	createOperationPlanStore,
	type OperationPlanErrorCode
} from './operation-plan-store';
import { decodeOperationPlanPayload, encodeOperationPlanPayload } from './operation-plan-payload';

const START = Date.parse('2026-07-09T12:00:00.000Z');
let nowMs = START;
let idCounter = 0;

const store = createOperationPlanStore(db, {
	clock: () => new Date(nowMs),
	generateId: () => `plan-${++idCounter}`
});

async function expectPlanError(promise: Promise<unknown>, code: OperationPlanErrorCode) {
	await expect(promise).rejects.toMatchObject({
		name: 'OperationPlanError',
		code
	});
}

beforeEach(async () => {
	await db.delete(operationPlans);
	nowMs = START;
	idCounter = 0;
});

describe('operation plan creation and loading', () => {
	it('persists a canonical payload, digest, scope, and default expiry', async () => {
		const created = await store.create({
			kind: 'apply',
			serverInstanceId: 'server-1',
			librarySectionKey: 'movies',
			payload: { z: ['poster'], a: { itemId: 42 } }
		});
		const [row] = await db.select().from(operationPlans).where(eq(operationPlans.id, created.id));

		expect(created).toMatchObject({
			id: 'plan-1',
			kind: 'apply',
			serverInstanceId: 'server-1',
			librarySectionKey: 'movies',
			payload: { a: { itemId: 42 }, z: ['poster'] },
			digest: row.digest,
			consumedAt: null
		});
		expect(row.payload).toBe('{"a":{"itemId":42},"z":["poster"]}');
		expect(row.digest).toMatch(/^[0-9a-f]{64}$/);
		expect(created.createdAt.getTime()).toBe(START);
		expect(created.expiresAt.getTime()).toBe(START + DEFAULT_OPERATION_PLAN_TTL_MS);
	});

	it('supports absolute expiry and returns a detached parsed payload on load', async () => {
		const expiresAt = new Date(START + 30_000);
		const created = await store.create({
			kind: 'kometa_sync',
			payload: { operations: [{ type: 'write', path: 'config.yml' }] },
			expiresAt
		});
		created.payload.operations[0].type = 'changed-locally';

		const loaded = await store.load<typeof created.payload>(created.id);
		expect(loaded?.payload.operations[0].type).toBe('write');
		expect(loaded?.expiresAt.getTime()).toBe(expiresAt.getTime());
	});

	it('supports encrypted-at-rest payloads without weakening exact consume checks', async () => {
		const key = Buffer.alloc(32, 7);
		const encryptedStore = createOperationPlanStore(db, {
			clock: () => new Date(nowMs),
			generateId: () => 'encrypted-plan',
			payloadCodec: {
				encode: (payload) => encodeOperationPlanPayload(payload, key),
				decode: (payload) => decodeOperationPlanPayload(payload, key)
			}
		});
		const created = await encryptedStore.create({
			kind: 'kometa_sync',
			payload: { proposedContent: 'webhook-secret-value' }
		});
		const [row] = await db.select().from(operationPlans).where(eq(operationPlans.id, created.id));
		expect(row.payload).toMatch(/^enc:v1:/);
		expect(row.payload).not.toContain('webhook-secret-value');
		expect((await encryptedStore.load(created.id))?.payload).toEqual({
			proposedContent: 'webhook-secret-value'
		});
		await expect(
			encryptedStore.consume(created.id, { digest: created.digest })
		).resolves.toMatchObject({ consumedAt: new Date(nowMs) });
	});

	it('returns null when a plan does not exist', async () => {
		expect(await store.load('missing')).toBeNull();
	});

	it('rejects invalid creation lifetimes and kinds', async () => {
		await expect(store.create({ kind: '', payload: {}, ttlMs: 1_000 })).rejects.toThrow(
			/non-empty/
		);
		await expect(store.create({ kind: ' apply ', payload: {}, ttlMs: 1_000 })).rejects.toThrow(
			/trimmed/
		);
		await expect(store.create({ kind: 'apply', payload: {}, ttlMs: 0 })).rejects.toThrow(
			/positive/
		);
		await expect(
			store.create({ kind: 'apply', payload: {}, expiresAt: new Date(START) })
		).rejects.toThrow(/after its creation/);
		await expect(
			store.create({
				kind: 'apply',
				payload: {},
				ttlMs: 1_000,
				expiresAt: new Date(START + 1_000)
			})
		).rejects.toThrow(/either ttlMs or expiresAt/);
	});
});

describe('operation plan validation', () => {
	it('validates kind, digest, payload, and explicit nullable scope', async () => {
		const plan = await store.create({
			kind: 'cross_server_apply',
			serverInstanceId: null,
			librarySectionKey: null,
			payload: { targets: [{ serverId: 'server-2', itemId: 10 }] }
		});

		await expect(
			store.validate(plan.id, {
				kind: 'cross_server_apply',
				digest: plan.digest,
				payload: { targets: [{ itemId: 10, serverId: 'server-2' }] },
				serverInstanceId: null,
				librarySectionKey: null
			})
		).resolves.toMatchObject({ id: plan.id, digest: plan.digest });
	});

	it('classifies missing, kind, digest, payload, and scope mismatches', async () => {
		const plan = await store.create({
			kind: 'apply',
			serverInstanceId: 'server-1',
			librarySectionKey: 'movies',
			payload: { itemIds: [1, 2] }
		});

		await expectPlanError(store.validate('missing'), 'plan_not_found');
		await expectPlanError(store.validate(plan.id, { kind: 'undo' }), 'plan_kind_mismatch');
		await expectPlanError(
			store.validate(plan.id, { digest: '0'.repeat(64) }),
			'plan_digest_mismatch'
		);
		await expectPlanError(
			store.validate(plan.id, { payload: { itemIds: [2, 1] } }),
			'plan_payload_mismatch'
		);
		await expectPlanError(
			store.validate(plan.id, { serverInstanceId: 'server-2' }),
			'plan_scope_mismatch'
		);
		await expectPlanError(
			store.validate(plan.id, { librarySectionKey: null }),
			'plan_scope_mismatch'
		);
	});

	it('expires exactly at the expiry boundary', async () => {
		const plan = await store.create({ kind: 'apply', payload: {}, ttlMs: 1_000 });
		nowMs += 999;
		await expect(store.validate(plan.id)).resolves.toMatchObject({ id: plan.id });
		nowMs += 1;
		await expectPlanError(store.validate(plan.id), 'plan_expired');
	});

	it('detects payload or digest corruption before returning a plan', async () => {
		const payloadPlan = await store.create({ kind: 'apply', payload: { a: 1, b: 2 } });
		await db
			.update(operationPlans)
			.set({ payload: '{"b":2,"a":1}' })
			.where(eq(operationPlans.id, payloadPlan.id));
		await expectPlanError(store.load(payloadPlan.id), 'plan_corrupt');

		const digestPlan = await store.create({ kind: 'apply', payload: { safe: true } });
		await db
			.update(operationPlans)
			.set({ digest: 'f'.repeat(64) })
			.where(eq(operationPlans.id, digestPlan.id));
		await expectPlanError(store.validate(digestPlan.id), 'plan_corrupt');
	});
});

describe('single-use consumption and pruning', () => {
	it('atomically consumes a plan and rejects replay', async () => {
		const plan = await store.create({ kind: 'apply', payload: { itemId: 1 } });
		const consumed = await store.consume(plan.id, { kind: 'apply', digest: plan.digest });

		expect(consumed.consumedAt?.getTime()).toBe(START);
		expect((await store.load(plan.id))?.consumedAt?.getTime()).toBe(START);
		await expectPlanError(store.validate(plan.id), 'plan_consumed');
		await expectPlanError(store.consume(plan.id), 'plan_consumed');
	});

	it('allows only one winner when the same plan is consumed concurrently', async () => {
		const plan = await store.create({ kind: 'apply', payload: { itemId: 1 } });
		const results = await Promise.allSettled([store.consume(plan.id), store.consume(plan.id)]);
		const fulfilled = results.filter((result) => result.status === 'fulfilled');
		const rejected = results.filter((result) => result.status === 'rejected');

		expect(fulfilled).toHaveLength(1);
		expect(rejected).toHaveLength(1);
		expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
			code: 'plan_consumed'
		});
	});

	it('refuses to consume an expired plan without marking it consumed', async () => {
		const plan = await store.create({ kind: 'apply', payload: {}, ttlMs: 1_000 });
		nowMs += 1_000;
		await expectPlanError(store.consume(plan.id), 'plan_expired');
		expect((await store.load(plan.id))?.consumedAt).toBeNull();
	});

	it('prunes expired plans while retaining active and recently consumed plans', async () => {
		const expired = await store.create({ kind: 'apply', payload: { id: 1 }, ttlMs: 1_000 });
		const active = await store.create({ kind: 'apply', payload: { id: 2 }, ttlMs: 60_000 });
		const consumed = await store.create({ kind: 'apply', payload: { id: 3 }, ttlMs: 60_000 });
		await store.consume(consumed.id);

		nowMs += 1_000;
		expect(await store.prune()).toBe(1);
		expect(await store.load(expired.id)).toBeNull();
		expect(await store.load(active.id)).not.toBeNull();
		expect(await store.load(consumed.id)).not.toBeNull();

		expect(await store.prune({ consumedBefore: new Date(nowMs) })).toBe(1);
		expect(await store.load(consumed.id)).toBeNull();
		expect(await store.load(active.id)).not.toBeNull();
	});
});
