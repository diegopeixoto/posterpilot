import type { FrozenAutomationOccurrencePayload } from './model';

export interface AutomationSchedulerStore {
	materializeDueOccurrences(limit?: number): Promise<unknown[]>;
	pendingOccurrences(limit?: number): Promise<
		Array<{
			id: string;
			scheduleId: string;
			serverInstanceId: string;
			logicalKey: string;
			payload: FrozenAutomationOccurrencePayload;
		}>
	>;
	attachJob(occurrenceId: string, jobId: number): Promise<boolean>;
	list(serverInstanceId: string): Promise<
		Array<{
			id: string;
			enabled: boolean;
			pausedAt: string | null;
			triggerType: 'interval' | 'daily' | 'event';
			eventType: string | null;
			libraryScopes: string[];
		}>
	>;
	reconcileTerminalOccurrences(limit?: number): Promise<number>;
	materializeEventOccurrence(input: {
		scheduleId: string;
		serverInstanceId: string;
		eventType: 'sync_completed' | 'new_items';
		eventIdentity: string;
		occurredAt: Date;
		itemIds?: number[];
	}): Promise<{ id: string }>;
}

export interface AutomationSchedulerDependencies {
	store: AutomationSchedulerStore;
	enqueue(
		payload: {
			kind: 'automation';
			occurrenceId: string;
			occurrence: FrozenAutomationOccurrencePayload;
		},
		options: {
			persistedType: 'automation';
			initiator: 'automation';
			trigger: string;
			idempotencySalt: string;
			maxAttempts: number;
		}
	): Promise<{ jobId: number; reused: boolean }>;
	mutationsAllowed?(): boolean;
	clock?: () => Date;
}

export function createAutomationScheduler(dependencies: AutomationSchedulerDependencies) {
	const clock = dependencies.clock ?? (() => new Date());
	let polling: Promise<void> | null = null;

	async function enqueuePending(): Promise<void> {
		const pending = await dependencies.store.pendingOccurrences(100);
		for (const occurrence of pending) {
			try {
				const result = await dependencies.enqueue(
					{
						kind: 'automation',
						occurrenceId: occurrence.id,
						occurrence: occurrence.payload
					},
					{
						persistedType: 'automation',
						initiator: 'automation',
						trigger: occurrence.logicalKey,
						idempotencySalt: occurrence.id,
						maxAttempts: occurrence.payload.retryPolicy.maxAttempts
					}
				);
				await dependencies.store.attachJob(occurrence.id, result.jobId);
			} catch {
				// A conflicting scoped job leaves the occurrence pending. The next poll
				// retries after that owner reaches a terminal state without duplicating work.
			}
		}
	}

	async function runPoll(): Promise<void> {
		if (dependencies.mutationsAllowed && !dependencies.mutationsAllowed()) return;
		await dependencies.store.reconcileTerminalOccurrences(100);
		await dependencies.store.materializeDueOccurrences(20);
		await enqueuePending();
	}

	function poll(): Promise<void> {
		if (!polling) {
			polling = runPoll().finally(() => {
				polling = null;
			});
		}
		return polling;
	}

	async function notifyEvent(input: {
		serverInstanceId: string;
		eventType: 'sync_completed' | 'new_items';
		eventIdentity: string;
		/** Carries each item's library so a scoped schedule only ever sees its own. */
		items?: Array<{ id: number; librarySectionKey: string }>;
		librarySectionKeys?: string[];
		occurredAt?: Date;
	}): Promise<string[]> {
		if (dependencies.mutationsAllowed && !dependencies.mutationsAllowed()) return [];
		const schedules = await dependencies.store.list(input.serverInstanceId);
		const eligible = schedules.filter(
			(schedule) =>
				schedule.enabled &&
				!schedule.pausedAt &&
				schedule.triggerType === 'event' &&
				schedule.eventType === input.eventType &&
				(!input.librarySectionKeys?.length ||
					schedule.libraryScopes.some((key) => input.librarySectionKeys?.includes(key)))
		);
		const occurredAt = new Date((input.occurredAt ?? clock()).getTime());
		const ids: string[] = [];
		for (const schedule of eligible) {
			// One sync can create items across several libraries. The store rejects an
			// occurrence carrying an item outside the schedule's libraries, so narrow the
			// event to each schedule's own scope — and skip a schedule that got nothing.
			let itemIds: number[] | undefined;
			if (input.items) {
				itemIds = input.items
					.filter((item) => schedule.libraryScopes.includes(item.librarySectionKey))
					.map((item) => item.id);
				if (!itemIds.length) continue;
			}
			const occurrence = await dependencies.store.materializeEventOccurrence({
				scheduleId: schedule.id,
				serverInstanceId: input.serverInstanceId,
				eventType: input.eventType,
				eventIdentity: input.eventIdentity,
				occurredAt,
				itemIds
			});
			ids.push(occurrence.id);
		}
		await enqueuePending();
		return ids;
	}

	return { poll, notifyEvent };
}
