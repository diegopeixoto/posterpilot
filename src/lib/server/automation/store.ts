import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import {
	automationOccurrences,
	automationSchedules,
	jobAttempts,
	jobs,
	mediaItems,
	reviewViews,
	serverInstances
} from '$lib/server/db/schema';
import {
	freezeAutomationOccurrence,
	initialAutomationNextRun,
	normalizeAutomationDefinition,
	type AutomationDefinitionInput,
	type AutomationDiscoveryInputs,
	type AutomationRetryPolicy,
	type FrozenAutomationOccurrencePayload,
	type NormalizedAutomationDefinition
} from './model';
import {
	dueOccurrenceDecision,
	nextDailyRun,
	nextDailyRunAfterOccurrence,
	nextIntervalRun,
	scheduleLogicalKey
} from './schedule';

type Database = LibSQLDatabase<typeof schema>;
type ScheduleRow = typeof automationSchedules.$inferSelect;
type OccurrenceRow = typeof automationOccurrences.$inferSelect;

export type AutomationOccurrenceStatus = OccurrenceRow['status'];

class AutomationStoreError extends Error {
	constructor(
		readonly code: string,
		readonly field: string | null = null
	) {
		super(code);
		this.name = 'AutomationStoreError';
	}
}

export interface AutomationSchedulePublic {
	id: string;
	serverInstanceId: string;
	name: string;
	enabled: boolean;
	triggerType: ScheduleRow['triggerType'];
	action: ScheduleRow['action'];
	timezone: string;
	intervalMinutes: number | null;
	localTime: string | null;
	eventType: string | null;
	libraryScopes: string[];
	discoveryInputs: Record<string, unknown> | null;
	reviewViewId: string | null;
	retryPolicy: Record<string, unknown> | null;
	failurePauseThreshold: number;
	consecutiveFailures: number;
	catchUpWindowMinutes: number;
	lastRunAt: string | null;
	lastSuccessAt: string | null;
	nextRunAt: string | null;
	pausedAt: string | null;
	webhookEnabled: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface AutomationOccurrencePublic {
	id: string;
	scheduleId: string;
	serverInstanceId: string;
	logicalKey: string;
	triggerType: string;
	eventIdentity: string | null;
	scheduledFor: string;
	jobId: number | null;
	status: AutomationOccurrenceStatus;
	errorCode: string | null;
	createdAt: string;
	startedAt: string | null;
	completedAt: string | null;
	job: AutomationJobPublic | null;
}

export interface AutomationJobAttemptPublic {
	attemptNumber: number;
	trigger: string;
	status: string;
	retryable: boolean;
	errorCode: string | null;
	startedAt: string | null;
	finishedAt: string | null;
}

export interface AutomationJobPublic {
	id: number;
	status: string;
	phase: string | null;
	attempt: number;
	maxAttempts: number;
	processed: number;
	total: number;
	errorCode: string | null;
	summary: {
		processed: number;
		succeeded: number;
		failed: number;
		skipped: number;
		interrupted: number;
	} | null;
	attempts: AutomationJobAttemptPublic[];
}

export interface PendingAutomationOccurrence {
	id: string;
	scheduleId: string;
	serverInstanceId: string;
	logicalKey: string;
	payload: FrozenAutomationOccurrencePayload;
}

export interface AutomationStoreOptions {
	clock?: () => Date;
	idFactory?: () => string;
}

function storeError(code: string, field?: string | null): never {
	throw new AutomationStoreError(code, field ?? null);
}

function validNow(clock: () => Date): Date {
	const now = new Date(clock().getTime());
	if (!Number.isFinite(now.getTime())) storeError('invalid_clock');
	return now;
}

function iso(value: Date | null): string | null {
	return value ? value.toISOString() : null;
}

function publicSchedule(row: ScheduleRow): AutomationSchedulePublic {
	return {
		id: row.id,
		serverInstanceId: row.serverInstanceId,
		name: row.name,
		enabled: row.enabled,
		triggerType: row.triggerType,
		action: row.action,
		timezone: row.timezone,
		intervalMinutes: row.intervalMinutes,
		localTime: row.localTime,
		eventType: row.eventType,
		libraryScopes: [...row.libraryScopes],
		discoveryInputs: row.discoveryInputs ? { ...row.discoveryInputs } : null,
		reviewViewId: row.reviewViewId,
		retryPolicy: row.retryPolicy ? { ...row.retryPolicy } : null,
		failurePauseThreshold: row.failurePauseThreshold,
		consecutiveFailures: row.consecutiveFailures,
		catchUpWindowMinutes: row.catchUpWindowMinutes,
		lastRunAt: iso(row.lastRunAt),
		lastSuccessAt: iso(row.lastSuccessAt),
		nextRunAt: iso(row.nextRunAt),
		pausedAt: iso(row.pausedAt),
		webhookEnabled: row.webhookTokenHash !== null,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString()
	};
}

function publicOccurrence(
	row: OccurrenceRow,
	job: AutomationJobPublic | null = null
): AutomationOccurrencePublic {
	return {
		id: row.id,
		scheduleId: row.scheduleId,
		serverInstanceId: row.serverInstanceId,
		logicalKey: row.logicalKey,
		triggerType: row.triggerType,
		eventIdentity: row.eventIdentity,
		scheduledFor: row.scheduledFor.toISOString(),
		jobId: row.jobId,
		status: row.status,
		errorCode: row.errorCode,
		createdAt: row.createdAt.toISOString(),
		startedAt: iso(row.startedAt),
		completedAt: iso(row.completedAt),
		job
	};
}

function nonNegativeCount(value: unknown): number {
	const count = Number(value);
	return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function resultSummary(result: Record<string, unknown> | null): AutomationJobPublic['summary'] {
	const summary = result?.summary;
	if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null;
	const values = summary as Record<string, unknown>;
	return {
		processed: nonNegativeCount(values.processed),
		succeeded: nonNegativeCount(values.succeeded),
		failed: nonNegativeCount(values.failed),
		skipped: nonNegativeCount(values.skipped),
		interrupted: nonNegativeCount(values.interrupted)
	};
}

function definitionFromRow(row: ScheduleRow): NormalizedAutomationDefinition {
	const timing =
		row.triggerType === 'interval'
			? { triggerType: 'interval' as const, intervalMinutes: row.intervalMinutes ?? 0 }
			: row.triggerType === 'daily'
				? { triggerType: 'daily' as const, localTime: row.localTime ?? '' }
				: {
						triggerType: 'event' as const,
						eventType: row.eventType as 'sync_completed' | 'new_items'
					};
	try {
		return normalizeAutomationDefinition({
			name: row.name,
			enabled: row.enabled,
			serverInstanceId: row.serverInstanceId,
			timezone: row.timezone,
			timing,
			action: row.action,
			libraryScopes: row.libraryScopes,
			discoveryInputs:
				(row.discoveryInputs as unknown as Partial<AutomationDiscoveryInputs> | null) ?? undefined,
			reviewViewId: row.reviewViewId,
			retryPolicy:
				(row.retryPolicy as unknown as Partial<AutomationRetryPolicy> | null) ?? undefined,
			failurePauseThreshold: row.failurePauseThreshold,
			catchUpWindowMinutes: row.catchUpWindowMinutes
		});
	} catch {
		storeError('automation_definition_corrupt');
	}
}

function occurrenceId(scheduleId: string, logicalKey: string): string {
	return `occ_${createHash('sha256').update(`${scheduleId}\0${logicalKey}`).digest('hex').slice(0, 40)}`;
}

function safeErrorCode(value: string | null | undefined): string | null {
	return value && /^[A-Za-z0-9._:-]{1,96}$/.test(value) ? value : null;
}

function webhookTokenDigest(token: string): string {
	return createHash('sha256').update(token, 'utf8').digest('hex');
}

function webhookAuthorized(expectedDigest: string | null | undefined, token: string): boolean {
	const actual = Buffer.from(webhookTokenDigest(token), 'hex');
	const expected = Buffer.from(
		expectedDigest && /^[a-f0-9]{64}$/.test(expectedDigest)
			? expectedDigest
			: webhookTokenDigest('posterpilot-invalid-webhook-token'),
		'hex'
	);
	return timingSafeEqual(actual, expected) && !!expectedDigest;
}

export function createAutomationStore(database: Database, options: AutomationStoreOptions = {}) {
	const clock = options.clock ?? (() => new Date());
	const idFactory = options.idFactory ?? (() => `automation_${randomUUID()}`);

	async function assertScope(definition: NormalizedAutomationDefinition): Promise<void> {
		const [server] = await database
			.select({
				id: serverInstances.id,
				enabled: serverInstances.enabled,
				disconnectedAt: serverInstances.disconnectedAt
			})
			.from(serverInstances)
			.where(eq(serverInstances.id, definition.serverInstanceId))
			.limit(1);
		if (!server) storeError('server_instance_not_found', 'serverInstanceId');
		if (!server.enabled || server.disconnectedAt) {
			storeError('server_instance_unavailable', 'serverInstanceId');
		}

		const libraries = await database
			.select({ key: mediaItems.sectionKey })
			.from(mediaItems)
			.where(
				and(
					eq(mediaItems.serverInstanceId, definition.serverInstanceId),
					inArray(mediaItems.sectionKey, definition.libraryScopes)
				)
			)
			.groupBy(mediaItems.sectionKey);
		if (libraries.length !== definition.libraryScopes.length) {
			storeError('library_scope_not_found', 'libraryScopes');
		}

		if (definition.reviewViewId) {
			const [view] = await database
				.select({ id: reviewViews.id })
				.from(reviewViews)
				.where(
					and(
						eq(reviewViews.id, definition.reviewViewId),
						eq(reviewViews.serverInstanceId, definition.serverInstanceId)
					)
				)
				.limit(1);
			if (!view) storeError('review_view_not_found', 'reviewViewId');
		}
	}

	async function create(input: AutomationDefinitionInput): Promise<AutomationSchedulePublic> {
		const definition = normalizeAutomationDefinition(input);
		await assertScope(definition);
		const now = validNow(clock);
		const duplicate = await database
			.select({ id: automationSchedules.id })
			.from(automationSchedules)
			.where(
				and(
					eq(automationSchedules.serverInstanceId, definition.serverInstanceId),
					eq(automationSchedules.normalizedName, definition.normalizedName)
				)
			)
			.limit(1);
		if (duplicate[0]) storeError('duplicate_automation_name', 'name');
		const id = idFactory();
		if (!id || id.trim() !== id) storeError('invalid_id_factory');
		const [row] = await database
			.insert(automationSchedules)
			.values({
				id,
				serverInstanceId: definition.serverInstanceId,
				name: definition.name,
				normalizedName: definition.normalizedName,
				enabled: definition.enabled,
				triggerType: definition.triggerType,
				action: definition.action,
				timezone: definition.timezone,
				intervalMinutes: definition.intervalMinutes,
				localTime: definition.localTime,
				eventType: definition.eventType,
				libraryScopes: definition.libraryScopes,
				discoveryInputs: definition.discoveryInputs as unknown as Record<string, unknown>,
				reviewViewId: definition.reviewViewId,
				retryPolicy: definition.retryPolicy as unknown as Record<string, unknown>,
				failurePauseThreshold: definition.failurePauseThreshold,
				catchUpWindowMinutes: definition.catchUpWindowMinutes,
				nextRunAt: initialAutomationNextRun(definition, now),
				createdAt: now,
				updatedAt: now
			})
			.returning();
		return publicSchedule(row);
	}

	async function getRow(id: string, serverInstanceId: string): Promise<ScheduleRow> {
		const [row] = await database
			.select()
			.from(automationSchedules)
			.where(
				and(
					eq(automationSchedules.id, id),
					eq(automationSchedules.serverInstanceId, serverInstanceId)
				)
			)
			.limit(1);
		if (!row) storeError('automation_not_found');
		return row;
	}

	async function update(
		id: string,
		serverInstanceId: string,
		input: AutomationDefinitionInput
	): Promise<AutomationSchedulePublic> {
		await getRow(id, serverInstanceId);
		const definition = normalizeAutomationDefinition(input);
		if (definition.serverInstanceId !== serverInstanceId) {
			storeError('server_scope_mismatch', 'serverInstanceId');
		}
		await assertScope(definition);
		const duplicate = await database
			.select({ id: automationSchedules.id })
			.from(automationSchedules)
			.where(
				and(
					eq(automationSchedules.serverInstanceId, serverInstanceId),
					eq(automationSchedules.normalizedName, definition.normalizedName),
					sql`${automationSchedules.id} <> ${id}`
				)
			)
			.limit(1);
		if (duplicate[0]) storeError('duplicate_automation_name', 'name');
		const now = validNow(clock);
		const [row] = await database
			.update(automationSchedules)
			.set({
				name: definition.name,
				normalizedName: definition.normalizedName,
				enabled: definition.enabled,
				triggerType: definition.triggerType,
				action: definition.action,
				timezone: definition.timezone,
				intervalMinutes: definition.intervalMinutes,
				localTime: definition.localTime,
				eventType: definition.eventType,
				libraryScopes: definition.libraryScopes,
				discoveryInputs: definition.discoveryInputs as unknown as Record<string, unknown>,
				reviewViewId: definition.reviewViewId,
				retryPolicy: definition.retryPolicy as unknown as Record<string, unknown>,
				failurePauseThreshold: definition.failurePauseThreshold,
				catchUpWindowMinutes: definition.catchUpWindowMinutes,
				pausedAt: null,
				nextRunAt: initialAutomationNextRun(definition, now),
				updatedAt: now
			})
			.where(
				and(
					eq(automationSchedules.id, id),
					eq(automationSchedules.serverInstanceId, serverInstanceId)
				)
			)
			.returning();
		return publicSchedule(row);
	}

	async function setEnabled(
		id: string,
		serverInstanceId: string,
		enabled: boolean
	): Promise<AutomationSchedulePublic> {
		const current = await getRow(id, serverInstanceId);
		if (typeof enabled !== 'boolean') storeError('invalid_enabled', 'enabled');
		const now = validNow(clock);
		const definition = definitionFromRow({ ...current, enabled });
		if (enabled) await assertScope(definition);
		const [row] = await database
			.update(automationSchedules)
			.set({
				enabled,
				pausedAt: null,
				nextRunAt: initialAutomationNextRun(definition, now),
				updatedAt: now
			})
			.where(eq(automationSchedules.id, id))
			.returning();
		return publicSchedule(row);
	}

	async function remove(id: string, serverInstanceId: string): Promise<void> {
		await getRow(id, serverInstanceId);
		await database
			.delete(automationSchedules)
			.where(
				and(
					eq(automationSchedules.id, id),
					eq(automationSchedules.serverInstanceId, serverInstanceId)
				)
			);
	}

	async function rotateWebhookToken(
		id: string,
		serverInstanceId: string
	): Promise<{ token: string }> {
		await getRow(id, serverInstanceId);
		const token = randomBytes(32).toString('base64url');
		const now = validNow(clock);
		await database
			.update(automationSchedules)
			.set({ webhookTokenHash: webhookTokenDigest(token), updatedAt: now })
			.where(
				and(
					eq(automationSchedules.id, id),
					eq(automationSchedules.serverInstanceId, serverInstanceId)
				)
			);
		return { token };
	}

	async function clearWebhookToken(id: string, serverInstanceId: string): Promise<void> {
		await getRow(id, serverInstanceId);
		await database
			.update(automationSchedules)
			.set({ webhookTokenHash: null, updatedAt: validNow(clock) })
			.where(
				and(
					eq(automationSchedules.id, id),
					eq(automationSchedules.serverInstanceId, serverInstanceId)
				)
			);
	}

	async function list(serverInstanceId: string): Promise<AutomationSchedulePublic[]> {
		const rows = await database
			.select()
			.from(automationSchedules)
			.where(eq(automationSchedules.serverInstanceId, serverInstanceId))
			.orderBy(asc(automationSchedules.name), asc(automationSchedules.id));
		return rows.map(publicSchedule);
	}

	async function history(
		serverInstanceId: string,
		limit = 100
	): Promise<AutomationOccurrencePublic[]> {
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
			storeError('invalid_limit', 'limit');
		}
		const rows = await database
			.select()
			.from(automationOccurrences)
			.where(eq(automationOccurrences.serverInstanceId, serverInstanceId))
			.orderBy(desc(automationOccurrences.createdAt), desc(automationOccurrences.id))
			.limit(limit);
		const jobIds = rows.map((row) => row.jobId).filter((id): id is number => id !== null);
		if (!jobIds.length) return rows.map((row) => publicOccurrence(row));
		const [jobRows, attemptRows] = await Promise.all([
			database.select().from(jobs).where(inArray(jobs.id, jobIds)),
			database
				.select()
				.from(jobAttempts)
				.where(inArray(jobAttempts.jobId, jobIds))
				.orderBy(asc(jobAttempts.jobId), asc(jobAttempts.attemptNumber))
		]);
		const publicJobs = new Map<number, AutomationJobPublic>();
		for (const job of jobRows) {
			publicJobs.set(job.id, {
				id: job.id,
				status: job.status,
				phase: job.phase,
				attempt: job.attempt,
				maxAttempts: job.maxAttempts,
				processed: job.processed,
				total: job.total,
				errorCode: safeErrorCode(job.errorCode),
				summary: resultSummary(job.result),
				attempts: attemptRows
					.filter((attempt) => attempt.jobId === job.id)
					.map((attempt) => ({
						attemptNumber: attempt.attemptNumber,
						trigger: attempt.trigger,
						status: attempt.status,
						retryable: attempt.retryable ?? false,
						errorCode: safeErrorCode(attempt.errorCode),
						startedAt: iso(attempt.startedAt),
						finishedAt: iso(attempt.finishedAt)
					}))
			});
		}
		return rows.map((row) => publicOccurrence(row, row.jobId ? publicJobs.get(row.jobId) : null));
	}

	function advanceNext(
		row: ScheduleRow,
		now: Date,
		scheduledFor: Date,
		missed: boolean
	): Date | null {
		if (row.triggerType === 'event') return null;
		if (row.triggerType === 'interval') {
			return nextIntervalRun(now, row.createdAt, row.intervalMinutes!);
		}
		return missed
			? nextDailyRun(now, row.localTime!, row.timezone)
			: nextDailyRunAfterOccurrence(scheduledFor, row.localTime!, row.timezone);
	}

	async function materializeDueOccurrences(limit = 20): Promise<AutomationOccurrencePublic[]> {
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
			storeError('invalid_limit', 'limit');
		}
		const now = validNow(clock);
		const due = await database
			.select({ schedule: automationSchedules })
			.from(automationSchedules)
			.innerJoin(
				serverInstances,
				and(
					eq(serverInstances.id, automationSchedules.serverInstanceId),
					eq(serverInstances.enabled, true),
					isNull(serverInstances.disconnectedAt)
				)
			)
			.where(
				and(
					eq(automationSchedules.enabled, true),
					isNull(automationSchedules.pausedAt),
					lte(automationSchedules.nextRunAt, now)
				)
			)
			.orderBy(asc(automationSchedules.nextRunAt), asc(automationSchedules.id))
			.limit(limit);

		const created: AutomationOccurrencePublic[] = [];
		for (const candidate of due) {
			const result = await database.transaction(async (tx) => {
				const [row] = await tx
					.select()
					.from(automationSchedules)
					.where(eq(automationSchedules.id, candidate.schedule.id))
					.limit(1);
				if (!row?.enabled || row.pausedAt || !row.nextRunAt || row.nextRunAt > now) return null;
				const decision = dueOccurrenceDecision(row.nextRunAt, now, row.catchUpWindowMinutes);
				if (decision.state === 'not_due') return null;
				const definition = definitionFromRow(row);
				const logicalKey = scheduleLogicalKey({
					scheduleId: row.id,
					triggerType: row.triggerType,
					scheduledFor: row.nextRunAt,
					timezone: row.timezone
				});
				const payload = freezeAutomationOccurrence({
					automationId: row.id,
					definition,
					logicalKey,
					scheduledFor: row.nextRunAt,
					frozenAt: now
				});
				const [inserted] = await tx
					.insert(automationOccurrences)
					.values({
						id: occurrenceId(row.id, logicalKey),
						scheduleId: row.id,
						serverInstanceId: row.serverInstanceId,
						logicalKey,
						triggerType: row.triggerType,
						eventIdentity: null,
						scheduledFor: row.nextRunAt,
						status: decision.state === 'missed' ? 'skipped' : 'pending',
						payload: payload as unknown as Record<string, unknown>,
						errorCode: decision.state === 'missed' ? 'catch_up_window_expired' : null,
						completedAt: decision.state === 'missed' ? now : null,
						createdAt: now
					})
					.onConflictDoNothing()
					.returning();
				const nextRunAt = advanceNext(row, now, row.nextRunAt, decision.state === 'missed');
				await tx
					.update(automationSchedules)
					.set({ nextRunAt, updatedAt: now })
					.where(
						and(
							eq(automationSchedules.id, row.id),
							eq(automationSchedules.nextRunAt, row.nextRunAt)
						)
					);
				return inserted ?? null;
			});
			if (result) created.push(publicOccurrence(result));
		}
		return created;
	}

	async function materializeEventOccurrence(input: {
		scheduleId: string;
		serverInstanceId: string;
		eventType: 'sync_completed' | 'new_items';
		eventIdentity: string;
		occurredAt: Date;
		itemIds?: number[];
	}): Promise<AutomationOccurrencePublic> {
		const row = await getRow(input.scheduleId, input.serverInstanceId);
		if (
			!row.enabled ||
			row.pausedAt ||
			row.triggerType !== 'event' ||
			row.eventType !== input.eventType
		) {
			storeError('automation_event_not_eligible');
		}
		const now = validNow(clock);
		const occurredAt = new Date(input.occurredAt.getTime());
		if (!Number.isFinite(occurredAt.getTime())) storeError('invalid_event_time');
		const definition = definitionFromRow(row);
		const logicalKey = scheduleLogicalKey({
			scheduleId: row.id,
			triggerType: 'event',
			scheduledFor: occurredAt,
			timezone: row.timezone,
			eventIdentity: input.eventIdentity
		});
		const itemIds = [...new Set(input.itemIds ?? [])];
		if (itemIds.length) {
			const scoped = await database
				.select({ id: mediaItems.id })
				.from(mediaItems)
				.where(
					and(
						eq(mediaItems.serverInstanceId, row.serverInstanceId),
						inArray(mediaItems.sectionKey, row.libraryScopes),
						inArray(mediaItems.id, itemIds)
					)
				);
			if (scoped.length !== itemIds.length) storeError('event_item_scope_mismatch');
		}
		const payload = freezeAutomationOccurrence({
			automationId: row.id,
			definition,
			logicalKey,
			scheduledFor: occurredAt,
			frozenAt: now,
			eventIdentity: input.eventIdentity,
			itemIds
		});
		await database
			.insert(automationOccurrences)
			.values({
				id: occurrenceId(row.id, logicalKey),
				scheduleId: row.id,
				serverInstanceId: row.serverInstanceId,
				logicalKey,
				triggerType: 'event',
				eventIdentity: input.eventIdentity,
				scheduledFor: occurredAt,
				status: 'pending',
				payload: payload as unknown as Record<string, unknown>,
				createdAt: now
			})
			.onConflictDoNothing();
		const [occurrence] = await database
			.select()
			.from(automationOccurrences)
			.where(
				and(
					eq(automationOccurrences.scheduleId, row.id),
					eq(automationOccurrences.logicalKey, logicalKey)
				)
			)
			.limit(1);
		if (!occurrence) storeError('occurrence_persist_failed');
		return publicOccurrence(occurrence);
	}

	async function authorizedWebhookSchedule(input: {
		scheduleId: string;
		token: string;
	}): Promise<ScheduleRow> {
		if (
			typeof input.scheduleId !== 'string' ||
			!input.scheduleId ||
			input.scheduleId.length > 160 ||
			typeof input.token !== 'string' ||
			!/^[A-Za-z0-9_-]{40,256}$/.test(input.token)
		) {
			storeError('webhook_unauthorized');
		}
		const [row] = await database
			.select()
			.from(automationSchedules)
			.where(eq(automationSchedules.id, input.scheduleId))
			.limit(1);
		if (!webhookAuthorized(row?.webhookTokenHash, input.token) || !row) {
			storeError('webhook_unauthorized');
		}
		return row;
	}

	/** Authenticate a public webhook before its potentially untrusted body is consumed. */
	async function authenticateWebhook(input: { scheduleId: string; token: string }): Promise<void> {
		await authorizedWebhookSchedule(input);
	}

	async function deliverWebhook(input: {
		scheduleId: string;
		token: string;
		eventType: 'sync_completed' | 'new_items';
		eventIdentity: string;
		sourceItemIds?: string[];
		occurredAt: Date;
	}): Promise<AutomationOccurrencePublic> {
		const row = await authorizedWebhookSchedule(input);
		if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/.test(input.eventIdentity)) {
			storeError('invalid_event_identity', 'eventIdentity');
		}
		const sourceItemIds = [...new Set(input.sourceItemIds ?? [])].sort();
		if (
			sourceItemIds.length > 500 ||
			sourceItemIds.some(
				(value) =>
					typeof value !== 'string' ||
					!value.trim() ||
					value !== value.trim() ||
					value.length > 250 ||
					[...value].some((character) => {
						const code = character.charCodeAt(0);
						return code <= 0x1f || code === 0x7f;
					})
			)
		) {
			storeError('invalid_source_item_ids', 'sourceItemIds');
		}
		if (input.eventType === 'new_items' && sourceItemIds.length === 0) {
			storeError('invalid_source_item_ids', 'sourceItemIds');
		}
		const scopedItems = sourceItemIds.length
			? await database
					.select({ id: mediaItems.id, ratingKey: mediaItems.ratingKey })
					.from(mediaItems)
					.where(
						and(
							eq(mediaItems.serverInstanceId, row.serverInstanceId),
							inArray(mediaItems.sectionKey, row.libraryScopes),
							inArray(mediaItems.ratingKey, sourceItemIds),
							isNull(mediaItems.sourceRemovedAt)
						)
					)
			: [];
		if (scopedItems.length !== sourceItemIds.length) {
			storeError('webhook_item_scope_mismatch', 'sourceItemIds');
		}
		const idBySource = new Map(scopedItems.map((item) => [item.ratingKey, item.id]));
		return materializeEventOccurrence({
			scheduleId: row.id,
			serverInstanceId: row.serverInstanceId,
			eventType: input.eventType,
			eventIdentity: input.eventIdentity,
			occurredAt: input.occurredAt,
			itemIds: sourceItemIds.map((sourceId) => idBySource.get(sourceId)!)
		});
	}

	async function pendingOccurrences(limit = 100): Promise<PendingAutomationOccurrence[]> {
		const rows = await database
			.select()
			.from(automationOccurrences)
			.where(and(eq(automationOccurrences.status, 'pending'), isNull(automationOccurrences.jobId)))
			.orderBy(asc(automationOccurrences.scheduledFor), asc(automationOccurrences.id))
			.limit(limit);
		return rows.map((row) => ({
			id: row.id,
			scheduleId: row.scheduleId,
			serverInstanceId: row.serverInstanceId,
			logicalKey: row.logicalKey,
			payload: row.payload as unknown as FrozenAutomationOccurrencePayload
		}));
	}

	async function attachJob(occurrenceIdValue: string, jobId: number): Promise<boolean> {
		if (!Number.isSafeInteger(jobId) || jobId <= 0) storeError('invalid_job_id');
		const now = validNow(clock);
		const updated = await database
			.update(automationOccurrences)
			.set({ jobId, status: 'running', startedAt: now })
			.where(
				and(
					eq(automationOccurrences.id, occurrenceIdValue),
					eq(automationOccurrences.status, 'pending'),
					isNull(automationOccurrences.jobId)
				)
			)
			.returning({ id: automationOccurrences.id });
		return updated.length === 1;
	}

	async function completeOccurrence(input: {
		occurrenceId: string;
		jobId?: number;
		status: 'completed' | 'partial_failed' | 'failed';
		result?: Record<string, unknown> | null;
		errorCode?: string | null;
	}): Promise<AutomationOccurrencePublic> {
		const now = validNow(clock);
		return database.transaction(async (tx) => {
			const [occurrence] = await tx
				.select()
				.from(automationOccurrences)
				.where(eq(automationOccurrences.id, input.occurrenceId))
				.limit(1);
			if (!occurrence) storeError('occurrence_not_found');
			if (input.jobId !== undefined && occurrence.jobId !== input.jobId) {
				storeError('occurrence_job_mismatch');
			}
			if (['completed', 'partial_failed', 'failed', 'skipped'].includes(occurrence.status)) {
				return publicOccurrence(occurrence);
			}
			const [schedule] = await tx
				.select()
				.from(automationSchedules)
				.where(eq(automationSchedules.id, occurrence.scheduleId))
				.limit(1);
			if (!schedule) storeError('automation_not_found');
			const failed = input.status !== 'completed';
			const consecutiveFailures = failed ? schedule.consecutiveFailures + 1 : 0;
			const shouldPause = failed && consecutiveFailures >= schedule.failurePauseThreshold;
			const [updated] = await tx
				.update(automationOccurrences)
				.set({
					status: input.status,
					result: input.result ?? null,
					errorCode: failed ? (safeErrorCode(input.errorCode) ?? 'automation_failed') : null,
					error: null,
					completedAt: now
				})
				.where(eq(automationOccurrences.id, occurrence.id))
				.returning();
			await tx
				.update(automationSchedules)
				.set({
					consecutiveFailures,
					lastRunAt: now,
					lastSuccessAt: failed ? schedule.lastSuccessAt : now,
					pausedAt: shouldPause ? now : schedule.pausedAt,
					enabled: shouldPause ? false : schedule.enabled,
					nextRunAt: shouldPause ? null : schedule.nextRunAt,
					updatedAt: now
				})
				.where(eq(automationSchedules.id, schedule.id));
			return publicOccurrence(updated);
		});
	}

	/** Repair the narrow crash/race gap between a terminal job and occurrence bookkeeping. */
	async function reconcileTerminalOccurrences(limit = 100): Promise<number> {
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
			storeError('invalid_limit', 'limit');
		}
		const rows = await database
			.select({
				occurrenceId: automationOccurrences.id,
				jobId: jobs.id,
				status: jobs.status,
				result: jobs.result,
				errorCode: jobs.errorCode
			})
			.from(automationOccurrences)
			.innerJoin(jobs, eq(jobs.id, automationOccurrences.jobId))
			.where(
				and(
					eq(automationOccurrences.status, 'running'),
					inArray(jobs.status, [
						'completed',
						'partial_failed',
						'failed',
						'cancelled',
						'interrupted'
					])
				)
			)
			.orderBy(asc(automationOccurrences.createdAt), asc(automationOccurrences.id))
			.limit(limit);
		for (const row of rows) {
			await completeOccurrence({
				occurrenceId: row.occurrenceId,
				jobId: row.jobId,
				status:
					row.status === 'completed'
						? 'completed'
						: row.status === 'partial_failed'
							? 'partial_failed'
							: 'failed',
				result: row.result,
				errorCode: row.errorCode
			});
		}
		return rows.length;
	}

	return {
		create,
		update,
		setEnabled,
		remove,
		rotateWebhookToken,
		clearWebhookToken,
		list,
		history,
		materializeDueOccurrences,
		materializeEventOccurrence,
		authenticateWebhook,
		deliverWebhook,
		pendingOccurrences,
		attachJob,
		completeOccurrence,
		reconcileTerminalOccurrences
	};
}
