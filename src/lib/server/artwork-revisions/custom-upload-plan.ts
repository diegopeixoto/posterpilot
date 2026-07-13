import { createHash } from 'node:crypto';
import { hashCanonicalJson } from '../plans/canonical-json';

export const CUSTOM_UPLOAD_PLAN_KIND = 'custom_artwork_upload';
export const CUSTOM_UPLOAD_PLAN_VERSION = 1 as const;

export const CUSTOM_UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type CustomUploadContentType = (typeof CUSTOM_UPLOAD_CONTENT_TYPES)[number];

export interface CustomUploadPlanPayload {
	type: typeof CUSTOM_UPLOAD_PLAN_KIND;
	version: typeof CUSTOM_UPLOAD_PLAN_VERSION;
	target: {
		serverInstanceId: string;
		mediaItemId: number;
		targetId: string;
	};
	slot: {
		kind: 'poster';
		season: null;
		episode: null;
	};
	image: {
		sha256: string;
		contentType: CustomUploadContentType;
		sizeBytes: number;
	};
	currentFingerprint: string | null;
}

export interface CustomUploadStoredPlan<T> {
	id: string;
	kind: string;
	serverInstanceId: string | null;
	payload: T;
	digest: string;
	expiresAt: Date;
	consumedAt?: Date | null;
}

export interface CustomUploadPlanExpectations {
	kind?: string;
	digest?: string;
	payload?: unknown;
	serverInstanceId?: string | null;
}

/** Structural subset implemented by the durable operation-plan store. */
export interface CustomUploadOperationPlanStore {
	create<T>(input: {
		kind: string;
		payload: T;
		serverInstanceId?: string | null;
		ttlMs?: number;
	}): Promise<CustomUploadStoredPlan<T>>;
	validate<T = unknown>(
		id: string,
		expectations?: CustomUploadPlanExpectations
	): Promise<CustomUploadStoredPlan<T>>;
	consume<T = unknown>(
		id: string,
		expectations?: CustomUploadPlanExpectations
	): Promise<CustomUploadStoredPlan<T>>;
}

export type CustomUploadPlanErrorCode =
	| 'invalid_input'
	| 'unsupported_content_type'
	| 'content_signature_mismatch'
	| 'image_too_large'
	| 'image_size_mismatch'
	| 'image_type_mismatch'
	| 'image_digest_mismatch'
	| 'plan_scope_mismatch'
	| 'plan_stale'
	| 'invalid_plan';

/** Locale-neutral failure suitable for mapping at a future route boundary. */
export class CustomUploadPlanError extends Error {
	constructor(readonly code: CustomUploadPlanErrorCode) {
		super(`Custom artwork upload plan failed (${code}).`);
		this.name = 'CustomUploadPlanError';
	}
}

export interface CreateCustomUploadPlanInput {
	serverInstanceId: string;
	mediaItemId: number;
	targetId: string;
	bytes: ArrayBuffer | Uint8Array;
	contentType: string;
	currentFingerprint: string | null;
	/** Caller-owned policy boundary, deliberately not read from process environment. */
	maxSizeBytes: number;
	ttlMs?: number;
}

export interface CustomUploadPlanPreview {
	planId: string;
	digest: string;
	expiresAt: string;
	target: CustomUploadPlanPayload['target'];
	slot: CustomUploadPlanPayload['slot'];
	image: CustomUploadPlanPayload['image'];
	currentFingerprint: string | null;
}

export interface ConfirmCustomUploadPlanInput {
	planId: string;
	digest: string;
	serverInstanceId: string;
	mediaItemId: number;
	targetId: string;
	bytes: ArrayBuffer | Uint8Array;
	contentType: string;
	/** Explicit multipart/request size; it must also equal the received byte length. */
	sizeBytes: number;
	currentFingerprint: string | null;
	maxSizeBytes: number;
}

export interface ConfirmedCustomUploadPlan {
	planId: string;
	digest: string;
	payload: CustomUploadPlanPayload;
	/** Owned copy of the exact bytes authorized by the consumed plan. */
	bytes: Uint8Array;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
	const actual = Object.keys(value).sort();
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validDigest(value: unknown): value is string {
	return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function assertTrimmed(value: unknown): asserts value is string {
	if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
		throw new CustomUploadPlanError('invalid_input');
	}
}

function assertTarget(target: {
	serverInstanceId: unknown;
	mediaItemId: unknown;
	targetId: unknown;
}): void {
	assertTrimmed(target.serverInstanceId);
	assertTrimmed(target.targetId);
	if (!Number.isInteger(target.mediaItemId) || Number(target.mediaItemId) <= 0) {
		throw new CustomUploadPlanError('invalid_input');
	}
}

function assertMaximumSize(maxSizeBytes: number): void {
	if (!Number.isSafeInteger(maxSizeBytes) || maxSizeBytes <= 0) {
		throw new CustomUploadPlanError('invalid_input');
	}
}

function assertDeclaredSize(sizeBytes: number): void {
	if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
		throw new CustomUploadPlanError('image_size_mismatch');
	}
}

function contentType(value: string): CustomUploadContentType {
	if (!(CUSTOM_UPLOAD_CONTENT_TYPES as readonly string[]).includes(value)) {
		throw new CustomUploadPlanError('unsupported_content_type');
	}
	return value as CustomUploadContentType;
}

function ownedBytes(value: ArrayBuffer | Uint8Array): Uint8Array {
	return value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(value.slice(0));
}

function matchesSignature(value: Uint8Array, type: CustomUploadContentType): boolean {
	switch (type) {
		case 'image/jpeg':
			return value.length >= 3 && value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff;
		case 'image/png':
			return (
				value.length >= 8 &&
				value[0] === 0x89 &&
				value[1] === 0x50 &&
				value[2] === 0x4e &&
				value[3] === 0x47 &&
				value[4] === 0x0d &&
				value[5] === 0x0a &&
				value[6] === 0x1a &&
				value[7] === 0x0a
			);
		case 'image/webp':
			return (
				value.length >= 12 &&
				value[0] === 0x52 &&
				value[1] === 0x49 &&
				value[2] === 0x46 &&
				value[3] === 0x46 &&
				value[8] === 0x57 &&
				value[9] === 0x45 &&
				value[10] === 0x42 &&
				value[11] === 0x50
			);
	}
}

function sha256(value: Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}

function checkedImage(
	input: Pick<CreateCustomUploadPlanInput, 'bytes' | 'contentType' | 'maxSizeBytes'>
): { bytes: Uint8Array; contentType: CustomUploadContentType; sizeBytes: number; sha256: string } {
	assertMaximumSize(input.maxSizeBytes);
	const value = ownedBytes(input.bytes);
	const type = contentType(input.contentType);
	if (value.byteLength === 0) throw new CustomUploadPlanError('image_size_mismatch');
	if (value.byteLength > input.maxSizeBytes) throw new CustomUploadPlanError('image_too_large');
	if (!matchesSignature(value, type)) {
		throw new CustomUploadPlanError('content_signature_mismatch');
	}
	return { bytes: value, contentType: type, sizeBytes: value.byteLength, sha256: sha256(value) };
}

function assertFingerprint(value: unknown): asserts value is string | null {
	if (value !== null && !validDigest(value)) {
		throw new CustomUploadPlanError('invalid_input');
	}
}

/** Validate structural integrity before any confirmed bytes can reach a runtime. */
export function assertCustomUploadPlanPayload(
	payload: unknown
): asserts payload is CustomUploadPlanPayload {
	if (!isRecord(payload) || payload.type !== CUSTOM_UPLOAD_PLAN_KIND) {
		throw new CustomUploadPlanError('invalid_plan');
	}
	if (
		!hasExactKeys(payload, ['currentFingerprint', 'image', 'slot', 'target', 'type', 'version'])
	) {
		throw new CustomUploadPlanError('invalid_plan');
	}
	if (payload.version !== CUSTOM_UPLOAD_PLAN_VERSION) {
		throw new CustomUploadPlanError('invalid_plan');
	}
	if (!isRecord(payload.target) || !isRecord(payload.slot) || !isRecord(payload.image)) {
		throw new CustomUploadPlanError('invalid_plan');
	}
	if (
		!hasExactKeys(payload.target, ['mediaItemId', 'serverInstanceId', 'targetId']) ||
		!hasExactKeys(payload.slot, ['episode', 'kind', 'season']) ||
		!hasExactKeys(payload.image, ['contentType', 'sha256', 'sizeBytes'])
	) {
		throw new CustomUploadPlanError('invalid_plan');
	}
	try {
		assertTarget({
			serverInstanceId: payload.target.serverInstanceId,
			mediaItemId: payload.target.mediaItemId,
			targetId: payload.target.targetId
		});
	} catch {
		throw new CustomUploadPlanError('invalid_plan');
	}
	if (
		payload.slot.kind !== 'poster' ||
		payload.slot.season !== null ||
		payload.slot.episode !== null ||
		!validDigest(payload.image.sha256) ||
		!(CUSTOM_UPLOAD_CONTENT_TYPES as readonly unknown[]).includes(payload.image.contentType) ||
		!Number.isSafeInteger(payload.image.sizeBytes) ||
		Number(payload.image.sizeBytes) <= 0 ||
		(payload.currentFingerprint !== null && !validDigest(payload.currentFingerprint))
	) {
		throw new CustomUploadPlanError('invalid_plan');
	}
}

function assertStoredPlan(
	plan: CustomUploadStoredPlan<unknown>,
	serverInstanceId: string
): asserts plan is CustomUploadStoredPlan<CustomUploadPlanPayload> {
	if (
		!plan ||
		typeof plan.id !== 'string' ||
		plan.id.length === 0 ||
		plan.id.trim() !== plan.id ||
		plan.kind !== CUSTOM_UPLOAD_PLAN_KIND ||
		plan.serverInstanceId !== serverInstanceId ||
		!validDigest(plan.digest) ||
		!(plan.expiresAt instanceof Date) ||
		!Number.isFinite(plan.expiresAt.getTime())
	) {
		throw new CustomUploadPlanError('invalid_plan');
	}
	assertCustomUploadPlanPayload(plan.payload);
	if (
		plan.payload.target.serverInstanceId !== plan.serverInstanceId ||
		hashCanonicalJson(plan.payload) !== plan.digest
	) {
		throw new CustomUploadPlanError('invalid_plan');
	}
}

export async function createCustomUploadPlanPreview(
	input: CreateCustomUploadPlanInput,
	store: CustomUploadOperationPlanStore
): Promise<CustomUploadPlanPreview> {
	assertTarget(input);
	assertFingerprint(input.currentFingerprint);
	const image = checkedImage(input);
	const payload: CustomUploadPlanPayload = {
		type: CUSTOM_UPLOAD_PLAN_KIND,
		version: CUSTOM_UPLOAD_PLAN_VERSION,
		target: {
			serverInstanceId: input.serverInstanceId,
			mediaItemId: input.mediaItemId,
			targetId: input.targetId
		},
		slot: { kind: 'poster', season: null, episode: null },
		image: {
			sha256: image.sha256,
			contentType: image.contentType,
			sizeBytes: image.sizeBytes
		},
		currentFingerprint: input.currentFingerprint
	};
	const plan = await store.create({
		kind: CUSTOM_UPLOAD_PLAN_KIND,
		serverInstanceId: input.serverInstanceId,
		payload,
		...(input.ttlMs === undefined ? {} : { ttlMs: input.ttlMs })
	});
	assertStoredPlan(plan, input.serverInstanceId);
	if (plan.digest !== hashCanonicalJson(payload)) {
		throw new CustomUploadPlanError('invalid_plan');
	}
	return {
		planId: plan.id,
		digest: plan.digest,
		expiresAt: plan.expiresAt.toISOString(),
		target: plan.payload.target,
		slot: plan.payload.slot,
		image: plan.payload.image,
		currentFingerprint: plan.payload.currentFingerprint
	};
}

export async function confirmCustomUploadPlan(
	input: ConfirmCustomUploadPlanInput,
	store: CustomUploadOperationPlanStore
): Promise<ConfirmedCustomUploadPlan> {
	assertTrimmed(input.planId);
	assertTarget(input);
	assertFingerprint(input.currentFingerprint);
	if (!validDigest(input.digest)) throw new CustomUploadPlanError('invalid_input');
	assertDeclaredSize(input.sizeBytes);
	const image = checkedImage(input);
	if (image.sizeBytes !== input.sizeBytes) {
		throw new CustomUploadPlanError('image_size_mismatch');
	}
	const expectations: CustomUploadPlanExpectations = {
		kind: CUSTOM_UPLOAD_PLAN_KIND,
		digest: input.digest,
		serverInstanceId: input.serverInstanceId
	};
	const validated = await store.validate<unknown>(input.planId, expectations);
	assertStoredPlan(validated, input.serverInstanceId);
	const payload = validated.payload;
	if (
		payload.target.serverInstanceId !== input.serverInstanceId ||
		payload.target.mediaItemId !== input.mediaItemId ||
		payload.target.targetId !== input.targetId
	) {
		throw new CustomUploadPlanError('plan_scope_mismatch');
	}
	if (payload.currentFingerprint !== input.currentFingerprint) {
		throw new CustomUploadPlanError('plan_stale');
	}
	if (payload.image.contentType !== image.contentType) {
		throw new CustomUploadPlanError('image_type_mismatch');
	}
	if (payload.image.sizeBytes !== image.sizeBytes) {
		throw new CustomUploadPlanError('image_size_mismatch');
	}
	if (payload.image.sha256 !== image.sha256) {
		throw new CustomUploadPlanError('image_digest_mismatch');
	}

	const consumed = await store.consume<unknown>(input.planId, {
		...expectations,
		payload
	});
	assertStoredPlan(consumed, input.serverInstanceId);
	if (consumed.id !== validated.id || consumed.digest !== validated.digest) {
		throw new CustomUploadPlanError('invalid_plan');
	}
	return {
		planId: consumed.id,
		digest: consumed.digest,
		payload: consumed.payload,
		bytes: image.bytes
	};
}
