import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/plans/operation-plan-store', () => ({ operationPlanStore: {} }));
vi.mock('$lib/server/queries', () => ({ getMediaItem: vi.fn() }));
vi.mock('$lib/server/server-instances', () => ({
	getActiveServerInstance: vi.fn(),
	resolveMediaServerInstance: vi.fn()
}));

import type { MediaServer, ServerArtwork } from '$lib/server/media-server';
import { hashCanonicalJson } from '$lib/server/plans/canonical-json';
import { sha256Bytes } from '$lib/server/revisions/verification';
import {
	CUSTOM_UPLOAD_PLAN_KIND,
	type CustomUploadOperationPlanStore,
	type CustomUploadPlanExpectations,
	type CustomUploadStoredPlan
} from './custom-upload-plan';
import {
	createCustomUploadRuntime,
	type CustomUploadRuntimeDependencies
} from './custom-upload-runtime';
import type { ArtworkRevisionLedger } from './ledger';
import type { ArtworkSnapshotRepository } from './snapshots';

const NOW = new Date('2026-07-11T15:00:00.000Z');

function jpeg(tail: number): Uint8Array {
	return Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, tail, 0, 0, 0, 0, 0, 0, 0);
}

function png(): Uint8Array {
	return Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4);
}

function arrayBuffer(value: Uint8Array): ArrayBuffer {
	return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function artwork(value: Uint8Array, identity: string): ServerArtwork {
	return {
		kind: 'poster',
		url: `https://server.invalid/${identity}`,
		identity,
		data: arrayBuffer(value),
		contentType: 'image/jpeg'
	};
}

class PlanStoreError extends Error {
	constructor(readonly code: string) {
		super(code);
	}
}

class MemoryPlanStore implements CustomUploadOperationPlanStore {
	plan: CustomUploadStoredPlan<unknown> | null = null;
	consumed = false;
	readonly events: string[];

	constructor(events: string[]) {
		this.events = events;
	}

	async create<T>(input: {
		kind: string;
		payload: T;
		serverInstanceId?: string | null;
		ttlMs?: number;
	}): Promise<CustomUploadStoredPlan<T>> {
		this.events.push('plan:create');
		const plan: CustomUploadStoredPlan<T> = {
			id: 'upload-plan-1',
			kind: input.kind,
			serverInstanceId: input.serverInstanceId ?? null,
			payload: input.payload,
			digest: hashCanonicalJson(input.payload),
			expiresAt: new Date(NOW.getTime() + 60_000),
			consumedAt: null
		};
		this.plan = plan;
		return plan;
	}

	async validate<T = unknown>(
		id: string,
		expectations: CustomUploadPlanExpectations = {}
	): Promise<CustomUploadStoredPlan<T>> {
		this.events.push('plan:validate');
		if (!this.plan || this.plan.id !== id) throw new PlanStoreError('plan_not_found');
		if (this.consumed) throw new PlanStoreError('plan_consumed');
		if (expectations.kind && expectations.kind !== this.plan.kind) {
			throw new PlanStoreError('plan_kind_mismatch');
		}
		if (expectations.digest && expectations.digest !== this.plan.digest) {
			throw new PlanStoreError('plan_digest_mismatch');
		}
		if (
			Object.hasOwn(expectations, 'serverInstanceId') &&
			expectations.serverInstanceId !== this.plan.serverInstanceId
		) {
			throw new PlanStoreError('plan_scope_mismatch');
		}
		if (
			Object.hasOwn(expectations, 'payload') &&
			hashCanonicalJson(expectations.payload) !== this.plan.digest
		) {
			throw new PlanStoreError('plan_payload_mismatch');
		}
		return this.plan as CustomUploadStoredPlan<T>;
	}

	async consume<T = unknown>(
		id: string,
		expectations: CustomUploadPlanExpectations = {}
	): Promise<CustomUploadStoredPlan<T>> {
		this.events.push('plan:consume');
		const plan = await this.validate<T>(id, expectations);
		this.consumed = true;
		return { ...plan, consumedAt: NOW };
	}
}

interface Fixture {
	runtime: ReturnType<typeof createCustomUploadRuntime>;
	store: MemoryPlanStore;
	events: string[];
	captureServer: ReturnType<typeof vi.fn>;
	createGroup: ReturnType<typeof vi.fn>;
	recordOutcome: ReturnType<typeof vi.fn>;
	finalizeGroup: ReturnType<typeof vi.fn>;
	applyPosterBytes: ReturnType<typeof vi.fn>;
	active: { value: string | null };
}

function fixture(reads: Array<ServerArtwork | null | Error>): Fixture {
	const events: string[] = [];
	const store = new MemoryPlanStore(events);
	let snapshotNumber = 0;
	let artworkVersion = 0;
	const captureServer = vi.fn(async (input: { isOriginal?: boolean }) => {
		const label = input.isOriginal ? 'original' : snapshotNumber === 1 ? 'prior' : 'after';
		events.push(`snapshot:${label}`);
		snapshotNumber += 1;
		return { id: `snapshot-${snapshotNumber}` };
	});
	const createGroup = vi.fn(async () => {
		events.push('ledger:create');
		return { id: 'group-1' };
	});
	const recordOutcome = vi.fn(
		async (input: { slotState?: { advanceArtworkVersion?: boolean } }) => {
			events.push('ledger:record');
			if (input.slotState?.advanceArtworkVersion) artworkVersion += 1;
			return {
				revision: { id: 'revision-1' },
				currentSlotState: input.slotState ? { artworkVersion } : null
			};
		}
	);
	const finalizeGroup = vi.fn(async () => {
		events.push('ledger:finalize');
		return { id: 'group-1' };
	});
	const queue = [...reads];
	const readArtwork = vi.fn(async () => {
		events.push('server:read');
		const next = queue.shift();
		if (next instanceof Error) throw next;
		return next ?? null;
	});
	const applyPosterBytes = vi.fn(async () => {
		events.push('server:apply');
	});
	const server = {
		identity: { instanceId: 'server-a', name: 'Server A', type: 'plex' },
		readArtwork,
		applyPosterBytes
	} as unknown as MediaServer;
	const active = { value: 'server-a' as string | null };
	const dependencies: CustomUploadRuntimeDependencies = {
		store,
		snapshots: { captureServer } as unknown as ArtworkSnapshotRepository,
		ledger: {
			createGroup,
			recordOutcome,
			finalizeGroup
		} as unknown as ArtworkRevisionLedger,
		getActiveServerInstanceId: async () => active.value,
		getItem: async (mediaItemId, serverInstanceId) =>
			mediaItemId === 7 || mediaItemId === 8
				? {
						id: mediaItemId,
						serverInstanceId,
						targetId: `target-${mediaItemId}`
					}
				: null,
		resolveServer: async () => server,
		clock: () => NOW
	};
	return {
		runtime: createCustomUploadRuntime(dependencies),
		store,
		events,
		captureServer,
		createGroup,
		recordOutcome,
		finalizeGroup,
		applyPosterBytes,
		active
	};
}

async function preview(fixture: Fixture, bytes = jpeg(9), mediaItemId = 7) {
	return fixture.runtime.preview({
		mediaItemId,
		bytes,
		contentType: 'image/jpeg',
		maxSizeBytes: 1024
	});
}

function confirmation(
	plan: Awaited<ReturnType<typeof preview>>,
	bytes = jpeg(9),
	mediaItemId = 7,
	contentType: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/jpeg'
) {
	return {
		mediaItemId,
		planId: plan.planId,
		digest: plan.digest,
		bytes,
		contentType,
		sizeBytes: bytes.byteLength,
		maxSizeBytes: 1024
	};
}

describe('custom upload runtime', () => {
	beforeEach(() => vi.clearAllMocks());

	it('previews the live active item without snapshots, revisions, or server mutation', async () => {
		const before = artwork(jpeg(1), 'before');
		const subject = fixture([before]);
		const result = await preview(subject);

		expect(result).toMatchObject({
			target: { serverInstanceId: 'server-a', mediaItemId: 7, targetId: 'target-7' },
			currentFingerprint: sha256Bytes(before.data),
			image: { contentType: 'image/jpeg', sizeBytes: jpeg(9).byteLength }
		});
		expect(result).not.toHaveProperty('bytes');
		expect(subject.captureServer).not.toHaveBeenCalled();
		expect(subject.createGroup).not.toHaveBeenCalled();
		expect(subject.applyPosterBytes).not.toHaveBeenCalled();
	});

	it('consumes before mutation, snapshots original/prior/after, verifies exact, and advances once', async () => {
		const upload = jpeg(9);
		const before = artwork(jpeg(1), 'before');
		const after = artwork(upload, 'after');
		const subject = fixture([before, before, after]);
		const plan = await preview(subject, upload);
		const result = await subject.runtime.confirm(confirmation(plan, upload));

		expect(result).toMatchObject({
			ok: true,
			status: 'success',
			verification: 'exact',
			artworkVersion: 1,
			observedFingerprint: sha256Bytes(upload)
		});
		expect(subject.store.consumed).toBe(true);
		expect(subject.events.indexOf('plan:consume')).toBeLessThan(
			subject.events.indexOf('snapshot:original')
		);
		expect(subject.events.indexOf('snapshot:prior')).toBeLessThan(
			subject.events.indexOf('server:apply')
		);
		expect(subject.captureServer).toHaveBeenCalledTimes(3);
		expect(subject.applyPosterBytes).toHaveBeenCalledWith(
			'target-7',
			expect.any(ArrayBuffer),
			'image/jpeg'
		);
		expect(subject.recordOutcome).toHaveBeenCalledWith(
			expect.objectContaining({
				outcome: 'success',
				verification: 'exact',
				applyMethod: 'server_bytes',
				sourceProvider: 'custom_upload',
				slotState: expect.objectContaining({ advanceArtworkVersion: true })
			})
		);
		expect(subject.finalizeGroup).toHaveBeenCalledOnce();
	});

	it('records changed transcoded evidence as best-effort and advances version', async () => {
		const before = artwork(jpeg(1), 'before');
		const subject = fixture([before, before, artwork(jpeg(8), 'transcoded')]);
		const plan = await preview(subject);
		const result = await subject.runtime.confirm(confirmation(plan));

		expect(result).toMatchObject({
			ok: true,
			verification: 'best_effort',
			artworkVersion: 1
		});
		expect(subject.recordOutcome).toHaveBeenCalledWith(
			expect.objectContaining({
				outcome: 'success',
				verification: 'best_effort',
				slotState: expect.objectContaining({ advanceArtworkVersion: true })
			})
		);
	});

	it('records an unchanged post-write read as mismatch without advancing version', async () => {
		const before = artwork(jpeg(1), 'same');
		const subject = fixture([before, before, before]);
		const plan = await preview(subject);
		const result = await subject.runtime.confirm(confirmation(plan));

		expect(result).toMatchObject({
			ok: false,
			status: 'failed',
			verification: 'mismatch',
			artworkVersion: 0,
			errorCode: 'artwork_unchanged_after_write'
		});
		expect(subject.recordOutcome).toHaveBeenCalledWith(
			expect.objectContaining({
				outcome: 'failed',
				verification: 'mismatch',
				slotState: expect.objectContaining({ advanceArtworkVersion: false })
			})
		);
		expect(subject.finalizeGroup).toHaveBeenCalledOnce();
	});

	it('rejects changed bytes or type before consumption, snapshots, or apply', async () => {
		const before = artwork(jpeg(1), 'before');
		const changedBytes = fixture([before, before]);
		const changedBytesPlan = await preview(changedBytes);
		await expect(
			changedBytes.runtime.confirm(confirmation(changedBytesPlan, jpeg(8)))
		).rejects.toMatchObject({ code: 'image_digest_mismatch' });
		expect(changedBytes.store.consumed).toBe(false);
		expect(changedBytes.captureServer).not.toHaveBeenCalled();
		expect(changedBytes.applyPosterBytes).not.toHaveBeenCalled();

		const changedType = fixture([before, before]);
		const changedTypePlan = await preview(changedType);
		await expect(
			changedType.runtime.confirm(confirmation(changedTypePlan, png(), 7, 'image/png'))
		).rejects.toMatchObject({ code: 'image_type_mismatch' });
		expect(changedType.store.consumed).toBe(false);
		expect(changedType.captureServer).not.toHaveBeenCalled();
		expect(changedType.applyPosterBytes).not.toHaveBeenCalled();
	});

	it('rejects stale live state and wrong item scope before consuming', async () => {
		const before = artwork(jpeg(1), 'before');
		const stale = fixture([before, artwork(jpeg(2), 'external-change')]);
		const stalePlan = await preview(stale);
		await expect(stale.runtime.confirm(confirmation(stalePlan))).rejects.toMatchObject({
			code: 'plan_stale'
		});
		expect(stale.store.consumed).toBe(false);
		expect(stale.applyPosterBytes).not.toHaveBeenCalled();

		const wrongItem = fixture([before, before]);
		const scopedPlan = await preview(wrongItem);
		await expect(
			wrongItem.runtime.confirm(confirmation(scopedPlan, jpeg(9), 8))
		).rejects.toMatchObject({ code: 'plan_scope_mismatch' });
		expect(wrongItem.store.consumed).toBe(false);
		expect(wrongItem.applyPosterBytes).not.toHaveBeenCalled();
	});

	it('rejects replay without a second mutation or revision', async () => {
		const upload = jpeg(9);
		const before = artwork(jpeg(1), 'before');
		const after = artwork(upload, 'after');
		const subject = fixture([before, before, after, after]);
		const plan = await preview(subject, upload);
		await subject.runtime.confirm(confirmation(plan, upload));
		await expect(subject.runtime.confirm(confirmation(plan, upload))).rejects.toMatchObject({
			code: 'plan_consumed'
		});

		expect(subject.applyPosterBytes).toHaveBeenCalledTimes(1);
		expect(subject.recordOutcome).toHaveBeenCalledTimes(1);
		expect(subject.captureServer).toHaveBeenCalledTimes(3);
	});

	it('uses only the active server scope', async () => {
		const subject = fixture([artwork(jpeg(1), 'before')]);
		subject.active.value = null;
		await expect(preview(subject)).rejects.toMatchObject({
			code: 'server_instance_not_found'
		});
		expect(subject.store.plan).toBeNull();

		subject.active.value = 'server-a';
		await expect(preview(subject, jpeg(9), 99)).rejects.toMatchObject({
			code: 'item_not_found'
		});
		expect(subject.store.plan).toBeNull();
	});

	it('uses the custom upload plan kind in the durable store', async () => {
		const subject = fixture([artwork(jpeg(1), 'before')]);
		await preview(subject);
		expect(subject.store.plan?.kind).toBe(CUSTOM_UPLOAD_PLAN_KIND);
	});
});
