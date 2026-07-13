import { describe, expect, it } from 'vitest';
import { hashCanonicalJson } from '../plans/canonical-json';
import {
	CUSTOM_UPLOAD_CONTENT_TYPES,
	CUSTOM_UPLOAD_PLAN_KIND,
	CUSTOM_UPLOAD_PLAN_VERSION,
	CustomUploadPlanError,
	assertCustomUploadPlanPayload,
	confirmCustomUploadPlan,
	createCustomUploadPlanPreview,
	type CustomUploadOperationPlanStore,
	type CustomUploadPlanExpectations,
	type CustomUploadStoredPlan
} from './custom-upload-plan';

const CURRENT_FINGERPRINT = 'a'.repeat(64);
const EXPIRES_AT = new Date('2026-07-11T12:15:00.000Z');

function jpeg(tail = 1): Uint8Array {
	return Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, tail);
}

function png(): Uint8Array {
	return Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1);
}

function webp(): Uint8Array {
	return Uint8Array.of(0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1);
}

class MemoryPlanStore implements CustomUploadOperationPlanStore {
	plan: CustomUploadStoredPlan<unknown> | null = null;
	consumed = false;
	validateCalls: Array<{ id: string; expectations: CustomUploadPlanExpectations }> = [];
	consumeCalls: Array<{ id: string; expectations: CustomUploadPlanExpectations }> = [];

	async create<T>(input: {
		kind: string;
		payload: T;
		serverInstanceId?: string | null;
		ttlMs?: number;
	}): Promise<CustomUploadStoredPlan<T>> {
		const plan: CustomUploadStoredPlan<T> = {
			id: 'custom-plan-1',
			kind: input.kind,
			serverInstanceId: input.serverInstanceId ?? null,
			payload: input.payload,
			digest: hashCanonicalJson(input.payload),
			expiresAt: EXPIRES_AT,
			consumedAt: null
		};
		this.plan = plan;
		return plan;
	}

	async validate<T = unknown>(
		id: string,
		expectations: CustomUploadPlanExpectations = {}
	): Promise<CustomUploadStoredPlan<T>> {
		this.validateCalls.push({ id, expectations });
		if (!this.plan || this.plan.id !== id) throw new Error('plan_not_found');
		if (this.consumed) throw new Error('plan_consumed');
		if (expectations.kind !== undefined && expectations.kind !== this.plan.kind) {
			throw new Error('plan_kind_mismatch');
		}
		if (expectations.digest !== undefined && expectations.digest !== this.plan.digest) {
			throw new Error('plan_digest_mismatch');
		}
		if (
			Object.hasOwn(expectations, 'serverInstanceId') &&
			expectations.serverInstanceId !== this.plan.serverInstanceId
		) {
			throw new Error('plan_scope_mismatch');
		}
		if (
			Object.hasOwn(expectations, 'payload') &&
			hashCanonicalJson(expectations.payload) !== this.plan.digest
		) {
			throw new Error('plan_payload_mismatch');
		}
		return this.plan as CustomUploadStoredPlan<T>;
	}

	async consume<T = unknown>(
		id: string,
		expectations: CustomUploadPlanExpectations = {}
	): Promise<CustomUploadStoredPlan<T>> {
		this.consumeCalls.push({ id, expectations });
		const plan = await this.validate<T>(id, expectations);
		this.consumed = true;
		return { ...plan, consumedAt: new Date('2026-07-11T12:01:00.000Z') };
	}
}

async function preview(store: MemoryPlanStore, image = jpeg()) {
	return createCustomUploadPlanPreview(
		{
			serverInstanceId: 'server-a',
			mediaItemId: 7,
			targetId: 'rating-key-7',
			bytes: image,
			contentType: 'image/jpeg',
			currentFingerprint: CURRENT_FINGERPRINT,
			maxSizeBytes: 1024
		},
		store
	);
}

function confirmationInput(plan: Awaited<ReturnType<typeof preview>>, image = jpeg()) {
	return {
		planId: plan.planId,
		digest: plan.digest,
		serverInstanceId: 'server-a',
		mediaItemId: 7,
		targetId: 'rating-key-7',
		bytes: image,
		contentType: 'image/jpeg',
		sizeBytes: image.byteLength,
		currentFingerprint: CURRENT_FINGERPRINT,
		maxSizeBytes: 1024
	};
}

describe('custom upload operation plan', () => {
	it('creates a versioned root-poster preview containing identity but no image bytes', async () => {
		const store = new MemoryPlanStore();
		const image = jpeg();
		const result = await preview(store, image);

		expect(result).toEqual({
			planId: 'custom-plan-1',
			digest: expect.stringMatching(/^[a-f0-9]{64}$/),
			expiresAt: EXPIRES_AT.toISOString(),
			target: {
				serverInstanceId: 'server-a',
				mediaItemId: 7,
				targetId: 'rating-key-7'
			},
			slot: { kind: 'poster', season: null, episode: null },
			image: {
				sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
				contentType: 'image/jpeg',
				sizeBytes: image.byteLength
			},
			currentFingerprint: CURRENT_FINGERPRINT
		});
		expect(result).not.toHaveProperty('bytes');
		expect(store.plan?.payload).not.toHaveProperty('bytes');
		expect(store.plan).toMatchObject({
			kind: CUSTOM_UPLOAD_PLAN_KIND,
			serverInstanceId: 'server-a',
			payload: { type: CUSTOM_UPLOAD_PLAN_KIND, version: CUSTOM_UPLOAD_PLAN_VERSION }
		});
		assertCustomUploadPlanPayload(store.plan?.payload);
	});

	it.each([
		['image/jpeg', jpeg()],
		['image/png', png()],
		['image/webp', webp()]
	] as const)('accepts the supported %s signature', async (contentType, image) => {
		const store = new MemoryPlanStore();
		const result = await createCustomUploadPlanPreview(
			{
				serverInstanceId: 'server-a',
				mediaItemId: 7,
				targetId: 'rating-key-7',
				bytes: image,
				contentType,
				currentFingerprint: null,
				maxSizeBytes: 1024
			},
			store
		);

		expect(CUSTOM_UPLOAD_CONTENT_TYPES).toContain(result.image.contentType);
		expect(result.image.sizeBytes).toBe(image.byteLength);
	});

	it('rejects unsupported, mislabeled, empty, and oversized images before plan creation', async () => {
		const base = {
			serverInstanceId: 'server-a',
			mediaItemId: 7,
			targetId: 'rating-key-7',
			currentFingerprint: null
		};
		await expect(
			createCustomUploadPlanPreview(
				{ ...base, bytes: jpeg(), contentType: 'image/gif', maxSizeBytes: 1024 },
				new MemoryPlanStore()
			)
		).rejects.toMatchObject({ code: 'unsupported_content_type' });
		await expect(
			createCustomUploadPlanPreview(
				{ ...base, bytes: jpeg(), contentType: 'image/png', maxSizeBytes: 1024 },
				new MemoryPlanStore()
			)
		).rejects.toMatchObject({ code: 'content_signature_mismatch' });
		await expect(
			createCustomUploadPlanPreview(
				{ ...base, bytes: new Uint8Array(), contentType: 'image/jpeg', maxSizeBytes: 1024 },
				new MemoryPlanStore()
			)
		).rejects.toMatchObject({ code: 'image_size_mismatch' });
		const oversizedStore = new MemoryPlanStore();
		await expect(
			createCustomUploadPlanPreview(
				{ ...base, bytes: jpeg(), contentType: 'image/jpeg', maxSizeBytes: 4 },
				oversizedStore
			)
		).rejects.toMatchObject({ code: 'image_too_large' });
		expect(oversizedStore.plan).toBeNull();
	});

	it('confirms and consumes only the exact bytes, metadata, target, state, and digest', async () => {
		const store = new MemoryPlanStore();
		const image = jpeg();
		const planned = await preview(store, image);
		const confirmed = await confirmCustomUploadPlan(confirmationInput(planned, image), store);

		expect(confirmed).toMatchObject({
			planId: planned.planId,
			digest: planned.digest,
			payload: {
				target: { serverInstanceId: 'server-a', mediaItemId: 7, targetId: 'rating-key-7' },
				image: planned.image,
				currentFingerprint: CURRENT_FINGERPRINT
			}
		});
		expect(confirmed.bytes).toEqual(image);
		expect(confirmed.bytes).not.toBe(image);
		expect(store.consumed).toBe(true);
		expect(store.validateCalls[0]?.expectations).toMatchObject({
			kind: CUSTOM_UPLOAD_PLAN_KIND,
			digest: planned.digest,
			serverInstanceId: 'server-a'
		});
		expect(store.consumeCalls[0]?.expectations).toMatchObject({
			kind: CUSTOM_UPLOAD_PLAN_KIND,
			digest: planned.digest,
			serverInstanceId: 'server-a',
			payload: store.plan?.payload
		});
	});

	it('rejects changed bytes, type, declared size, or target without consuming the plan', async () => {
		const store = new MemoryPlanStore();
		const planned = await preview(store);

		await expect(
			confirmCustomUploadPlan(confirmationInput(planned, jpeg(2)), store)
		).rejects.toMatchObject({ code: 'image_digest_mismatch' });
		await expect(
			confirmCustomUploadPlan(
				{
					...confirmationInput(planned),
					bytes: png(),
					contentType: 'image/png',
					sizeBytes: png().length
				},
				store
			)
		).rejects.toMatchObject({ code: 'image_type_mismatch' });
		await expect(
			confirmCustomUploadPlan(
				{ ...confirmationInput(planned), sizeBytes: jpeg().length + 1 },
				store
			)
		).rejects.toMatchObject({ code: 'image_size_mismatch' });
		await expect(
			confirmCustomUploadPlan(
				{ ...confirmationInput(planned), targetId: 'different-target' },
				store
			)
		).rejects.toMatchObject({ code: 'plan_scope_mismatch' });
		expect(store.consumeCalls).toEqual([]);
		expect(store.consumed).toBe(false);
	});

	it('rejects a stale current fingerprint and a wrong digest without consuming', async () => {
		const store = new MemoryPlanStore();
		const planned = await preview(store);

		await expect(
			confirmCustomUploadPlan(
				{ ...confirmationInput(planned), currentFingerprint: 'b'.repeat(64) },
				store
			)
		).rejects.toMatchObject({ code: 'plan_stale' });
		await expect(
			confirmCustomUploadPlan({ ...confirmationInput(planned), digest: 'c'.repeat(64) }, store)
		).rejects.toThrow('plan_digest_mismatch');
		expect(store.consumeCalls).toEqual([]);
	});

	it('rejects structurally corrupt or non-root-poster payloads', () => {
		expect(() =>
			assertCustomUploadPlanPayload({
				type: CUSTOM_UPLOAD_PLAN_KIND,
				version: CUSTOM_UPLOAD_PLAN_VERSION,
				target: { serverInstanceId: 'server-a', mediaItemId: 7, targetId: 'target-7' },
				slot: { kind: 'background', season: null, episode: null },
				image: { sha256: 'a'.repeat(64), contentType: 'image/jpeg', sizeBytes: 5 },
				currentFingerprint: null
			})
		).toThrow(CustomUploadPlanError);
		expect(() =>
			assertCustomUploadPlanPayload({
				type: CUSTOM_UPLOAD_PLAN_KIND,
				version: CUSTOM_UPLOAD_PLAN_VERSION,
				target: { serverInstanceId: 'server-a', mediaItemId: 7, targetId: 'target-7' },
				slot: { kind: 'poster', season: null, episode: null },
				image: { sha256: 'a'.repeat(64), contentType: 'image/jpeg', sizeBytes: 5 },
				currentFingerprint: null,
				bytes: [255, 216, 255]
			})
		).toThrow(CustomUploadPlanError);
	});
});
