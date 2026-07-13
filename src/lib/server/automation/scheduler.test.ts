import { describe, expect, it, vi } from 'vitest';
import { freezeAutomationOccurrence, normalizeAutomationDefinition } from './model';
import { createAutomationScheduler, type AutomationSchedulerStore } from './scheduler';

const OCCURRENCE_ID = `occ_${'a'.repeat(40)}`;

function occurrence() {
	return freezeAutomationOccurrence({
		automationId: 'automation-a',
		definition: normalizeAutomationDefinition({
			name: 'Review',
			enabled: true,
			serverInstanceId: 'server-a',
			timezone: 'UTC',
			timing: { triggerType: 'interval', intervalMinutes: 60 },
			libraryScopes: ['movies'],
			retryPolicy: { maxAttempts: 4 }
		}),
		logicalKey: 'interval:2026-07-10T12:00:00.000Z',
		scheduledFor: new Date('2026-07-10T12:00:00.000Z'),
		frozenAt: new Date('2026-07-10T12:00:00.000Z')
	});
}

function dependencies() {
	const payload = occurrence();
	const store = {
		materializeDueOccurrences: vi.fn().mockResolvedValue([{ id: OCCURRENCE_ID }]),
		pendingOccurrences: vi.fn().mockResolvedValue([
			{
				id: OCCURRENCE_ID,
				scheduleId: 'automation-a',
				serverInstanceId: 'server-a',
				logicalKey: payload.logicalKey,
				payload
			}
		]),
		attachJob: vi.fn().mockResolvedValue(true),
		reconcileTerminalOccurrences: vi.fn().mockResolvedValue(0),
		list: vi.fn().mockResolvedValue([]),
		materializeEventOccurrence: vi.fn()
	} satisfies AutomationSchedulerStore;
	const enqueue = vi.fn().mockResolvedValue({ jobId: 41, reused: false });
	return { store, enqueue, payload };
}

describe('automation scheduler', () => {
	it('materializes, durably enqueues, and attaches pending occurrences', async () => {
		const deps = dependencies();
		const scheduler = createAutomationScheduler({ store: deps.store, enqueue: deps.enqueue });
		await scheduler.poll();
		expect(deps.store.reconcileTerminalOccurrences).toHaveBeenCalledWith(100);
		expect(deps.store.materializeDueOccurrences).toHaveBeenCalledWith(20);
		expect(deps.enqueue).toHaveBeenCalledWith(
			{ kind: 'automation', occurrenceId: OCCURRENCE_ID, occurrence: deps.payload },
			expect.objectContaining({
				persistedType: 'automation',
				initiator: 'automation',
				idempotencySalt: OCCURRENCE_ID,
				maxAttempts: 4
			})
		);
		expect(deps.store.attachJob).toHaveBeenCalledWith(OCCURRENCE_ID, 41);
	});

	it('leaves a conflicting occurrence pending for a later poll', async () => {
		const deps = dependencies();
		deps.enqueue.mockRejectedValue(Object.assign(new Error(), { code: 'job_conflict' }));
		const scheduler = createAutomationScheduler({ store: deps.store, enqueue: deps.enqueue });
		await expect(scheduler.poll()).resolves.toBeUndefined();
		expect(deps.store.attachJob).not.toHaveBeenCalled();
	});

	it('coalesces eligible event schedules and skips disabled or unrelated triggers', async () => {
		const deps = dependencies();
		deps.store.pendingOccurrences = vi.fn().mockResolvedValue([]);
		deps.store.list = vi.fn().mockResolvedValue([
			{
				id: 'eligible',
				enabled: true,
				pausedAt: null,
				triggerType: 'event',
				eventType: 'new_items',
				libraryScopes: ['movies']
			},
			{
				id: 'disabled',
				enabled: false,
				pausedAt: null,
				triggerType: 'event',
				eventType: 'new_items',
				libraryScopes: ['movies']
			}
		]);
		deps.store.materializeEventOccurrence = vi.fn().mockResolvedValue({ id: 'event-occ' });
		const scheduler = createAutomationScheduler({ store: deps.store, enqueue: deps.enqueue });
		await expect(
			scheduler.notifyEvent({
				serverInstanceId: 'server-a',
				eventType: 'new_items',
				eventIdentity: 'sync:1:new',
				items: [{ id: 2, librarySectionKey: 'movies' }]
			})
		).resolves.toEqual(['event-occ']);
		expect(deps.store.materializeEventOccurrence).toHaveBeenCalledTimes(1);
		expect(deps.store.materializeEventOccurrence).toHaveBeenCalledWith(
			expect.objectContaining({ scheduleId: 'eligible', itemIds: [2] })
		);
	});

	it('does not mutate schedules while application maintenance is active', async () => {
		const deps = dependencies();
		const scheduler = createAutomationScheduler({
			store: deps.store,
			enqueue: deps.enqueue,
			mutationsAllowed: () => false
		});
		await scheduler.poll();
		expect(deps.store.materializeDueOccurrences).not.toHaveBeenCalled();
	});

	it("narrows new-item events to each schedule's own libraries", async () => {
		// One sync can create items in several libraries. The store rejects an occurrence
		// carrying an item outside the schedule's scope, so a shared id list used to make
		// a scoped automation throw — and abort the schedules queued behind it.
		const deps = dependencies();
		deps.store.pendingOccurrences = vi.fn().mockResolvedValue([]);
		deps.store.list = vi.fn().mockResolvedValue([
			{
				id: 'movies-only',
				enabled: true,
				pausedAt: null,
				triggerType: 'event',
				eventType: 'new_items',
				libraryScopes: ['movies']
			},
			{
				id: 'shows-only',
				enabled: true,
				pausedAt: null,
				triggerType: 'event',
				eventType: 'new_items',
				libraryScopes: ['shows']
			}
		]);
		deps.store.materializeEventOccurrence = vi
			.fn()
			.mockImplementation(async ({ scheduleId }) => ({ id: `occ-${scheduleId}` }));
		const scheduler = createAutomationScheduler({ store: deps.store, enqueue: deps.enqueue });

		await expect(
			scheduler.notifyEvent({
				serverInstanceId: 'server-a',
				eventType: 'new_items',
				eventIdentity: 'sync:1:new',
				librarySectionKeys: ['movies', 'shows'],
				items: [
					{ id: 2, librarySectionKey: 'movies' },
					{ id: 5, librarySectionKey: 'shows' },
					{ id: 9, librarySectionKey: 'movies' }
				]
			})
		).resolves.toEqual(['occ-movies-only', 'occ-shows-only']);

		expect(deps.store.materializeEventOccurrence).toHaveBeenCalledWith(
			expect.objectContaining({ scheduleId: 'movies-only', itemIds: [2, 9] })
		);
		expect(deps.store.materializeEventOccurrence).toHaveBeenCalledWith(
			expect.objectContaining({ scheduleId: 'shows-only', itemIds: [5] })
		);
	});

	it('skips an eligible schedule whose libraries gained no new items', async () => {
		const deps = dependencies();
		deps.store.pendingOccurrences = vi.fn().mockResolvedValue([]);
		deps.store.list = vi.fn().mockResolvedValue([
			{
				id: 'shows-only',
				enabled: true,
				pausedAt: null,
				triggerType: 'event',
				eventType: 'new_items',
				libraryScopes: ['shows']
			}
		]);
		deps.store.materializeEventOccurrence = vi.fn();
		const scheduler = createAutomationScheduler({ store: deps.store, enqueue: deps.enqueue });

		// The library was synced (so the schedule is eligible) but nothing new landed in it.
		await expect(
			scheduler.notifyEvent({
				serverInstanceId: 'server-a',
				eventType: 'new_items',
				eventIdentity: 'sync:1:new',
				librarySectionKeys: ['movies', 'shows'],
				items: [{ id: 2, librarySectionKey: 'movies' }]
			})
		).resolves.toEqual([]);
		expect(deps.store.materializeEventOccurrence).not.toHaveBeenCalled();
	});
});
