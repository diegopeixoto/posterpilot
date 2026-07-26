import { and, eq } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import { mediaCollections } from '$lib/server/db/schema';
import type { ArtworkRevisionLedger } from '$lib/server/artwork-revisions/ledger';
import type { ArtworkSnapshotRepository } from '$lib/server/artwork-revisions/snapshots';
import type {
	ApplyServerBinding,
	ApplyServerRegistry
} from '$lib/server/plans/apply-server-registry';
import { canonicalJson } from '$lib/server/plans/canonical-json';
import type { OperationPlan } from '$lib/server/plans/operation-plan-store';
import {
	sha256Bytes,
	unavailableArtworkVerification,
	verifyServerArtworkRead,
	type ArtworkVerification
} from '$lib/server/revisions/verification';
import type {
	CapabilitySupport,
	MediaServer,
	ServerArtwork,
	ServerArtworkKind
} from '$lib/server/media-server';
import {
	nativeCollectionCandidateSetFingerprint,
	type NativeCollectionArtworkCandidate,
	type NativeCollectionArtworkKind
} from './native-artwork-candidates';
import {
	loadNativeCollectionArtworkContext,
	type NativeCollectionArtworkContext
} from './native-artwork-context';
import {
	assertNativeCollectionArtworkPlan,
	buildNativeCollectionArtworkPlan,
	NATIVE_COLLECTION_ARTWORK_PLAN_KIND,
	type FrozenNativeCollectionCurrentArtwork,
	type NativeCollectionArtworkPlanOperation,
	type NativeCollectionArtworkPlanPayloadV1,
	type PublicNativeCollectionArtworkPreview
} from './native-artwork-plan';
import type { NativeCollectionCandidateBytes } from './native-artwork-source';
import { sanitizeNativeCollectionArtworkUrl } from './native-artwork-url';

type Database = LibSQLDatabase<typeof schema>;
type NativeLedger = Pick<
	ArtworkRevisionLedger,
	'createGroup' | 'recordOutcome' | 'finalizeGroup' | 'listTimeline'
>;
type NativeSnapshots = Pick<ArtworkSnapshotRepository, 'captureServer' | 'findOriginal'>;

export type NativeCollectionArtworkServiceErrorCode =
	| 'invalid_request'
	| 'collection_not_found'
	| 'native_collection_unavailable'
	| 'native_collection_server_unavailable'
	| 'native_collection_scope_mismatch'
	| 'native_collection_candidate_source_unavailable'
	| 'native_collection_candidate_not_found'
	| 'native_collection_candidate_unavailable'
	| 'native_collection_plan_stale'
	| 'native_collection_no_operations';

export class NativeCollectionArtworkServiceError extends Error {
	constructor(readonly code: NativeCollectionArtworkServiceErrorCode) {
		super(code);
		this.name = 'NativeCollectionArtworkServiceError';
	}
}

export interface NativeArtworkPlanStore {
	create<T>(input: {
		kind: string;
		payload: T;
		serverInstanceId?: string | null;
		ttlMs?: number;
	}): Promise<OperationPlan<T>>;
	validate<T = unknown>(
		id: string,
		expectations?: {
			kind?: string;
			digest?: string;
			payload?: unknown;
			serverInstanceId?: string | null;
		}
	): Promise<OperationPlan<T>>;
	consume<T = unknown>(
		id: string,
		expectations?: {
			kind?: string;
			digest?: string;
			payload?: unknown;
			serverInstanceId?: string | null;
		}
	): Promise<OperationPlan<T>>;
}

export interface NativeCollectionArtworkServiceDependencies {
	database: Database;
	serverRegistry: ApplyServerRegistry;
	planStore: NativeArtworkPlanStore;
	snapshots: NativeSnapshots;
	ledger: NativeLedger;
	loadCandidates(
		tmdbCollectionId: string,
		collectionName: string
	): Promise<NativeCollectionArtworkCandidate[]>;
	loadCandidateBytes(
		candidate: NativeCollectionArtworkCandidate
	): Promise<NativeCollectionCandidateBytes>;
	loadContext?: typeof loadNativeCollectionArtworkContext;
	updateProjection?(input: {
		context: NativeCollectionArtworkContext;
		kind: NativeCollectionArtworkKind;
		url: string | null;
		observedAt: Date;
	}): Promise<void>;
	clock?: () => Date;
}

export type NativeCollectionAvailabilityReason =
	| 'not_native'
	| 'provider_unknown'
	| 'server_unavailable'
	| 'server_scope_mismatch'
	| null;

export type NativeCollectionCandidateSourceReason =
	| 'member_identity_incomplete'
	| 'provider_unavailable'
	| 'no_candidates'
	| null;

export interface PublicNativeCollectionArtworkCandidate {
	id: string;
	kind: NativeCollectionArtworkKind;
	provider: NativeCollectionArtworkCandidate['provider'];
	language: string | null;
	width: number | null;
	height: number | null;
	score: number;
}

export interface NativeCollectionArtworkWorkspace {
	collection: {
		id: string;
		name: string;
		source: 'tmdb' | 'native';
		provider: 'plex' | 'jellyfin' | 'emby' | null;
		localMemberCount: number;
	};
	entity: {
		available: boolean;
		reason: NativeCollectionAvailabilityReason;
	};
	candidateSource: {
		available: boolean;
		reason: NativeCollectionCandidateSourceReason;
	};
	slots: Array<{
		kind: NativeCollectionArtworkKind;
		capability: CapabilitySupport;
		current: {
			state: FrozenNativeCollectionCurrentArtwork['state'];
			artworkVersion: number;
			hasPreview: boolean;
		};
		candidates: PublicNativeCollectionArtworkCandidate[];
	}>;
}

export interface PreviewNativeCollectionArtworkInput {
	serverInstanceId: string;
	mediaCollectionId: string;
	selections: Partial<Record<NativeCollectionArtworkKind, string>>;
	ttlMs?: number;
}

export interface ConfirmNativeCollectionArtworkInput {
	serverInstanceId: string;
	mediaCollectionId: string;
	planId: string;
	digest: string;
	initiator?: string;
}

export interface NativeCollectionArtworkApplyOperationResult {
	operationId: string;
	kind: NativeCollectionArtworkKind;
	status: 'success' | 'failed';
	verification: ArtworkVerification;
	errorCode: string | null;
	artworkVersion: number | null;
}

export interface NativeCollectionArtworkApplyResult {
	planId: string;
	digest: string;
	groupId: string;
	status: 'success' | 'partial' | 'failed';
	summary: { total: number; succeeded: number; failed: number };
	operations: NativeCollectionArtworkApplyOperationResult[];
}

interface BoundNativeCollection {
	context: NativeCollectionArtworkContext;
	binding: ApplyServerBinding;
}

interface PreparedPlan {
	payload: NativeCollectionArtworkPlanPayloadV1;
	bytesByCandidateId: Map<string, NativeCollectionCandidateBytes>;
}

interface ObservedSlot {
	artwork: ServerArtwork | null | undefined;
	frozen: FrozenNativeCollectionCurrentArtwork;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function serviceError(code: NativeCollectionArtworkServiceErrorCode): never {
	throw new NativeCollectionArtworkServiceError(code);
}

function identifier(value: string): string {
	if (!SAFE_ID.test(value) || value.includes('..') || value.includes(':/')) {
		serviceError('invalid_request');
	}
	return value;
}

function checkedNow(clock: () => Date): Date {
	const value = new Date(clock().getTime());
	if (!Number.isFinite(value.getTime())) serviceError('invalid_request');
	return value;
}

function slot(kind: NativeCollectionArtworkKind) {
	return { kind, season: null, episode: null } as const;
}

function writeMethod(server: MediaServer, kind: NativeCollectionArtworkKind) {
	return kind === 'poster'
		? server.applyCollectionPosterBytes
		: server.applyCollectionBackgroundBytes;
}

function effectiveCapability(
	context: NativeCollectionArtworkContext,
	server: MediaServer,
	kind: NativeCollectionArtworkKind
): CapabilitySupport {
	const entity =
		kind === 'poster' ? context.capabilities.posterWrite : context.capabilities.backgroundWrite;
	const provider = server.capabilities.collectionArtwork ?? 'unknown';
	if (entity === 'unsupported' || provider === 'unsupported' || !writeMethod(server, kind)) {
		return 'unsupported';
	}
	return entity === 'supported' && provider === 'supported' ? 'supported' : 'unknown';
}

function publicCandidate(
	candidate: NativeCollectionArtworkCandidate
): PublicNativeCollectionArtworkCandidate {
	return {
		id: candidate.id,
		kind: candidate.kind,
		provider: candidate.provider,
		language: candidate.language,
		width: candidate.width,
		height: candidate.height,
		score: candidate.score
	};
}

function previewDto(
	plan: OperationPlan<NativeCollectionArtworkPlanPayloadV1> | null,
	payload: NativeCollectionArtworkPlanPayloadV1
): PublicNativeCollectionArtworkPreview {
	return {
		planId: plan?.id ?? null,
		digest: plan?.digest ?? null,
		expiresAt: plan?.expiresAt.toISOString() ?? null,
		operations: payload.operations.map((operation) => ({
			id: operation.id,
			kind: operation.kind,
			candidateId: operation.candidate.id,
			provider: operation.candidate.provider,
			language: operation.candidate.language,
			expectedOverwrite: operation.expectedOverwrite,
			currentState: operation.current.state
		})),
		skips: payload.skips,
		summary: payload.summary
	};
}

function selectionEntries(
	selections: PreviewNativeCollectionArtworkInput['selections']
): Array<[NativeCollectionArtworkKind, string]> {
	const extra = Object.keys(selections).filter((key) => key !== 'poster' && key !== 'background');
	if (extra.length) serviceError('invalid_request');
	return (['poster', 'background'] as const).flatMap((kind) => {
		const value = selections[kind];
		return value === undefined ? [] : [[kind, identifier(value)] as const];
	});
}

function scopeMatches(context: NativeCollectionArtworkContext, binding: ApplyServerBinding) {
	return (
		binding.serverInstanceId === context.serverInstanceId &&
		binding.server.identity.instanceId === context.serverInstanceId &&
		binding.server.type === context.nativeProvider
	);
}

function currentMatches(
	expected: FrozenNativeCollectionCurrentArtwork,
	observed: FrozenNativeCollectionCurrentArtwork
): boolean {
	return (
		expected.state === observed.state &&
		expected.artworkVersion === observed.artworkVersion &&
		(expected.state !== 'present' || expected.fingerprint === observed.fingerprint)
	);
}

function safeFailureMessage(code: string): string {
	switch (code) {
		case 'native_collection_stale':
			return 'The native collection artwork changed after preview.';
		case 'native_collection_snapshot_failed':
			return 'The prior native collection artwork could not be captured safely.';
		case 'native_collection_write_unsupported':
			return 'The selected native collection slot is not writable.';
		case 'native_collection_write_failed':
			return 'The media server did not complete the native collection artwork write.';
		case 'native_collection_verify_unavailable':
			return 'The native collection artwork could not be read after the write.';
		case 'native_collection_verify_mismatch':
			return 'The media server does not expose the planned native collection artwork.';
		default:
			return 'The native collection artwork operation failed.';
	}
}

/** Native collection artwork flow kept independent from coordinated member writes. */
export function createNativeCollectionArtworkService(
	dependencies: NativeCollectionArtworkServiceDependencies
) {
	const clock = dependencies.clock ?? (() => new Date());
	const loadContext = dependencies.loadContext ?? loadNativeCollectionArtworkContext;

	async function context(serverInstanceId: string, mediaCollectionId: string) {
		try {
			return await loadContext(
				dependencies.database,
				identifier(serverInstanceId),
				identifier(mediaCollectionId)
			);
		} catch (error) {
			if (
				error !== null &&
				typeof error === 'object' &&
				'code' in error &&
				error.code === 'collection_not_found'
			) {
				serviceError('collection_not_found');
			}
			throw error;
		}
	}

	async function bindNative(
		serverInstanceId: string,
		mediaCollectionId: string
	): Promise<BoundNativeCollection> {
		const loaded = await context(serverInstanceId, mediaCollectionId);
		if (loaded.source !== 'native' || !loaded.nativeProvider) {
			serviceError('native_collection_unavailable');
		}
		let binding: ApplyServerBinding;
		try {
			binding = await dependencies.serverRegistry.resolve(loaded.serverInstanceId);
		} catch {
			serviceError('native_collection_server_unavailable');
		}
		if (!scopeMatches(loaded, binding)) serviceError('native_collection_scope_mismatch');
		return { context: loaded, binding };
	}

	async function observe(
		bound: BoundNativeCollection,
		kind: NativeCollectionArtworkKind
	): Promise<ObservedSlot> {
		let artwork: ServerArtwork | null | undefined;
		if (bound.binding.server.readCollectionArtwork) {
			try {
				artwork = await bound.binding.server.readCollectionArtwork(bound.context.sourceId, kind);
			} catch {
				artwork = undefined;
			}
		}
		return {
			artwork,
			frozen: {
				state: artwork === undefined ? 'unavailable' : artwork === null ? 'absent' : 'present',
				fingerprint: artwork ? sha256Bytes(artwork.data) : null,
				artworkVersion: bound.context.artworkVersions[kind]
			}
		};
	}

	async function getWorkspace(
		serverInstanceId: string,
		mediaCollectionId: string
	): Promise<NativeCollectionArtworkWorkspace> {
		const loaded = await context(serverInstanceId, mediaCollectionId);
		const base = {
			collection: {
				id: loaded.id,
				name: loaded.name,
				source: loaded.source,
				provider: loaded.nativeProvider,
				localMemberCount: loaded.localMemberCount
			}
		};
		if (loaded.source !== 'native' || !loaded.nativeProvider) {
			return {
				...base,
				entity: {
					available: false,
					reason: loaded.source !== 'native' ? 'not_native' : 'provider_unknown'
				},
				candidateSource: { available: false, reason: 'member_identity_incomplete' },
				slots: []
			};
		}

		let binding: ApplyServerBinding;
		try {
			binding = await dependencies.serverRegistry.resolve(loaded.serverInstanceId);
		} catch {
			return {
				...base,
				entity: { available: false, reason: 'server_unavailable' },
				candidateSource: { available: false, reason: 'provider_unavailable' },
				slots: []
			};
		}
		if (!scopeMatches(loaded, binding)) {
			return {
				...base,
				entity: { available: false, reason: 'server_scope_mismatch' },
				candidateSource: { available: false, reason: 'provider_unavailable' },
				slots: []
			};
		}

		let candidates: NativeCollectionArtworkCandidate[] = [];
		let candidateReason: NativeCollectionCandidateSourceReason = null;
		if (!loaded.linkedTmdbCollectionId) candidateReason = 'member_identity_incomplete';
		else {
			try {
				candidates = await dependencies.loadCandidates(loaded.linkedTmdbCollectionId, loaded.name);
				if (!candidates.length) candidateReason = 'no_candidates';
			} catch {
				candidateReason = 'provider_unavailable';
			}
		}
		const bound = { context: loaded, binding };
		const observations = await Promise.all(
			(['poster', 'background'] as const).map(
				async (kind) => [kind, await observe(bound, kind)] as const
			)
		);
		return {
			...base,
			entity: { available: true, reason: null },
			candidateSource: { available: candidateReason === null, reason: candidateReason },
			slots: observations.map(([kind, observation]) => ({
				kind,
				capability: effectiveCapability(loaded, binding.server, kind),
				current: {
					state: observation.frozen.state,
					artworkVersion: observation.frozen.artworkVersion,
					hasPreview: observation.artwork !== null && observation.artwork !== undefined
				},
				candidates: candidates.filter((candidate) => candidate.kind === kind).map(publicCandidate)
			}))
		};
	}

	async function loadExactCandidates(bound: BoundNativeCollection) {
		if (!bound.context.linkedTmdbCollectionId) {
			serviceError('native_collection_candidate_source_unavailable');
		}
		try {
			return await dependencies.loadCandidates(
				bound.context.linkedTmdbCollectionId,
				bound.context.name
			);
		} catch {
			serviceError('native_collection_candidate_source_unavailable');
		}
	}

	async function preparePlan(input: {
		serverInstanceId: string;
		mediaCollectionId: string;
		selections: PreviewNativeCollectionArtworkInput['selections'];
		plannedAt: string;
	}): Promise<PreparedPlan> {
		const selected = selectionEntries(input.selections);
		if (!selected.length) serviceError('invalid_request');
		const bound = await bindNative(input.serverInstanceId, input.mediaCollectionId);
		if (!bound.context.linkedTmdbCollectionId) {
			serviceError('native_collection_candidate_source_unavailable');
		}
		const candidates = await loadExactCandidates(bound);
		const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
		const bytesByCandidateId = new Map<string, NativeCollectionCandidateBytes>();
		const slots = [];
		for (const [kind, candidateId] of selected) {
			const candidate = byId.get(candidateId);
			if (!candidate || candidate.kind !== kind) {
				serviceError('native_collection_candidate_not_found');
			}
			const current = await observe(bound, kind);
			const capability = effectiveCapability(bound.context, bound.binding.server, kind);
			let loadedBytes: NativeCollectionCandidateBytes | null = null;
			if (capability === 'supported' && current.frozen.state !== 'unavailable') {
				try {
					loadedBytes = await dependencies.loadCandidateBytes(candidate);
				} catch {
					serviceError('native_collection_candidate_unavailable');
				}
				bytesByCandidateId.set(candidate.id, loadedBytes);
			}
			slots.push({
				kind,
				capability,
				current: current.frozen,
				candidate: {
					...candidate,
					// Skipped operations never persist this placeholder; executable ones use exact bytes.
					contentFingerprint: loadedBytes?.sha256 ?? candidate.fingerprint,
					contentType: loadedBytes?.contentType ?? 'image/jpeg'
				}
			});
		}
		return {
			payload: buildNativeCollectionArtworkPlan({
				plannedAt: input.plannedAt,
				target: {
					serverInstanceId: bound.context.serverInstanceId,
					mediaCollectionId: bound.context.id,
					nativeSourceId: bound.context.sourceId,
					nativeProvider: bound.context.nativeProvider!,
					linkedTmdbCollectionId: bound.context.linkedTmdbCollectionId,
					entityFingerprint: bound.context.entityFingerprint,
					serverFingerprint: bound.binding.fingerprint,
					candidateSetFingerprint: nativeCollectionCandidateSetFingerprint(candidates)
				},
				slots
			}),
			bytesByCandidateId
		};
	}

	async function preview(
		input: PreviewNativeCollectionArtworkInput
	): Promise<PublicNativeCollectionArtworkPreview> {
		const prepared = await preparePlan({
			...input,
			plannedAt: checkedNow(clock).toISOString()
		});
		if (!prepared.payload.operations.length) return previewDto(null, prepared.payload);
		const plan = await dependencies.planStore.create({
			kind: NATIVE_COLLECTION_ARTWORK_PLAN_KIND,
			payload: prepared.payload,
			serverInstanceId: identifier(input.serverInstanceId),
			ttlMs: input.ttlMs
		});
		return previewDto(plan, prepared.payload);
	}

	async function recordProjection(
		context: NativeCollectionArtworkContext,
		kind: NativeCollectionArtworkKind,
		url: string | null,
		now: Date
	): Promise<void> {
		const sanitized = sanitizeNativeCollectionArtworkUrl(url);
		if (dependencies.updateProjection) {
			await dependencies.updateProjection({
				context,
				kind,
				url: sanitized,
				observedAt: now
			});
			return;
		}
		await dependencies.database
			.update(mediaCollections)
			.set({
				...(kind === 'poster'
					? { currentPosterUrl: sanitized }
					: { currentBackgroundUrl: sanitized }),
				updatedAt: now
			})
			.where(
				and(
					eq(mediaCollections.id, context.id),
					eq(mediaCollections.serverInstanceId, context.serverInstanceId)
				)
			);
	}

	async function executeOperation(input: {
		groupId: string;
		planId: string;
		operation: NativeCollectionArtworkPlanOperation;
		bound: BoundNativeCollection;
		candidateBytes: NativeCollectionCandidateBytes;
	}): Promise<NativeCollectionArtworkApplyOperationResult> {
		const { operation, bound } = input;
		const now = checkedNow(clock);
		let before: ServerArtwork | null | undefined;
		let beforeSnapshotId: string | null = null;
		let afterSnapshotId: string | null = null;
		let after: ServerArtwork | null | undefined;
		let errorCode: string | null = null;
		let verification: ArtworkVerification = 'failed';

		const latestContext = await context(bound.context.serverInstanceId, bound.context.id);
		if (
			latestContext.source !== 'native' ||
			latestContext.sourceId !== bound.context.sourceId ||
			latestContext.nativeProvider !== bound.context.nativeProvider ||
			latestContext.linkedTmdbCollectionId !== bound.context.linkedTmdbCollectionId ||
			latestContext.artworkVersions[operation.kind] !== operation.current.artworkVersion
		) {
			errorCode = 'native_collection_stale';
		}

		if (!errorCode) {
			const live = await observe({ ...bound, context: latestContext }, operation.kind);
			before = live.artwork;
			if (!currentMatches(operation.current, live.frozen)) {
				errorCode = 'native_collection_stale';
			}
		}

		if (!errorCode) {
			try {
				const scope = {
					serverInstanceId: bound.context.serverInstanceId,
					mediaCollectionId: bound.context.id,
					destination: 'server' as const,
					slot: slot(operation.kind)
				};
				await dependencies.snapshots.captureServer({
					...scope,
					artwork: before,
					isOriginal: true
				});
				beforeSnapshotId = (
					await dependencies.snapshots.captureServer({ ...scope, artwork: before })
				).id;
			} catch {
				errorCode = 'native_collection_snapshot_failed';
			}
		}

		if (!errorCode) {
			const apply = writeMethod(bound.binding.server, operation.kind);
			if (!apply) errorCode = 'native_collection_write_unsupported';
			else {
				try {
					await apply.call(
						bound.binding.server,
						operation.targetId,
						input.candidateBytes.bytes,
						input.candidateBytes.contentType
					);
				} catch {
					errorCode = 'native_collection_write_failed';
				}
			}
		}

		if (!errorCode) {
			try {
				after = bound.binding.server.readCollectionArtwork
					? await bound.binding.server.readCollectionArtwork(operation.targetId, operation.kind)
					: undefined;
			} catch {
				after = undefined;
			}
			try {
				afterSnapshotId = (
					await dependencies.snapshots.captureServer({
						serverInstanceId: bound.context.serverInstanceId,
						mediaCollectionId: bound.context.id,
						destination: 'server',
						slot: slot(operation.kind),
						artwork: after
					})
				).id;
			} catch {
				afterSnapshotId = null;
			}
			const verified =
				after === undefined
					? unavailableArtworkVerification()
					: verifyServerArtworkRead({
							beforeState:
								before === undefined ? 'unavailable' : before === null ? 'absent' : 'present',
							beforeIdentity: before?.identity ?? null,
							beforeSha256: before ? sha256Bytes(before.data) : null,
							expectedSha256: input.candidateBytes.sha256,
							after
						});
			verification = verified.verification;
			if (!verified.ok) {
				errorCode =
					verified.verification === 'unavailable'
						? 'native_collection_verify_unavailable'
						: 'native_collection_verify_mismatch';
			}
		}

		const success = errorCode === null;
		const recorded = await dependencies.ledger.recordOutcome({
			groupId: input.groupId,
			serverInstanceId: bound.context.serverInstanceId,
			mediaCollectionId: bound.context.id,
			beforeSnapshotId,
			afterSnapshotId,
			action: 'apply',
			destination: 'server',
			kind: operation.kind,
			applyMethod: 'server_bytes',
			sourceProvider: operation.candidate.provider,
			provenance: {
				operationId: operation.id,
				providerAssetId: operation.candidate.providerAssetId,
				language: operation.candidate.language,
				resolvedTmdbId: operation.candidate.tmdbCollectionId,
				score: operation.candidate.score,
				width: operation.candidate.width,
				height: operation.candidate.height
			},
			priorFingerprint: operation.current.fingerprint,
			proposedFingerprint: operation.candidate.contentFingerprint,
			outcome: success ? 'success' : 'failed',
			verification,
			errorCode,
			error: errorCode ? safeFailureMessage(errorCode) : null,
			...(after !== undefined
				? {
						slotState: {
							currentUrl: sanitizeNativeCollectionArtworkUrl(after?.url ?? null),
							currentFingerprint: after ? sha256Bytes(after.data) : null,
							advanceArtworkVersion: success,
							lastObservedAt: now,
							...(success ? { lastVerifiedAt: now, externalChangedAt: null } : {})
						}
					}
				: {})
		});
		if (after !== undefined) {
			await recordProjection(bound.context, operation.kind, after?.url ?? null, now).catch(
				() => undefined
			);
		}
		return {
			operationId: operation.id,
			kind: operation.kind,
			status: success ? 'success' : 'failed',
			verification,
			errorCode,
			artworkVersion: recorded.currentSlotState?.artworkVersion ?? null
		};
	}

	async function confirm(
		input: ConfirmNativeCollectionArtworkInput
	): Promise<NativeCollectionArtworkApplyResult> {
		const serverInstanceId = identifier(input.serverInstanceId);
		const mediaCollectionId = identifier(input.mediaCollectionId);
		const planId = identifier(input.planId);
		if (!SHA256.test(input.digest)) serviceError('invalid_request');
		const inspected = await dependencies.planStore.validate<unknown>(planId, {
			kind: NATIVE_COLLECTION_ARTWORK_PLAN_KIND,
			digest: input.digest,
			serverInstanceId
		});
		try {
			assertNativeCollectionArtworkPlan(inspected.payload);
		} catch {
			serviceError('native_collection_plan_stale');
		}
		if (
			inspected.payload.target.serverInstanceId !== serverInstanceId ||
			inspected.payload.target.mediaCollectionId !== mediaCollectionId
		) {
			serviceError('native_collection_scope_mismatch');
		}
		const selections = Object.fromEntries([
			...inspected.payload.operations.map(
				(operation) => [operation.kind, operation.candidate.id] as const
			),
			...inspected.payload.skips.map((skipped) => [skipped.kind, skipped.candidateId] as const)
		]) as Partial<Record<NativeCollectionArtworkKind, string>>;
		const prepared = await preparePlan({
			serverInstanceId,
			mediaCollectionId,
			selections,
			plannedAt: inspected.payload.plannedAt
		});
		if (canonicalJson(prepared.payload) !== canonicalJson(inspected.payload)) {
			serviceError('native_collection_plan_stale');
		}
		await dependencies.planStore.consume(planId, {
			kind: NATIVE_COLLECTION_ARTWORK_PLAN_KIND,
			digest: input.digest,
			payload: inspected.payload,
			serverInstanceId
		});
		if (!prepared.payload.operations.length) serviceError('native_collection_no_operations');
		const bound = await bindNative(serverInstanceId, mediaCollectionId);
		if (
			bound.binding.fingerprint !== prepared.payload.target.serverFingerprint ||
			bound.context.entityFingerprint !== prepared.payload.target.entityFingerprint
		) {
			serviceError('native_collection_plan_stale');
		}
		const group = await dependencies.ledger.createGroup({
			serverInstanceId,
			operationPlanId: planId,
			kind: 'apply',
			initiator: input.initiator ?? 'user'
		});
		const results: NativeCollectionArtworkApplyOperationResult[] = [];
		for (const operation of prepared.payload.operations) {
			const candidateBytes = prepared.bytesByCandidateId.get(operation.candidate.id);
			if (!candidateBytes) serviceError('native_collection_candidate_unavailable');
			results.push(
				await executeOperation({
					groupId: group.id,
					planId,
					operation,
					bound,
					candidateBytes
				})
			);
		}
		await dependencies.ledger.finalizeGroup({
			groupId: group.id,
			serverInstanceId,
			summary: { nativeCollection: true }
		});
		const succeeded = results.filter((result) => result.status === 'success').length;
		const status =
			succeeded === results.length ? 'success' : succeeded === 0 ? 'failed' : 'partial';
		return {
			planId,
			digest: input.digest,
			groupId: group.id,
			status,
			summary: { total: results.length, succeeded, failed: results.length - succeeded },
			operations: results
		};
	}

	async function readCurrent(
		serverInstanceId: string,
		mediaCollectionId: string,
		kind: NativeCollectionArtworkKind
	): Promise<ServerArtwork | null> {
		if (kind !== 'poster' && kind !== 'background') serviceError('invalid_request');
		const bound = await bindNative(serverInstanceId, mediaCollectionId);
		if (!bound.binding.server.readCollectionArtwork) {
			serviceError('native_collection_unavailable');
		}
		const artwork = await bound.binding.server
			.readCollectionArtwork(bound.context.sourceId, kind as ServerArtworkKind)
			.catch(() => undefined);
		if (artwork === undefined) serviceError('native_collection_server_unavailable');
		return artwork;
	}

	async function readCandidate(
		serverInstanceId: string,
		mediaCollectionId: string,
		candidateId: string
	): Promise<NativeCollectionCandidateBytes> {
		const bound = await bindNative(serverInstanceId, mediaCollectionId);
		const candidates = await loadExactCandidates(bound);
		const candidate = candidates.find((entry) => entry.id === identifier(candidateId));
		if (!candidate) serviceError('native_collection_candidate_not_found');
		try {
			return await dependencies.loadCandidateBytes(candidate);
		} catch {
			serviceError('native_collection_candidate_unavailable');
		}
	}

	async function candidatePreviewSource(
		serverInstanceId: string,
		mediaCollectionId: string,
		candidateId: string
	): Promise<string> {
		const bound = await bindNative(serverInstanceId, mediaCollectionId);
		const candidates = await loadExactCandidates(bound);
		const candidate = candidates.find((entry) => entry.id === identifier(candidateId));
		if (!candidate) serviceError('native_collection_candidate_not_found');
		return candidate.previewUrl;
	}

	async function refreshProjection(
		serverInstanceId: string,
		mediaCollectionId: string
	): Promise<void> {
		const bound = await bindNative(serverInstanceId, mediaCollectionId);
		const observedAt = checkedNow(clock);
		for (const kind of ['poster', 'background'] as const) {
			const observation = await observe(bound, kind);
			if (observation.artwork !== undefined) {
				await recordProjection(bound.context, kind, observation.artwork?.url ?? null, observedAt);
			}
		}
	}

	return {
		getWorkspace,
		preview,
		confirm,
		readCurrent,
		readCandidate,
		candidatePreviewSource,
		refreshProjection
	};
}

export type NativeCollectionArtworkService = ReturnType<
	typeof createNativeCollectionArtworkService
>;
