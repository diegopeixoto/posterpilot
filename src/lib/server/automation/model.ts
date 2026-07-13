import { canonicalJsonDigest } from '$lib/server/plans/canonical-json';
import {
	assertIntervalMinutes,
	assertTimeZone,
	nextDailyRun,
	nextIntervalRun,
	parseLocalTime,
	type AutomationTriggerType
} from './schedule';

const AUTOMATION_EVENT_TYPES = ['sync_completed', 'new_items'] as const;
const AUTOMATION_ACTIONS = ['sync', 'sync_discover'] as const;
const AUTOMATION_PROVIDER_IDS = ['mediux', 'tmdb', 'fanarttv', 'theposterdb'] as const;

export type AutomationEventType = (typeof AUTOMATION_EVENT_TYPES)[number];
export type AutomationAction = (typeof AUTOMATION_ACTIONS)[number];
export type AutomationProviderId = (typeof AUTOMATION_PROVIDER_IDS)[number];

export interface AutomationDiscoveryInputs {
	forceRefresh: boolean;
	providers: AutomationProviderId[];
}

export interface AutomationRetryPolicy {
	maxAttempts: number;
	baseDelayMs: number;
	maxDelayMs: number;
}

export type AutomationTimingInput =
	| { triggerType: 'interval'; intervalMinutes: number }
	| { triggerType: 'daily'; localTime: string }
	| { triggerType: 'event'; eventType: AutomationEventType };

export interface AutomationDefinitionInput {
	name: string;
	enabled: boolean;
	serverInstanceId: string;
	timezone: string;
	timing: AutomationTimingInput;
	action?: AutomationAction;
	libraryScopes: string[];
	discoveryInputs?: Partial<AutomationDiscoveryInputs>;
	reviewViewId?: string | null;
	retryPolicy?: Partial<AutomationRetryPolicy>;
	failurePauseThreshold?: number;
	catchUpWindowMinutes?: number;
}

export interface NormalizedAutomationDefinition {
	name: string;
	normalizedName: string;
	enabled: boolean;
	serverInstanceId: string;
	triggerType: AutomationTriggerType;
	action: AutomationAction;
	timezone: string;
	intervalMinutes: number | null;
	localTime: string | null;
	eventType: AutomationEventType | null;
	libraryScopes: string[];
	discoveryInputs: AutomationDiscoveryInputs;
	reviewViewId: string | null;
	retryPolicy: AutomationRetryPolicy;
	failurePauseThreshold: number;
	catchUpWindowMinutes: number;
}

export interface FrozenAutomationOccurrencePayload {
	version: 1;
	type: 'review_automation';
	automationId: string;
	serverInstanceId: string;
	logicalKey: string;
	trigger: {
		type: AutomationTriggerType;
		eventType: AutomationEventType | null;
		eventIdentity: string | null;
		scheduledFor: string;
		timezone: string;
	};
	action: AutomationAction;
	reviewOnly: true;
	libraryScopes: string[];
	itemIds: number[];
	discoveryInputs: AutomationDiscoveryInputs;
	reviewViewId: string | null;
	retryPolicy: AutomationRetryPolicy;
	frozenAt: string;
	sourceFingerprint: string;
}

export class AutomationDefinitionValidationError extends TypeError {
	constructor(
		readonly code: string,
		readonly field: string
	) {
		super(code);
		this.name = 'AutomationDefinitionValidationError';
	}
}

const SAFE_SCOPE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;
const DEFAULT_RETRY_POLICY: AutomationRetryPolicy = {
	maxAttempts: 3,
	baseDelayMs: 30_000,
	maxDelayMs: 15 * 60_000
};

function invalid(code: string, field: string): never {
	throw new AutomationDefinitionValidationError(code, field);
}

function record(value: unknown, field: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		invalid('invalid_occurrence_payload', field);
	}
	return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: string[], field: string): void {
	const actual = Object.keys(value).sort();
	const normalized = [...expected].sort();
	if (
		actual.length !== normalized.length ||
		actual.some((key, index) => key !== normalized[index])
	) {
		invalid('invalid_occurrence_payload', field);
	}
}

function safeIdentifier(value: unknown, field: string): string | null {
	if (value == null || value === '') return null;
	if (typeof value !== 'string') invalid('invalid_identifier', field);
	if (!SAFE_SCOPE.test(value) || value.includes('..') || value.includes(':/')) {
		invalid('invalid_identifier', field);
	}
	return value;
}

function normalizeAutomationName(value: string): { name: string; normalizedName: string } {
	if (typeof value !== 'string') invalid('invalid_name', 'name');
	const name = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
	const hasControlCharacter = [...name].some((character) => {
		const code = character.charCodeAt(0);
		return code < 32 || code === 127;
	});
	if (name.length < 1 || name.length > 80 || hasControlCharacter) {
		invalid('invalid_name', 'name');
	}
	return { name, normalizedName: name.toLocaleLowerCase('en-US') };
}

function normalizeLibraries(values: string[]): string[] {
	if (!Array.isArray(values) || values.length === 0 || values.length > 100) {
		invalid('invalid_library_scopes', 'libraryScopes');
	}
	const result = [...new Set(values.map((value) => safeIdentifier(value, 'libraryScopes')))].filter(
		(value): value is string => value !== null
	);
	if (result.length === 0) invalid('invalid_library_scopes', 'libraryScopes');
	return result.sort((left, right) => left.localeCompare(right));
}

function normalizeDiscoveryInputs(
	input: Partial<AutomationDiscoveryInputs> | undefined
): AutomationDiscoveryInputs {
	const providerValues = input?.providers ?? [...AUTOMATION_PROVIDER_IDS];
	if (!Array.isArray(providerValues)) invalid('invalid_discovery_inputs', 'discoveryInputs');
	const providers = [...new Set(providerValues)];
	if (
		providers.length === 0 ||
		providers.some(
			(provider) => !AUTOMATION_PROVIDER_IDS.includes(provider as AutomationProviderId)
		)
	) {
		invalid('invalid_discovery_inputs', 'discoveryInputs.providers');
	}
	if (input?.forceRefresh !== undefined && typeof input.forceRefresh !== 'boolean') {
		invalid('invalid_discovery_inputs', 'discoveryInputs.forceRefresh');
	}
	return {
		forceRefresh: input?.forceRefresh ?? false,
		providers: providers.sort() as AutomationProviderId[]
	};
}

function boundedInteger(
	value: number | undefined,
	fallback: number,
	minimum: number,
	maximum: number,
	field: string
): number {
	const result = value ?? fallback;
	if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
		invalid(`invalid_${field}`, field);
	}
	return result;
}

function normalizeRetryPolicy(input?: Partial<AutomationRetryPolicy>): AutomationRetryPolicy {
	const policy = {
		maxAttempts: boundedInteger(
			input?.maxAttempts,
			DEFAULT_RETRY_POLICY.maxAttempts,
			1,
			10,
			'retry_policy'
		),
		baseDelayMs: boundedInteger(
			input?.baseDelayMs,
			DEFAULT_RETRY_POLICY.baseDelayMs,
			1_000,
			60 * 60_000,
			'retry_policy'
		),
		maxDelayMs: boundedInteger(
			input?.maxDelayMs,
			DEFAULT_RETRY_POLICY.maxDelayMs,
			1_000,
			24 * 60 * 60_000,
			'retry_policy'
		)
	};
	if (policy.maxDelayMs < policy.baseDelayMs) invalid('invalid_retry_policy', 'retryPolicy');
	return policy;
}

export function normalizeAutomationDefinition(
	input: AutomationDefinitionInput
): NormalizedAutomationDefinition {
	if (!input || typeof input !== 'object') invalid('invalid_automation', 'body');
	const { name, normalizedName } = normalizeAutomationName(input.name);
	const serverInstanceId = safeIdentifier(input.serverInstanceId, 'serverInstanceId');
	if (!serverInstanceId) invalid('invalid_server_scope', 'serverInstanceId');
	if (typeof input.enabled !== 'boolean') invalid('invalid_enabled', 'enabled');
	try {
		assertTimeZone(input.timezone);
	} catch {
		invalid('invalid_timezone', 'timezone');
	}
	const action = input.action ?? 'sync_discover';
	if (!AUTOMATION_ACTIONS.includes(action)) invalid('invalid_action', 'action');

	let intervalMinutes: number | null = null;
	let localTime: string | null = null;
	let eventType: AutomationEventType | null = null;
	if (!input.timing || typeof input.timing !== 'object') invalid('invalid_trigger', 'timing');
	if (input.timing.triggerType === 'interval') {
		try {
			assertIntervalMinutes(input.timing.intervalMinutes);
		} catch {
			invalid('invalid_interval', 'timing.intervalMinutes');
		}
		intervalMinutes = input.timing.intervalMinutes;
	} else if (input.timing.triggerType === 'daily') {
		try {
			parseLocalTime(input.timing.localTime);
		} catch {
			invalid('invalid_local_time', 'timing.localTime');
		}
		localTime = input.timing.localTime;
	} else if (input.timing.triggerType === 'event') {
		if (!AUTOMATION_EVENT_TYPES.includes(input.timing.eventType)) {
			invalid('invalid_event_type', 'timing.eventType');
		}
		eventType = input.timing.eventType;
	} else {
		invalid('invalid_trigger', 'timing.triggerType');
	}

	return {
		name,
		normalizedName,
		enabled: input.enabled,
		serverInstanceId,
		triggerType: input.timing.triggerType,
		action,
		timezone: input.timezone,
		intervalMinutes,
		localTime,
		eventType,
		libraryScopes: normalizeLibraries(input.libraryScopes),
		discoveryInputs: normalizeDiscoveryInputs(input.discoveryInputs),
		reviewViewId: safeIdentifier(input.reviewViewId, 'reviewViewId'),
		retryPolicy: normalizeRetryPolicy(input.retryPolicy),
		failurePauseThreshold: boundedInteger(
			input.failurePauseThreshold,
			3,
			1,
			20,
			'failure_pause_threshold'
		),
		catchUpWindowMinutes: boundedInteger(
			input.catchUpWindowMinutes,
			60,
			0,
			10_080,
			'catch_up_window'
		)
	};
}

export function initialAutomationNextRun(
	definition: NormalizedAutomationDefinition,
	now: Date
): Date | null {
	if (!definition.enabled || definition.triggerType === 'event') return null;
	if (definition.triggerType === 'interval') {
		return nextIntervalRun(new Date(now.getTime() - 1), now, definition.intervalMinutes!);
	}
	return nextDailyRun(now, definition.localTime!, definition.timezone);
}

export function freezeAutomationOccurrence(input: {
	automationId: string;
	definition: NormalizedAutomationDefinition;
	logicalKey: string;
	scheduledFor: Date;
	frozenAt: Date;
	eventIdentity?: string | null;
	itemIds?: number[];
}): FrozenAutomationOccurrencePayload {
	const scheduledFor = new Date(input.scheduledFor.getTime());
	const frozenAt = new Date(input.frozenAt.getTime());
	if (!Number.isFinite(scheduledFor.getTime()) || !Number.isFinite(frozenAt.getTime())) {
		invalid('invalid_occurrence_time', 'scheduledFor');
	}
	const itemIds = [...new Set(input.itemIds ?? [])]
		.filter((id) => Number.isSafeInteger(id) && id > 0)
		.sort((left, right) => left - right);
	if ((input.itemIds?.length ?? 0) !== itemIds.length) invalid('invalid_item_ids', 'itemIds');
	const base = {
		version: 1 as const,
		type: 'review_automation' as const,
		automationId: input.automationId,
		serverInstanceId: input.definition.serverInstanceId,
		logicalKey: input.logicalKey,
		trigger: {
			type: input.definition.triggerType,
			eventType: input.definition.eventType,
			eventIdentity: input.eventIdentity ?? null,
			scheduledFor: scheduledFor.toISOString(),
			timezone: input.definition.timezone
		},
		action: input.definition.action,
		reviewOnly: true as const,
		libraryScopes: [...input.definition.libraryScopes],
		itemIds,
		discoveryInputs: {
			forceRefresh: input.definition.discoveryInputs.forceRefresh,
			providers: [...input.definition.discoveryInputs.providers]
		},
		reviewViewId: input.definition.reviewViewId,
		retryPolicy: { ...input.definition.retryPolicy },
		frozenAt: frozenAt.toISOString()
	};
	const { digest } = canonicalJsonDigest(base);
	return { ...base, sourceFingerprint: digest };
}

/** Strictly validate the immutable review-only payload before enqueue or execution. */
export function normalizeFrozenAutomationOccurrencePayload(
	value: unknown
): FrozenAutomationOccurrencePayload {
	const payload = record(value, 'occurrence');
	exactKeys(
		payload,
		[
			'version',
			'type',
			'automationId',
			'serverInstanceId',
			'logicalKey',
			'trigger',
			'action',
			'reviewOnly',
			'libraryScopes',
			'itemIds',
			'discoveryInputs',
			'reviewViewId',
			'retryPolicy',
			'frozenAt',
			'sourceFingerprint'
		],
		'occurrence'
	);
	if (
		payload.version !== 1 ||
		payload.type !== 'review_automation' ||
		payload.reviewOnly !== true
	) {
		invalid('invalid_occurrence_payload', 'occurrence');
	}
	const automationId = safeIdentifier(payload.automationId as string, 'automationId');
	const serverInstanceId = safeIdentifier(payload.serverInstanceId as string, 'serverInstanceId');
	const logicalKey = safeIdentifier(payload.logicalKey as string, 'logicalKey');
	if (!automationId || !serverInstanceId || !logicalKey) {
		invalid('invalid_occurrence_payload', 'occurrence');
	}
	if (!AUTOMATION_ACTIONS.includes(payload.action as AutomationAction)) {
		invalid('invalid_occurrence_payload', 'action');
	}
	if (!Array.isArray(payload.libraryScopes) || !Array.isArray(payload.itemIds)) {
		invalid('invalid_occurrence_payload', 'scope');
	}
	const libraryScopes = normalizeLibraries(payload.libraryScopes as string[]);
	if (JSON.stringify(libraryScopes) !== JSON.stringify(payload.libraryScopes)) {
		invalid('invalid_occurrence_payload', 'libraryScopes');
	}
	const itemIds = (payload.itemIds as unknown[]).map(Number);
	if (
		itemIds.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
		JSON.stringify([...new Set(itemIds)].sort((left, right) => left - right)) !==
			JSON.stringify(payload.itemIds)
	) {
		invalid('invalid_occurrence_payload', 'itemIds');
	}
	const discovery = normalizeDiscoveryInputs(
		record(payload.discoveryInputs, 'discoveryInputs') as Partial<AutomationDiscoveryInputs>
	);
	if (JSON.stringify(discovery) !== JSON.stringify(payload.discoveryInputs)) {
		invalid('invalid_occurrence_payload', 'discoveryInputs');
	}
	const retryPolicy = normalizeRetryPolicy(
		record(payload.retryPolicy, 'retryPolicy') as Partial<AutomationRetryPolicy>
	);
	if (JSON.stringify(retryPolicy) !== JSON.stringify(payload.retryPolicy)) {
		invalid('invalid_occurrence_payload', 'retryPolicy');
	}
	const reviewViewId = safeIdentifier(payload.reviewViewId as string | null, 'reviewViewId');
	if (payload.reviewViewId !== reviewViewId) invalid('invalid_occurrence_payload', 'reviewViewId');
	const trigger = record(payload.trigger, 'trigger');
	exactKeys(trigger, ['type', 'eventType', 'eventIdentity', 'scheduledFor', 'timezone'], 'trigger');
	if (!['interval', 'daily', 'event'].includes(String(trigger.type))) {
		invalid('invalid_occurrence_payload', 'trigger.type');
	}
	try {
		assertTimeZone(String(trigger.timezone));
	} catch {
		invalid('invalid_occurrence_payload', 'trigger.timezone');
	}
	if (
		typeof trigger.scheduledFor !== 'string' ||
		!Number.isFinite(Date.parse(trigger.scheduledFor))
	) {
		invalid('invalid_occurrence_payload', 'trigger.scheduledFor');
	}
	if (trigger.type === 'event') {
		if (
			!AUTOMATION_EVENT_TYPES.includes(trigger.eventType as AutomationEventType) ||
			!safeIdentifier(trigger.eventIdentity as string, 'trigger.eventIdentity')
		) {
			invalid('invalid_occurrence_payload', 'trigger');
		}
	} else if (trigger.eventType !== null || trigger.eventIdentity !== null) {
		invalid('invalid_occurrence_payload', 'trigger');
	}
	if (typeof payload.frozenAt !== 'string' || !Number.isFinite(Date.parse(payload.frozenAt))) {
		invalid('invalid_occurrence_payload', 'frozenAt');
	}
	if (
		typeof payload.sourceFingerprint !== 'string' ||
		!/^[a-f0-9]{64}$/.test(payload.sourceFingerprint)
	) {
		invalid('invalid_occurrence_payload', 'sourceFingerprint');
	}
	const { sourceFingerprint, ...base } = payload;
	if (canonicalJsonDigest(base).digest !== sourceFingerprint) {
		invalid('invalid_occurrence_payload', 'sourceFingerprint');
	}
	return JSON.parse(
		canonicalJsonDigest(payload).canonicalJson
	) as FrozenAutomationOccurrencePayload;
}
