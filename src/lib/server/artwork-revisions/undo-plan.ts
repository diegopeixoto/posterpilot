import {
	canonicalJson,
	canonicalJsonDigest,
	hashCanonicalJson
} from '$lib/server/plans/canonical-json';

export const UNDO_PLAN_KIND = 'artwork_undo' as const;
const UNDO_PLAN_VERSION = 1 as const;

export type UndoPlanDestination = 'server' | 'kometa';
export type UndoSlotKind = 'poster' | 'background' | 'title_card';
export type UndoArtworkState = 'present' | 'absent' | 'unavailable';

export interface UndoPlanSlot {
	kind: UndoSlotKind;
	season: number | null;
	episode: number | null;
}

export type UndoPlanTarget =
	| { kind: 'item'; mediaItemId: number }
	| { kind: 'collection'; mediaCollectionId: string };

interface UndoPlanScopeBase {
	serverInstanceId: string;
}

export type UndoPlanScope =
	| (UndoPlanScopeBase & { kind: 'revision'; revisionId: string })
	| (UndoPlanScopeBase & { kind: 'slot'; target: UndoPlanTarget; slot: UndoPlanSlot })
	| (UndoPlanScopeBase & { kind: 'season'; mediaItemId: number; season: number })
	| (UndoPlanScopeBase & { kind: 'item'; mediaItemId: number })
	| (UndoPlanScopeBase & {
			kind: 'destination';
			target: UndoPlanTarget;
			destination: UndoPlanDestination;
	  })
	| (UndoPlanScopeBase & { kind: 'group'; revisionGroupId: string });

/**
 * A credentials-safe identity of what the destination served when the preview
 * was created. Present identities are hashes, never URLs or raw Kometa values.
 */
export interface FrozenUndoCurrentState {
	state: UndoArtworkState;
	fingerprint: string | null;
	artworkVersion: number | null;
}

export type FrozenUndoSnapshot =
	| { state: 'present'; fingerprint: string; restorable: true }
	| { state: 'absent'; fingerprint: null; restorable: true }
	| { state: 'unavailable'; fingerprint: null; restorable: false };

export interface UndoPlanCandidate {
	revisionId: string;
	revisionGroupId: string;
	revisionCreatedAt: string;
	serverInstanceId: string;
	target: UndoPlanTarget;
	destination: UndoPlanDestination;
	targetId: string;
	slot: UndoPlanSlot;
	beforeSnapshotId: string;
	current: FrozenUndoCurrentState;
	snapshot: FrozenUndoSnapshot;
}

export interface UndoPlanOperation extends UndoPlanCandidate {
	id: string;
}

export interface UndoPlanSummary {
	operationCount: number;
	actionableCount: number;
	unavailableCount: number;
	targetCount: number;
	slotCount: number;
	destinations: {
		server: number;
		kometa: number;
	};
	restoreStates: {
		present: number;
		absent: number;
		unavailable: number;
	};
}

export interface UndoPlanPayloadV1 {
	version: typeof UNDO_PLAN_VERSION;
	type: typeof UNDO_PLAN_KIND;
	plannedAt: string;
	scope: UndoPlanScope;
	operations: UndoPlanOperation[];
	sourceFingerprint: string;
	summary: UndoPlanSummary;
}

/**
 * The immutable input the durable worker executes. Confirmation consumes the plan
 * and hands this frozen payload to the queue, so a restart resumes the same
 * operations instead of losing them with the request that started them.
 */
export interface FrozenUndoJobPayload {
	kind: 'undo';
	planId: string;
	digest: string;
	plan: UndoPlanPayloadV1;
}

export interface BuildUndoPlanInput {
	plannedAt: string;
	scope: UndoPlanScope;
	/** Candidate revisions may be broader than `scope`; the builder selects only matching rows. */
	operations: UndoPlanCandidate[];
}

export interface BuiltUndoPlan {
	payload: UndoPlanPayloadV1;
	canonicalJson: string;
	digest: string;
}

export type UndoPlanValidationErrorCode = 'invalid_undo_plan';

class UndoPlanValidationError extends TypeError {
	constructor(
		readonly code: UndoPlanValidationErrorCode,
		message: string
	) {
		super(message);
		this.name = 'UndoPlanValidationError';
	}
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_OPERATIONS = 10_000;

function invalid(message: string): never {
	throw new UndoPlanValidationError('invalid_undo_plan', message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!isRecord(value)) invalid(`${label} must be a plain object`);
	return value;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
		invalid(`${label} has unexpected or missing fields`);
	}
}

function safeIdentifier(value: unknown, label: string): asserts value is string {
	if (typeof value !== 'string' || !SAFE_IDENTIFIER_PATTERN.test(value)) {
		invalid(`${label} must be a safe identifier`);
	}
	if (value.includes('..') || value.includes(':/'))
		invalid(`${label} is not safe for a public plan`);
}

function positiveInteger(value: unknown, label: string): asserts value is number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) {
		invalid(`${label} must be a positive integer`);
	}
}

function nonNegativeInteger(value: unknown, label: string): asserts value is number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		invalid(`${label} must be a non-negative integer`);
	}
}

function nullableNonNegativeInteger(value: unknown, label: string): void {
	if (value !== null) nonNegativeInteger(value, label);
}

function timestamp(value: unknown, label: string): asserts value is string {
	if (
		typeof value !== 'string' ||
		!ISO_UTC_PATTERN.test(value) ||
		!Number.isFinite(Date.parse(value))
	) {
		invalid(`${label} must be a UTC ISO timestamp`);
	}
}

function fingerprint(value: unknown, label: string): asserts value is string {
	if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
		invalid(`${label} must be a lowercase SHA-256 digest`);
	}
}

function assertTarget(value: unknown, label: string): asserts value is UndoPlanTarget {
	const target = record(value, label);
	if (target.kind === 'item') {
		exactKeys(target, ['kind', 'mediaItemId'], label);
		positiveInteger(target.mediaItemId, `${label}.mediaItemId`);
		return;
	}
	if (target.kind === 'collection') {
		exactKeys(target, ['kind', 'mediaCollectionId'], label);
		safeIdentifier(target.mediaCollectionId, `${label}.mediaCollectionId`);
		return;
	}
	invalid(`${label}.kind is invalid`);
}

function assertSlot(value: unknown, label: string): asserts value is UndoPlanSlot {
	const slot = record(value, label);
	exactKeys(slot, ['kind', 'season', 'episode'], label);
	if (!['poster', 'background', 'title_card'].includes(String(slot.kind))) {
		invalid(`${label}.kind is invalid`);
	}
	nullableNonNegativeInteger(slot.season, `${label}.season`);
	nullableNonNegativeInteger(slot.episode, `${label}.episode`);
	if (slot.kind === 'title_card') {
		if (slot.season === null || slot.episode === null) {
			invalid(`${label} title cards require season and episode numbers`);
		}
	} else if (slot.episode !== null) {
		invalid(`${label} poster/background slots cannot have an episode number`);
	}
}

function assertDestination(value: unknown, label: string): asserts value is UndoPlanDestination {
	if (value !== 'server' && value !== 'kometa') invalid(`${label} is invalid`);
}

function assertScope(value: unknown): asserts value is UndoPlanScope {
	const scope = record(value, 'Undo scope');
	safeIdentifier(scope.serverInstanceId, 'Undo scope server instance id');
	switch (scope.kind) {
		case 'revision':
			exactKeys(scope, ['kind', 'serverInstanceId', 'revisionId'], 'Revision undo scope');
			safeIdentifier(scope.revisionId, 'Undo scope revision id');
			return;
		case 'slot':
			exactKeys(scope, ['kind', 'serverInstanceId', 'target', 'slot'], 'Slot undo scope');
			assertTarget(scope.target, 'Undo scope target');
			assertSlot(scope.slot, 'Undo scope slot');
			return;
		case 'season':
			exactKeys(scope, ['kind', 'serverInstanceId', 'mediaItemId', 'season'], 'Season undo scope');
			positiveInteger(scope.mediaItemId, 'Undo scope media item id');
			nonNegativeInteger(scope.season, 'Undo scope season');
			return;
		case 'item':
			exactKeys(scope, ['kind', 'serverInstanceId', 'mediaItemId'], 'Item undo scope');
			positiveInteger(scope.mediaItemId, 'Undo scope media item id');
			return;
		case 'destination':
			exactKeys(
				scope,
				['kind', 'serverInstanceId', 'target', 'destination'],
				'Destination undo scope'
			);
			assertTarget(scope.target, 'Undo scope target');
			assertDestination(scope.destination, 'Undo scope destination');
			return;
		case 'group':
			exactKeys(scope, ['kind', 'serverInstanceId', 'revisionGroupId'], 'Group undo scope');
			safeIdentifier(scope.revisionGroupId, 'Undo scope revision group id');
			return;
		default:
			invalid('Undo scope kind is invalid');
	}
}

function assertCurrentState(value: unknown): asserts value is FrozenUndoCurrentState {
	const current = record(value, 'Frozen current state');
	exactKeys(current, ['state', 'fingerprint', 'artworkVersion'], 'Frozen current state');
	if (!['present', 'absent', 'unavailable'].includes(String(current.state))) {
		invalid('Frozen current state is invalid');
	}
	if (current.state === 'present') fingerprint(current.fingerprint, 'Frozen current fingerprint');
	else if (current.fingerprint !== null)
		invalid('Non-present current state cannot have a fingerprint');
	if (current.artworkVersion !== null) {
		nonNegativeInteger(current.artworkVersion, 'Frozen artwork version');
	}
}

function assertSnapshot(value: unknown): asserts value is FrozenUndoSnapshot {
	const snapshot = record(value, 'Frozen restore snapshot');
	exactKeys(snapshot, ['state', 'fingerprint', 'restorable'], 'Frozen restore snapshot');
	switch (snapshot.state) {
		case 'present':
			fingerprint(snapshot.fingerprint, 'Restore snapshot fingerprint');
			if (snapshot.restorable !== true) invalid('Present snapshots must be restorable');
			return;
		case 'absent':
			if (snapshot.fingerprint !== null || snapshot.restorable !== true) {
				invalid('Absent snapshots must be restorable and have no fingerprint');
			}
			return;
		case 'unavailable':
			if (snapshot.fingerprint !== null || snapshot.restorable !== false) {
				invalid('Unavailable snapshots cannot be restorable or have a fingerprint');
			}
			return;
		default:
			invalid('Restore snapshot state is invalid');
	}
}

const CANDIDATE_KEYS = [
	'revisionId',
	'revisionGroupId',
	'revisionCreatedAt',
	'serverInstanceId',
	'target',
	'destination',
	'targetId',
	'slot',
	'beforeSnapshotId',
	'current',
	'snapshot'
] as const;

function assertCandidate(value: unknown, withId: false): asserts value is UndoPlanCandidate;
function assertCandidate(value: unknown, withId: true): asserts value is UndoPlanOperation;
function assertCandidate(value: unknown, withId: boolean): void {
	const candidate = record(value, 'Undo operation');
	exactKeys(candidate, withId ? ['id', ...CANDIDATE_KEYS] : CANDIDATE_KEYS, 'Undo operation');
	if (withId) fingerprint(candidate.id, 'Undo operation id');
	safeIdentifier(candidate.revisionId, 'Undo revision id');
	safeIdentifier(candidate.revisionGroupId, 'Undo revision group id');
	timestamp(candidate.revisionCreatedAt, 'Undo revision time');
	safeIdentifier(candidate.serverInstanceId, 'Undo operation server instance id');
	assertTarget(candidate.target, 'Undo operation target');
	assertDestination(candidate.destination, 'Undo operation destination');
	safeIdentifier(candidate.targetId, 'Undo destination target id');
	assertSlot(candidate.slot, 'Undo operation slot');
	safeIdentifier(candidate.beforeSnapshotId, 'Undo before-snapshot id');
	assertCurrentState(candidate.current);
	assertSnapshot(candidate.snapshot);
}

function targetKey(target: UndoPlanTarget): string {
	return target.kind === 'item'
		? `0:item:${String(target.mediaItemId).padStart(16, '0')}`
		: `1:collection:${target.mediaCollectionId}`;
}

function sameTarget(left: UndoPlanTarget, right: UndoPlanTarget): boolean {
	return canonicalJson(left) === canonicalJson(right);
}

function undoSlotKey(slot: UndoPlanSlot): string {
	return `${slot.kind}:${slot.season ?? 'root'}:${slot.episode ?? 'root'}`;
}

function operationSlotKey(operation: UndoPlanCandidate): string {
	return [
		operation.serverInstanceId,
		targetKey(operation.target),
		operation.destination,
		undoSlotKey(operation.slot)
	].join('|');
}

function scopeMatches(scope: UndoPlanScope, candidate: UndoPlanCandidate): boolean {
	if (candidate.serverInstanceId !== scope.serverInstanceId) return false;
	switch (scope.kind) {
		case 'revision':
			return candidate.revisionId === scope.revisionId;
		case 'slot':
			return (
				sameTarget(candidate.target, scope.target) &&
				canonicalJson(candidate.slot) === canonicalJson(scope.slot)
			);
		case 'season':
			return (
				candidate.target.kind === 'item' &&
				candidate.target.mediaItemId === scope.mediaItemId &&
				candidate.slot.season === scope.season
			);
		case 'item':
			return candidate.target.kind === 'item' && candidate.target.mediaItemId === scope.mediaItemId;
		case 'destination':
			return (
				candidate.destination === scope.destination && sameTarget(candidate.target, scope.target)
			);
		case 'group':
			return candidate.revisionGroupId === scope.revisionGroupId;
	}
}

const DESTINATION_ORDER: Record<UndoPlanDestination, number> = { server: 0, kometa: 1 };
const SLOT_KIND_ORDER: Record<UndoSlotKind, number> = { poster: 0, background: 1, title_card: 2 };

function compareSlots(left: UndoPlanSlot, right: UndoPlanSlot): number {
	return (
		(left.season ?? -1) - (right.season ?? -1) ||
		(left.episode ?? -1) - (right.episode ?? -1) ||
		SLOT_KIND_ORDER[left.kind] - SLOT_KIND_ORDER[right.kind]
	);
}

function compareOperations(left: UndoPlanCandidate, right: UndoPlanCandidate): number {
	return (
		left.serverInstanceId.localeCompare(right.serverInstanceId) ||
		targetKey(left.target).localeCompare(targetKey(right.target)) ||
		DESTINATION_ORDER[left.destination] - DESTINATION_ORDER[right.destination] ||
		compareSlots(left.slot, right.slot) ||
		left.targetId.localeCompare(right.targetId) ||
		left.revisionId.localeCompare(right.revisionId)
	);
}

/** Newest revision wins when a broad scope contains several revisions for one destination/slot. */
function compareRevisionRecency(left: UndoPlanCandidate, right: UndoPlanCandidate): number {
	return (
		right.revisionCreatedAt.localeCompare(left.revisionCreatedAt) ||
		right.revisionId.localeCompare(left.revisionId)
	);
}

function withoutOperationId(operation: UndoPlanOperation): UndoPlanCandidate {
	const { id: _id, ...candidate } = operation;
	return candidate;
}

function operationId(candidate: UndoPlanCandidate): string {
	return hashCanonicalJson({ type: 'artwork_undo_operation', version: 1, ...candidate });
}

function computeSummary(operations: UndoPlanOperation[]): UndoPlanSummary {
	const targetKeys = new Set(operations.map((operation) => targetKey(operation.target)));
	const logicalSlots = new Set(
		operations.map(
			(operation) =>
				`${operation.serverInstanceId}|${targetKey(operation.target)}|${undoSlotKey(operation.slot)}`
		)
	);
	return {
		operationCount: operations.length,
		actionableCount: operations.filter((operation) => operation.snapshot.restorable).length,
		unavailableCount: operations.filter((operation) => !operation.snapshot.restorable).length,
		targetCount: targetKeys.size,
		slotCount: logicalSlots.size,
		destinations: {
			server: operations.filter((operation) => operation.destination === 'server').length,
			kometa: operations.filter((operation) => operation.destination === 'kometa').length
		},
		restoreStates: {
			present: operations.filter((operation) => operation.snapshot.state === 'present').length,
			absent: operations.filter((operation) => operation.snapshot.state === 'absent').length,
			unavailable: operations.filter((operation) => operation.snapshot.state === 'unavailable')
				.length
		}
	};
}

function sourceFingerprint(scope: UndoPlanScope, operations: UndoPlanOperation[]): string {
	return hashCanonicalJson({ scope, operationIds: operations.map((operation) => operation.id) });
}

function assertSummary(value: unknown): asserts value is UndoPlanSummary {
	const summary = record(value, 'Undo summary');
	exactKeys(
		summary,
		[
			'operationCount',
			'actionableCount',
			'unavailableCount',
			'targetCount',
			'slotCount',
			'destinations',
			'restoreStates'
		],
		'Undo summary'
	);
	for (const key of [
		'operationCount',
		'actionableCount',
		'unavailableCount',
		'targetCount',
		'slotCount'
	] as const) {
		nonNegativeInteger(summary[key], `Undo summary ${key}`);
	}
	const destinations = record(summary.destinations, 'Undo destination summary');
	exactKeys(destinations, ['server', 'kometa'], 'Undo destination summary');
	nonNegativeInteger(destinations.server, 'Undo server count');
	nonNegativeInteger(destinations.kometa, 'Undo Kometa count');
	const states = record(summary.restoreStates, 'Undo restore-state summary');
	exactKeys(states, ['present', 'absent', 'unavailable'], 'Undo restore-state summary');
	nonNegativeInteger(states.present, 'Undo present count');
	nonNegativeInteger(states.absent, 'Undo absent count');
	nonNegativeInteger(states.unavailable, 'Undo unavailable count');
}

/** Strict structural and internal-integrity validation for persisted/public undo plans. */
export function assertUndoPlanPayload(value: unknown): asserts value is UndoPlanPayloadV1 {
	const payload = record(value, 'Undo plan');
	exactKeys(
		payload,
		['version', 'type', 'plannedAt', 'scope', 'operations', 'sourceFingerprint', 'summary'],
		'Undo plan'
	);
	if (payload.version !== UNDO_PLAN_VERSION || payload.type !== UNDO_PLAN_KIND) {
		invalid('Undo plan type or version is invalid');
	}
	timestamp(payload.plannedAt, 'Undo plan time');
	assertScope(payload.scope);
	if (!Array.isArray(payload.operations) || payload.operations.length === 0) {
		invalid('Undo plan must contain at least one operation');
	}
	if (payload.operations.length > MAX_OPERATIONS) invalid('Undo plan contains too many operations');
	for (const operation of payload.operations) assertCandidate(operation, true);
	fingerprint(payload.sourceFingerprint, 'Undo source fingerprint');
	assertSummary(payload.summary);

	const operations = payload.operations as UndoPlanOperation[];
	const keys = new Set<string>();
	const revisions = new Set<string>();
	for (const operation of operations) {
		if (!scopeMatches(payload.scope as UndoPlanScope, operation)) {
			invalid('Undo operation is outside the selected scope');
		}
		const key = operationSlotKey(operation);
		if (keys.has(key)) invalid('Undo plan contains a duplicate destination slot');
		keys.add(key);
		if (revisions.has(operation.revisionId)) invalid('Undo revision appears more than once');
		revisions.add(operation.revisionId);
		if (operation.id !== operationId(withoutOperationId(operation))) {
			invalid('Undo operation id does not match its frozen content');
		}
	}
	if (payload.scope.kind === 'revision' && operations.length !== 1) {
		invalid('Revision undo scope must resolve exactly one operation');
	}
	const ordered = [...operations].sort(compareOperations);
	if (canonicalJson(ordered) !== canonicalJson(operations)) {
		invalid('Undo operations are not in deterministic order');
	}
	const expectedSummary = computeSummary(operations);
	if (canonicalJson(payload.summary) !== canonicalJson(expectedSummary)) {
		invalid('Undo plan summary is inconsistent');
	}
	const expectedSourceFingerprint = sourceFingerprint(payload.scope as UndoPlanScope, operations);
	if (payload.sourceFingerprint !== expectedSourceFingerprint) {
		invalid('Undo source fingerprint is inconsistent');
	}
}

/** Build a deterministic, credentials-safe payload from revision candidates. */
export function buildUndoPlanPayload(input: BuildUndoPlanInput): UndoPlanPayloadV1 {
	const raw = record(input, 'Undo plan input');
	exactKeys(raw, ['plannedAt', 'scope', 'operations'], 'Undo plan input');
	timestamp(input.plannedAt, 'Undo plan time');
	assertScope(input.scope);
	if (!Array.isArray(input.operations) || input.operations.length === 0) {
		invalid('Undo plan candidates are required');
	}
	if (input.operations.length > MAX_OPERATIONS) invalid('Undo plan contains too many candidates');
	for (const candidate of input.operations) assertCandidate(candidate, false);

	const matching = input.operations.filter((candidate) => scopeMatches(input.scope, candidate));
	if (matching.length === 0) invalid('Undo scope has no matching revision');

	const candidateIdentity = new Map<string, string>();
	for (const candidate of matching) {
		const key = `${operationSlotKey(candidate)}|${candidate.revisionId}`;
		const canonical = canonicalJson(candidate);
		const prior = candidateIdentity.get(key);
		if (prior !== undefined && prior !== canonical) {
			invalid('One undo revision has conflicting frozen data');
		}
		candidateIdentity.set(key, canonical);
	}

	const deduplicated = new Map<string, UndoPlanCandidate>();
	for (const candidate of [...matching].sort(compareRevisionRecency)) {
		const key = operationSlotKey(candidate);
		if (!deduplicated.has(key)) deduplicated.set(key, candidate);
	}
	const operations = [...deduplicated.values()]
		.map((candidate): UndoPlanOperation => ({ id: operationId(candidate), ...candidate }))
		.sort(compareOperations);
	if (input.scope.kind === 'revision' && operations.length !== 1) {
		invalid('Revision undo scope must resolve exactly one destination slot');
	}

	const payload: UndoPlanPayloadV1 = {
		version: UNDO_PLAN_VERSION,
		type: UNDO_PLAN_KIND,
		plannedAt: input.plannedAt,
		scope: input.scope,
		operations,
		sourceFingerprint: sourceFingerprint(input.scope, operations),
		summary: computeSummary(operations)
	};
	assertUndoPlanPayload(payload);
	return payload;
}

/** Build the payload and its canonical persisted representation/digest in one pass. */
export function buildUndoPlan(input: BuildUndoPlanInput): BuiltUndoPlan {
	const payload = buildUndoPlanPayload(input);
	const digested = canonicalJsonDigest(payload);
	return { payload, canonicalJson: digested.canonicalJson, digest: digested.digest };
}
