import { canonicalJsonDigest, hashCanonicalJson } from '$lib/server/plans/canonical-json';
import type { UndoPlanOperation } from '$lib/server/artwork-revisions/undo-plan';
import type { JobPayload, PersistedJobType } from './types';
import { normalizeFrozenAutomationOccurrencePayload } from '$lib/server/automation/model';
import { isSecretLikeKey, redactSensitiveText } from '$lib/server/sensitive-redaction';

const ACTIVE_MUTATION_TYPES = new Set<PersistedJobType>([
	'sync',
	'full_rescan',
	'discover',
	'apply',
	'undo',
	'retry',
	'automation',
	'restore',
	'collection_apply',
	'cross_server_apply'
]);

/** Kinds that write artwork slots, so two of them may only overlap on distinct slots. */
const ARTWORK_MUTATION_KINDS = new Set<JobPayload['kind']>(['apply', 'undo']);

const SAFE_REPLAY_TYPES = new Set<PersistedJobType>([
	'sync',
	'full_rescan',
	'discover',
	'automation',
	'diagnostics',
	'backup'
]);

export interface JobResourceScope {
	global: boolean;
	serverInstanceIds: string[];
	librarySectionKeys: string[] | '*';
	itemIds: number[] | '*';
	mutationKeys: string[] | '*';
}

export interface JobDescriptor {
	executionKind: JobPayload['kind'];
	persistedType: PersistedJobType;
	normalizedPayload: JobPayload;
	scope: JobResourceScope;
	idempotencyKey: string;
	dedupeKey: string;
	mutating: boolean;
	safeToReplay: boolean;
}

export type JobRelationship = 'equivalent' | 'conflict' | 'independent';

export interface RetryPolicy {
	baseDelayMs: number;
	maxDelayMs: number;
	jitterRatio: number;
}

export interface ClassifiedJobFailure {
	code: string;
	message: string;
	retryable: boolean;
	recommendedAction: 'retry' | 'configure' | 'fix_input' | 'review';
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
	baseDelayMs: 1_000,
	maxDelayMs: 5 * 60_000,
	jitterRatio: 0.2
};

function positiveIds(value: unknown): number[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) throw new TypeError('job_item_ids_invalid');
	const ids = [...new Set(value.map(Number))].sort((a, b) => a - b);
	if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
		throw new TypeError('job_item_ids_invalid');
	}
	return ids;
}

function requiredString(value: unknown, code: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(code);
	return value.trim();
}

/**
 * Clone and normalize the small semantic sets in a payload before it is persisted.
 * This makes differently ordered item-id requests equivalent while never retaining
 * the caller's mutable object reference.
 */
export function normalizeJobPayload(payload: JobPayload): JobPayload {
	if (!payload || typeof payload !== 'object') throw new TypeError('job_payload_invalid');
	if (payload.kind === 'sync') {
		const serverInstanceId = requiredString(payload.serverInstanceId, 'job_server_scope_required');
		const itemIds = positiveIds(payload.itemIds);
		const librarySectionKey = payload.librarySectionKey?.trim();
		return {
			kind: 'sync',
			serverInstanceId,
			...(payload.full === true ? { full: true } : {}),
			...(librarySectionKey ? { librarySectionKey } : {}),
			...(itemIds ? { itemIds } : {})
		};
	}
	if (payload.kind === 'discover') {
		const serverInstanceId = requiredString(payload.serverInstanceId, 'job_server_scope_required');
		const itemIds = positiveIds(payload.itemIds);
		return {
			kind: 'discover',
			serverInstanceId,
			...(itemIds ? { itemIds } : {}),
			...(payload.forceRefresh === true ? { forceRefresh: true } : {})
		};
	}
	if (payload.kind === 'automation') {
		const occurrenceId = requiredString(payload.occurrenceId, 'job_occurrence_id_required');
		if (!/^occ_[a-f0-9]{40}$/.test(occurrenceId)) {
			throw new TypeError('job_occurrence_id_invalid');
		}
		const retryItemIds = positiveIds(payload.retryItemIds);
		return {
			kind: 'automation',
			occurrenceId,
			occurrence: normalizeFrozenAutomationOccurrencePayload(payload.occurrence),
			...(retryItemIds ? { retryItemIds } : {})
		};
	}
	if (payload.kind === 'apply' || payload.kind === 'undo') {
		// canonicalJsonDigest is also a strict JSON-domain validator and gives us a
		// detached clone whose bytes cannot change when the caller mutates its input.
		const canonical = canonicalJsonDigest(payload).canonicalJson;
		return JSON.parse(canonical) as JobPayload;
	}
	throw new TypeError('job_kind_unsupported');
}

function scopeFor(payload: JobPayload): JobResourceScope {
	if (payload.kind === 'sync') {
		return {
			global: false,
			serverInstanceIds: [payload.serverInstanceId],
			librarySectionKeys: payload.librarySectionKey ? [payload.librarySectionKey] : '*',
			itemIds: payload.itemIds ?? '*',
			mutationKeys: '*'
		};
	}
	if (payload.kind === 'discover') {
		return {
			global: false,
			serverInstanceIds: [payload.serverInstanceId],
			librarySectionKeys: '*',
			itemIds: payload.itemIds ?? '*',
			mutationKeys: '*'
		};
	}
	if (payload.kind === 'automation') {
		return {
			global: false,
			serverInstanceIds: [payload.occurrence.serverInstanceId],
			librarySectionKeys: [...payload.occurrence.libraryScopes],
			itemIds: payload.retryItemIds?.length
				? [...payload.retryItemIds]
				: payload.occurrence.itemIds.length
					? [...payload.occurrence.itemIds]
					: '*',
			mutationKeys: '*'
		};
	}
	if (payload.kind === 'undo') {
		// An undo restores exactly the slots its frozen operations name. Scoping it by
		// those slots (rather than the whole item) lets it be serialized against an
		// apply that touches the same slot, while staying independent of unrelated work.
		const itemIds = payload.plan.operations
			.map((operation) => (operation.target.kind === 'item' ? operation.target.mediaItemId : null))
			.filter((id): id is number => id !== null);
		const targetKey = (target: UndoPlanOperation['target']) =>
			target.kind === 'item' ? String(target.mediaItemId) : target.mediaCollectionId;
		return {
			global: false,
			serverInstanceIds: [
				...new Set(payload.plan.operations.map((operation) => operation.serverInstanceId))
			].sort(),
			librarySectionKeys: '*',
			itemIds: itemIds.length ? [...new Set(itemIds)].sort((a, b) => a - b) : '*',
			mutationKeys: payload.plan.operations
				.map(
					(operation) =>
						`${operation.serverInstanceId}:${targetKey(operation.target)}:${operation.destination}:${operation.slot.kind}:${operation.slot.season ?? 'root'}:${operation.slot.episode ?? 'root'}`
				)
				.sort()
		};
	}
	const crossServerSource =
		payload.plan.context.source === 'cross_server' ? payload.plan.context.sourceItem : null;
	const serverInstanceIds = [
		...payload.plan.scope.serverInstanceIds,
		...(crossServerSource ? [crossServerSource.serverInstanceId] : [])
	];
	const librarySectionKeys = [
		...payload.plan.scope.librarySectionKeys,
		...(crossServerSource ? [crossServerSource.librarySectionKey] : [])
	];
	const itemIds = [
		...payload.plan.scope.targetItemIds,
		...(crossServerSource ? [crossServerSource.mediaItemId] : [])
	];
	return {
		global: false,
		// Cross-server apply reads a frozen selection from the source as well as
		// mutating its destinations. Keep that source in the durable resource scope
		// so source-side sync/discovery cannot race confirmation or execution, and so
		// every involved server can authorize progress/history reads for the job.
		serverInstanceIds: [...new Set(serverInstanceIds)].sort(),
		librarySectionKeys: [...new Set(librarySectionKeys)].sort(),
		itemIds: [...new Set(itemIds)].sort((a, b) => a - b),
		mutationKeys: payload.plan.items
			.flatMap((item) =>
				item.operations.map(
					(operation) =>
						`${item.target.serverInstanceId}:${item.target.mediaItemId}:${operation.destination}:${operation.slot.kind}:${operation.slot.season ?? 'root'}:${operation.slot.episode ?? 'root'}`
				)
			)
			.sort()
	};
}

export function describeJob(
	payload: JobPayload,
	options: { persistedType?: PersistedJobType; idempotencySalt?: string } = {}
): JobDescriptor {
	const normalizedPayload = normalizeJobPayload(payload);
	const inferredType: PersistedJobType =
		normalizedPayload.kind === 'sync' && normalizedPayload.full === true
			? 'full_rescan'
			: normalizedPayload.kind;
	const persistedType = options.persistedType ?? inferredType;
	const inputDigest = hashCanonicalJson({
		version: 1,
		type: persistedType === 'retry' ? inferredType : persistedType,
		payload: normalizedPayload,
		salt: options.idempotencySalt ?? null
	});
	return {
		executionKind: normalizedPayload.kind,
		persistedType,
		normalizedPayload,
		scope: scopeFor(normalizedPayload),
		idempotencyKey: `job:v1:${inputDigest}`,
		dedupeKey: `active:v1:${inputDigest}`,
		mutating: ACTIVE_MUTATION_TYPES.has(persistedType),
		safeToReplay:
			persistedType === 'retry'
				? !ARTWORK_MUTATION_KINDS.has(normalizedPayload.kind)
				: SAFE_REPLAY_TYPES.has(persistedType)
	};
}

function overlaps<T extends string | number>(a: T[] | '*', b: T[] | '*'): boolean {
	if (a === '*' || b === '*') return true;
	const values = new Set(a);
	return b.some((value) => values.has(value));
}

function serverOverlap(a: JobResourceScope, b: JobResourceScope): boolean {
	if (a.global || b.global) return true;
	return overlaps(a.serverInstanceIds, b.serverInstanceIds);
}

/** Pure duplicate/conflict decision used before every insert. */
export function relateJobs(a: JobDescriptor, b: JobDescriptor): JobRelationship {
	if (a.idempotencyKey === b.idempotencyKey) return 'equivalent';
	if (!a.mutating || !b.mutating || !serverOverlap(a.scope, b.scope)) return 'independent';
	if (a.persistedType === 'restore' || b.persistedType === 'restore') return 'conflict';
	if (!overlaps(a.scope.librarySectionKeys, b.scope.librarySectionKeys)) return 'independent';

	const aKind = a.executionKind;
	const bKind = b.executionKind;
	const eitherSync =
		aKind === 'sync' || bKind === 'sync' || aKind === 'automation' || bKind === 'automation';
	if (eitherSync) return 'conflict';
	if (!overlaps(a.scope.itemIds, b.scope.itemIds)) return 'independent';
	if (ARTWORK_MUTATION_KINDS.has(aKind) && ARTWORK_MUTATION_KINDS.has(bKind)) {
		// Apply and undo both write artwork slots: they may run together only when no
		// slot is shared, so an undo can never race an apply over the same destination.
		return overlaps(a.scope.mutationKeys, b.scope.mutationKeys) ? 'conflict' : 'independent';
	}
	// Discovery mutates candidate state and apply mutates artwork/revisions; same-item
	// work is serialized so a frozen preview cannot race a discovery refresh.
	return 'conflict';
}

export function calculateRetryDelayMs(
	attemptNumber: number,
	policy: RetryPolicy = DEFAULT_RETRY_POLICY,
	random: () => number = Math.random
): number {
	if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1) {
		throw new RangeError('attempt_number_invalid');
	}
	if (
		!Number.isFinite(policy.baseDelayMs) ||
		policy.baseDelayMs < 0 ||
		!Number.isFinite(policy.maxDelayMs) ||
		policy.maxDelayMs < policy.baseDelayMs ||
		!Number.isFinite(policy.jitterRatio) ||
		policy.jitterRatio < 0 ||
		policy.jitterRatio > 1
	) {
		throw new RangeError('retry_policy_invalid');
	}
	const bounded = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attemptNumber - 1));
	const unit = Math.min(1, Math.max(0, random()));
	const factor = 1 - policy.jitterRatio + unit * policy.jitterRatio * 2;
	return Math.max(0, Math.round(Math.min(policy.maxDelayMs, bounded * factor)));
}

function readError(error: unknown): { code: string; message: string } {
	if (error && typeof error === 'object') {
		const record = error as Record<string, unknown>;
		const code =
			typeof record.code === 'string' && record.code.trim()
				? record.code.trim().toLowerCase()
				: typeof record.name === 'string' && record.name !== 'Error'
					? record.name.toLowerCase()
					: 'job_failed';
		const message =
			typeof record.message === 'string' && record.message.trim() ? record.message : code;
		return { code, message };
	}
	return { code: 'job_failed', message: typeof error === 'string' ? error : 'job_failed' };
}

/** Remove credentials, credential-bearing query strings, and excessive detail. */
export function sanitizeJobErrorText(value: unknown): string {
	const text = redactSensitiveText(String(value ?? 'job_failed'), '[redacted]');
	return (
		text
			.replace(/[\r\n\t]+/g, ' ')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 500) || 'job_failed'
	);
}

export function classifyJobFailure(error: unknown): ClassifiedJobFailure {
	const raw = readError(error);
	const combined = `${raw.code} ${raw.message}`.toLowerCase();
	const configuration =
		/(unauthori[sz]ed|forbidden|credential|missing[_ -]?(config|key)|server[_ -]?disabled)/.test(
			combined
		);
	const permanent =
		configuration ||
		/(invalid|scope[_ -]?mismatch|not[_ -]?found|plan[_ -]?(stale|expired|consumed)|maintenance|cancel)/.test(
			combined
		);
	const transient =
		/(timeout|timed[_ -]?out|network|unreachable|econn|enotfound|rate[_ -]?limit|429|503|database[_ -]?busy|locked|temporar|provider[_ -]?failed)/.test(
			combined
		);
	return {
		code: sanitizeJobErrorText(raw.code)
			.replace(/[^a-z0-9_.-]/gi, '_')
			.slice(0, 80),
		message: sanitizeJobErrorText(raw.message),
		retryable: transient || !permanent,
		recommendedAction: configuration
			? 'configure'
			: permanent
				? 'fix_input'
				: transient
					? 'retry'
					: 'review'
	};
}

export function sanitizedResult(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object') return {};
	const clone = structuredClone(value) as Record<string, unknown>;
	const visit = (entry: unknown): unknown => {
		if (typeof entry === 'string') return sanitizeJobErrorText(entry);
		if (Array.isArray(entry)) return entry.map(visit);
		if (!entry || typeof entry !== 'object') return entry;
		return Object.fromEntries(
			Object.entries(entry as Record<string, unknown>)
				.filter(([key]) => !/(url|payload)/i.test(key) && !isSecretLikeKey(key))
				.map(([key, child]) => [key, visit(child)])
		);
	};
	return visit(clone) as Record<string, unknown>;
}
