import { hashCanonicalJson } from '$lib/server/plans/canonical-json';
import type { CapabilitySupport } from '$lib/server/media-server';
import type {
	NativeCollectionArtworkCandidate,
	NativeCollectionArtworkProvider
} from './native-artwork-candidates';

/** Asset host allowlist per provider — the same rule the plan validator re-checks below. */
const TRUSTED_CANDIDATE_HOSTS: Record<NativeCollectionArtworkProvider, string> = {
	tmdb: 'image.tmdb.org',
	theposterdb: 'images.theposterdb.com'
};

export const NATIVE_COLLECTION_ARTWORK_PLAN_KIND = 'native_collection_artwork_apply' as const;
const NATIVE_COLLECTION_ARTWORK_PLAN_VERSION = 1 as const;

export type NativeCollectionArtworkPlanSkipCode =
	| 'collection_slot_unsupported'
	| 'collection_capability_unknown'
	| 'collection_current_unavailable';

export interface FrozenNativeCollectionCurrentArtwork {
	state: 'present' | 'absent' | 'unavailable';
	fingerprint: string | null;
	artworkVersion: number;
}

export interface FrozenNativeCollectionCandidate {
	id: string;
	provider: NativeCollectionArtworkProvider;
	providerAssetId: string;
	tmdbCollectionId: string;
	kind: 'poster' | 'background';
	language: string | null;
	width: number | null;
	height: number | null;
	score: number;
	url: string;
	fingerprint: string;
	contentFingerprint: string;
	contentType: string;
}

export interface NativeCollectionArtworkPlanOperation {
	id: string;
	kind: 'poster' | 'background';
	targetId: string;
	current: FrozenNativeCollectionCurrentArtwork;
	candidate: FrozenNativeCollectionCandidate;
	expectedOverwrite: boolean;
}

export interface NativeCollectionArtworkPlanSkip {
	kind: 'poster' | 'background';
	candidateId: string;
	code: NativeCollectionArtworkPlanSkipCode;
}

export interface NativeCollectionArtworkPlanPayloadV1 {
	version: typeof NATIVE_COLLECTION_ARTWORK_PLAN_VERSION;
	type: typeof NATIVE_COLLECTION_ARTWORK_PLAN_KIND;
	plannedAt: string;
	target: {
		serverInstanceId: string;
		mediaCollectionId: string;
		nativeSourceId: string;
		nativeProvider: 'plex' | 'jellyfin' | 'emby';
		linkedTmdbCollectionId: string;
		entityFingerprint: string;
		serverFingerprint: string;
		candidateSetFingerprint: string;
	};
	operations: NativeCollectionArtworkPlanOperation[];
	skips: NativeCollectionArtworkPlanSkip[];
	sourceFingerprint: string;
	summary: {
		operationCount: number;
		skipCount: number;
		poster: 'planned' | NativeCollectionArtworkPlanSkipCode | 'not_selected';
		background: 'planned' | NativeCollectionArtworkPlanSkipCode | 'not_selected';
	};
}

export interface BuildNativeCollectionArtworkPlanInput {
	plannedAt: string;
	target: NativeCollectionArtworkPlanPayloadV1['target'];
	slots: Array<{
		kind: 'poster' | 'background';
		capability: CapabilitySupport;
		current: FrozenNativeCollectionCurrentArtwork;
		candidate: NativeCollectionArtworkCandidate & {
			contentFingerprint: string;
			contentType: string;
		};
	}>;
}

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;

function skipCode(
	capability: CapabilitySupport,
	current: FrozenNativeCollectionCurrentArtwork
): NativeCollectionArtworkPlanSkipCode | null {
	if (capability === 'unsupported') return 'collection_slot_unsupported';
	if (capability === 'unknown') return 'collection_capability_unknown';
	if (current.state === 'unavailable') return 'collection_current_unavailable';
	return null;
}

function freezeCandidate(
	candidate: BuildNativeCollectionArtworkPlanInput['slots'][number]['candidate']
): FrozenNativeCollectionCandidate {
	return {
		id: candidate.id,
		provider: candidate.provider,
		providerAssetId: candidate.providerAssetId,
		tmdbCollectionId: candidate.tmdbCollectionId,
		kind: candidate.kind,
		language: candidate.language,
		width: candidate.width,
		height: candidate.height,
		score: candidate.score,
		url: candidate.url,
		fingerprint: candidate.fingerprint,
		contentFingerprint: candidate.contentFingerprint,
		contentType: candidate.contentType
	};
}

/** Build the exact immutable server-only native collection operation list. */
export function buildNativeCollectionArtworkPlan(
	input: BuildNativeCollectionArtworkPlanInput
): NativeCollectionArtworkPlanPayloadV1 {
	const operations: NativeCollectionArtworkPlanOperation[] = [];
	const skips: NativeCollectionArtworkPlanSkip[] = [];
	const selectedKinds = new Set<'poster' | 'background'>();
	for (const slot of [...input.slots].sort((left, right) => left.kind.localeCompare(right.kind))) {
		if (selectedKinds.has(slot.kind)) throw new TypeError('duplicate_native_collection_slot');
		selectedKinds.add(slot.kind);
		if (slot.candidate.kind !== slot.kind) throw new TypeError('native_collection_candidate_kind');
		const skipped = skipCode(slot.capability, slot.current);
		if (skipped) {
			skips.push({ kind: slot.kind, candidateId: slot.candidate.id, code: skipped });
			continue;
		}
		const candidate = freezeCandidate(slot.candidate);
		operations.push({
			id: hashCanonicalJson({
				target: input.target,
				kind: slot.kind,
				current: slot.current,
				candidate
			}),
			kind: slot.kind,
			targetId: input.target.nativeSourceId,
			current: slot.current,
			candidate,
			expectedOverwrite: slot.current.state === 'present'
		});
	}
	const state = (kind: 'poster' | 'background') => {
		if (operations.some((operation) => operation.kind === kind)) return 'planned' as const;
		return skips.find((skip) => skip.kind === kind)?.code ?? ('not_selected' as const);
	};
	const withoutSource = {
		version: NATIVE_COLLECTION_ARTWORK_PLAN_VERSION,
		type: NATIVE_COLLECTION_ARTWORK_PLAN_KIND,
		plannedAt: input.plannedAt,
		target: input.target,
		operations,
		skips,
		summary: {
			operationCount: operations.length,
			skipCount: skips.length,
			poster: state('poster'),
			background: state('background')
		}
	};
	return { ...withoutSource, sourceFingerprint: hashCanonicalJson(withoutSource) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		SAFE_IDENTIFIER.test(value) &&
		!value.includes('..') &&
		!value.includes(':/')
	);
}

function currentArtwork(value: unknown): value is FrozenNativeCollectionCurrentArtwork {
	if (!isRecord(value)) return false;
	return (
		(value.state === 'present' || value.state === 'absent' || value.state === 'unavailable') &&
		(value.state === 'present'
			? typeof value.fingerprint === 'string'
			: value.fingerprint === null) &&
		(value.fingerprint === null ||
			(typeof value.fingerprint === 'string' && SHA256.test(value.fingerprint))) &&
		Number.isSafeInteger(value.artworkVersion) &&
		Number(value.artworkVersion) >= 0
	);
}

function candidate(value: unknown): value is FrozenNativeCollectionCandidate {
	if (!isRecord(value)) return false;
	let url: URL;
	try {
		url = new URL(String(value.url));
	} catch {
		return false;
	}
	return (
		SHA256.test(String(value.id)) &&
		(value.provider === 'tmdb' || value.provider === 'theposterdb') &&
		typeof value.providerAssetId === 'string' &&
		/^[1-9]\d*$/.test(String(value.tmdbCollectionId)) &&
		(value.kind === 'poster' || value.kind === 'background') &&
		(value.language === null || typeof value.language === 'string') &&
		(value.width === null || (Number.isSafeInteger(value.width) && Number(value.width) > 0)) &&
		(value.height === null || (Number.isSafeInteger(value.height) && Number(value.height) > 0)) &&
		typeof value.score === 'number' &&
		Number.isFinite(value.score) &&
		url.protocol === 'https:' &&
		url.hostname === TRUSTED_CANDIDATE_HOSTS[value.provider] &&
		SHA256.test(String(value.fingerprint)) &&
		SHA256.test(String(value.contentFingerprint)) &&
		typeof value.contentType === 'string' &&
		value.contentType.startsWith('image/') &&
		!value.contentType.includes('svg')
	);
}

/** Reject malformed/cross-scope stored JSON before any native mutation is considered. */
export function assertNativeCollectionArtworkPlan(
	value: unknown
): asserts value is NativeCollectionArtworkPlanPayloadV1 {
	if (!isRecord(value)) throw new TypeError('invalid_native_collection_plan');
	const target = value.target;
	const operations = value.operations;
	const skips = value.skips;
	const summary = value.summary;
	if (
		value.version !== NATIVE_COLLECTION_ARTWORK_PLAN_VERSION ||
		value.type !== NATIVE_COLLECTION_ARTWORK_PLAN_KIND ||
		typeof value.plannedAt !== 'string' ||
		!Number.isFinite(Date.parse(value.plannedAt)) ||
		!isRecord(target) ||
		!identifier(target.serverInstanceId) ||
		!identifier(target.mediaCollectionId) ||
		!identifier(target.nativeSourceId) ||
		!['plex', 'jellyfin', 'emby'].includes(String(target.nativeProvider)) ||
		!/^[1-9]\d*$/.test(String(target.linkedTmdbCollectionId)) ||
		!SHA256.test(String(target.entityFingerprint)) ||
		!SHA256.test(String(target.serverFingerprint)) ||
		!SHA256.test(String(target.candidateSetFingerprint)) ||
		!Array.isArray(operations) ||
		operations.length > 2 ||
		!Array.isArray(skips) ||
		skips.length > 2 ||
		!isRecord(summary) ||
		!SHA256.test(String(value.sourceFingerprint))
	) {
		throw new TypeError('invalid_native_collection_plan');
	}
	const operationKinds = new Set<string>();
	for (const operation of operations) {
		if (
			!isRecord(operation) ||
			!SHA256.test(String(operation.id)) ||
			(operation.kind !== 'poster' && operation.kind !== 'background') ||
			operationKinds.has(operation.kind) ||
			operation.targetId !== target.nativeSourceId ||
			!currentArtwork(operation.current) ||
			!candidate(operation.candidate) ||
			operation.candidate.kind !== operation.kind ||
			typeof operation.expectedOverwrite !== 'boolean'
		) {
			throw new TypeError('invalid_native_collection_plan');
		}
		operationKinds.add(operation.kind);
	}
	const skipKinds = new Set<string>();
	for (const skip of skips) {
		if (
			!isRecord(skip) ||
			(skip.kind !== 'poster' && skip.kind !== 'background') ||
			!SHA256.test(String(skip.candidateId)) ||
			skipKinds.has(skip.kind) ||
			operationKinds.has(skip.kind) ||
			![
				'collection_slot_unsupported',
				'collection_capability_unknown',
				'collection_current_unavailable'
			].includes(String(skip.code))
		) {
			throw new TypeError('invalid_native_collection_plan');
		}
		skipKinds.add(skip.kind);
	}
	const summaryState = (kind: 'poster' | 'background') =>
		operations.some((operation) => operation.kind === kind)
			? 'planned'
			: (skips.find((skip) => skip.kind === kind)?.code ?? 'not_selected');
	if (
		summary.operationCount !== operations.length ||
		summary.skipCount !== skips.length ||
		summary.poster !== summaryState('poster') ||
		summary.background !== summaryState('background')
	) {
		throw new TypeError('invalid_native_collection_plan');
	}
	const { sourceFingerprint: _sourceFingerprint, ...withoutSource } = value;
	if (hashCanonicalJson(withoutSource) !== value.sourceFingerprint) {
		throw new TypeError('invalid_native_collection_plan');
	}
}

export interface PublicNativeCollectionArtworkPreview {
	planId: string | null;
	digest: string | null;
	expiresAt: string | null;
	operations: Array<{
		id: string;
		kind: 'poster' | 'background';
		candidateId: string;
		provider: NativeCollectionArtworkProvider;
		language: string | null;
		expectedOverwrite: boolean;
		currentState: FrozenNativeCollectionCurrentArtwork['state'];
	}>;
	skips: NativeCollectionArtworkPlanSkip[];
	summary: NativeCollectionArtworkPlanPayloadV1['summary'];
}
