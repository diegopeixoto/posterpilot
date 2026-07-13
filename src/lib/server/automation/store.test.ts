import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema';
import {
	automationOccurrences,
	automationSchedules,
	jobs,
	mediaItems,
	serverInstances
} from '$lib/server/db/schema';
import { createAutomationStore } from './store';

let directory: string;
let client: Client;
let database: LibSQLDatabase<typeof schema>;
let now = new Date('2026-07-10T12:00:00.000Z');
let idSequence = 0;

function definition(overrides: Record<string, unknown> = {}) {
	return {
		name: 'Nightly review',
		enabled: true,
		serverInstanceId: 'server-a',
		timezone: 'America/Bahia',
		timing: { triggerType: 'daily' as const, localTime: '09:30' },
		libraryScopes: ['movies'],
		...overrides
	};
}

function store() {
	return createAutomationStore(database, {
		clock: () => new Date(now),
		idFactory: () => `automation-${++idSequence}`
	});
}

beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), 'posterpilot-automation-'));
	client = createClient({ url: `file:${join(directory, 'automation.db')}` });
	database = drizzle(client, { schema });
	await migrate(database, { migrationsFolder: './drizzle' });
});

afterAll(async () => {
	client.close();
	await rm(directory, { recursive: true, force: true });
});

beforeEach(async () => {
	await database.delete(automationOccurrences);
	await database.delete(jobs);
	await database.delete(automationSchedules);
	await database.delete(mediaItems);
	await database.delete(serverInstances);
	now = new Date('2026-07-10T12:00:00.000Z');
	idSequence = 0;
	await database.insert(serverInstances).values([
		{
			id: 'server-a',
			name: 'Server A',
			normalizedName: 'server a',
			type: 'plex',
			enabled: true
		},
		{
			id: 'server-b',
			name: 'Server B',
			normalizedName: 'server b',
			type: 'jellyfin',
			enabled: true
		}
	]);
	await database.insert(mediaItems).values([
		{
			serverInstanceId: 'server-a',
			ratingKey: 'a-1',
			sectionKey: 'movies',
			type: 'movie',
			title: 'A One'
		},
		{
			serverInstanceId: 'server-a',
			ratingKey: 'a-2',
			sectionKey: 'shows',
			type: 'show',
			title: 'A Two'
		},
		{
			serverInstanceId: 'server-b',
			ratingKey: 'b-1',
			sectionKey: 'movies',
			type: 'movie',
			title: 'B One'
		}
	]);
});

describe('automation store', () => {
	it('creates normalized review-first schedules and isolates duplicate names by server', async () => {
		const repository = store();
		const first = await repository.create(definition({ name: '  Nightly   Review ' }));
		expect(first).toMatchObject({
			id: 'automation-1',
			serverInstanceId: 'server-a',
			name: 'Nightly Review',
			enabled: true,
			action: 'sync_discover',
			nextRunAt: '2026-07-10T12:30:00.000Z'
		});
		await expect(repository.create(definition({ name: 'nightly review' }))).rejects.toMatchObject({
			code: 'duplicate_automation_name'
		});
		await expect(
			repository.create(definition({ name: 'nightly review', serverInstanceId: 'server-b' }))
		).resolves.toMatchObject({ serverInstanceId: 'server-b' });
	});

	it('rejects libraries and review identities outside the selected server', async () => {
		const repository = store();
		await expect(
			repository.create(definition({ libraryScopes: ['missing'] }))
		).rejects.toMatchObject({
			code: 'library_scope_not_found'
		});
		await expect(
			repository.create(definition({ reviewViewId: 'view-from-another-server' }))
		).rejects.toMatchObject({ code: 'review_view_not_found' });
	});

	it('materializes each due logical occurrence once and advances its calendar', async () => {
		const repository = store();
		await repository.create(definition());
		now = new Date('2026-07-10T12:35:00.000Z');
		const first = await repository.materializeDueOccurrences();
		expect(first).toHaveLength(1);
		expect(first[0]).toMatchObject({
			logicalKey: 'daily:2026-07-10',
			status: 'pending',
			scheduledFor: '2026-07-10T12:30:00.000Z'
		});
		expect(await repository.materializeDueOccurrences()).toEqual([]);
		const schedules = await repository.list('server-a');
		expect(schedules[0].nextRunAt).toBe('2026-07-11T12:30:00.000Z');
		const raw = (await database.select().from(automationOccurrences))[0];
		expect(raw.payload).toMatchObject({ reviewOnly: true, action: 'sync_discover' });
	});

	it('records but does not enqueue an occurrence outside its catch-up window', async () => {
		const repository = store();
		await repository.create(definition({ catchUpWindowMinutes: 10 }));
		now = new Date('2026-07-10T15:00:00.000Z');
		const [missed] = await repository.materializeDueOccurrences();
		expect(missed).toMatchObject({ status: 'skipped', errorCode: 'catch_up_window_expired' });
		expect(await repository.pendingOccurrences()).toEqual([]);
		expect((await repository.list('server-a'))[0].nextRunAt).toBe('2026-07-11T12:30:00.000Z');
	});

	it('coalesces duplicate events and freezes only server-scoped items', async () => {
		const repository = store();
		const created = await repository.create(
			definition({ timing: { triggerType: 'event', eventType: 'new_items' } })
		);
		const [itemA, , itemB] = await database.select({ id: mediaItems.id }).from(mediaItems);
		const event = {
			scheduleId: created.id,
			serverInstanceId: 'server-a',
			eventType: 'new_items' as const,
			eventIdentity: 'sync:44:new-items',
			occurredAt: new Date('2026-07-10T12:05:00.000Z'),
			itemIds: [itemA.id]
		};
		const first = await repository.materializeEventOccurrence(event);
		const duplicate = await repository.materializeEventOccurrence(event);
		expect(duplicate.id).toBe(first.id);
		expect(await database.select().from(automationOccurrences)).toHaveLength(1);
		await expect(
			repository.materializeEventOccurrence({
				...event,
				eventIdentity: 'sync:45:new-items',
				itemIds: [itemB.id]
			})
		).rejects.toMatchObject({ code: 'event_item_scope_mismatch' });
	});

	it('authenticates hashed webhook tokens and coalesces duplicate deliveries', async () => {
		const repository = store();
		const created = await repository.create(
			definition({ timing: { triggerType: 'event', eventType: 'new_items' } })
		);
		const { token } = await repository.rotateWebhookToken(created.id, 'server-a');
		expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
		expect((await repository.list('server-a'))[0].webhookEnabled).toBe(true);
		await expect(
			repository.authenticateWebhook({ scheduleId: created.id, token })
		).resolves.toBeUndefined();
		await expect(
			repository.authenticateWebhook({ scheduleId: created.id, token: `${token}wrong` })
		).rejects.toMatchObject({ code: 'webhook_unauthorized' });
		await expect(
			repository.deliverWebhook({
				scheduleId: created.id,
				token: `${token}wrong`,
				eventType: 'new_items',
				eventIdentity: 'delivery-44',
				sourceItemIds: ['a-1'],
				occurredAt: new Date('2026-07-10T12:05:00.000Z')
			})
		).rejects.toMatchObject({ code: 'webhook_unauthorized' });
		const delivery = {
			scheduleId: created.id,
			token,
			eventType: 'new_items' as const,
			eventIdentity: 'delivery-44',
			sourceItemIds: ['a-1'],
			occurredAt: new Date('2026-07-10T12:05:00.000Z')
		};
		const first = await repository.deliverWebhook(delivery);
		const duplicate = await repository.deliverWebhook(delivery);
		expect(duplicate.id).toBe(first.id);
		expect(await database.select().from(automationOccurrences)).toHaveLength(1);
		await expect(
			repository.deliverWebhook({
				...delivery,
				eventIdentity: 'delivery-45',
				sourceItemIds: ['a-2']
			})
		).rejects.toMatchObject({ code: 'webhook_item_scope_mismatch' });
		await repository.clearWebhookToken(created.id, 'server-a');
		expect((await repository.list('server-a'))[0].webhookEnabled).toBe(false);
		await expect(
			repository.deliverWebhook({ ...delivery, eventIdentity: 'delivery-46' })
		).rejects.toMatchObject({ code: 'webhook_unauthorized' });
	});

	it('pauses an automation at its consecutive failure threshold', async () => {
		const repository = store();
		await repository.create(definition({ failurePauseThreshold: 2 }));
		now = new Date('2026-07-10T12:35:00.000Z');
		await repository.materializeDueOccurrences();
		let [pending] = await repository.pendingOccurrences();
		await repository.completeOccurrence({
			occurrenceId: pending.id,
			status: 'failed',
			errorCode: 'provider_timeout'
		});
		let schedule = (await repository.list('server-a'))[0];
		expect(schedule).toMatchObject({ enabled: true, consecutiveFailures: 1, pausedAt: null });

		await database
			.update(automationSchedules)
			.set({ nextRunAt: new Date('2026-07-11T12:30:00.000Z') })
			.where(eq(automationSchedules.id, schedule.id));
		now = new Date('2026-07-11T12:31:00.000Z');
		await repository.materializeDueOccurrences();
		pending = (await repository.pendingOccurrences()).at(-1)!;
		await repository.completeOccurrence({
			occurrenceId: pending.id,
			status: 'partial_failed',
			errorCode: 'provider_partial'
		});
		schedule = (await repository.list('server-a'))[0];
		expect(schedule.enabled).toBe(false);
		expect(schedule.consecutiveFailures).toBe(2);
		expect(schedule.pausedAt).not.toBeNull();
		expect(schedule.nextRunAt).toBeNull();
	});

	it('reconciles an attached occurrence from its durable terminal job', async () => {
		const repository = store();
		await repository.create(definition());
		now = new Date('2026-07-10T12:35:00.000Z');
		await repository.materializeDueOccurrences();
		const [pending] = await repository.pendingOccurrences();
		const [job] = await database
			.insert(jobs)
			.values({
				type: 'automation',
				status: 'completed',
				serverInstanceId: 'server-a',
				result: { summary: { processed: 2, succeeded: 2, failed: 0 } }
			})
			.returning();
		expect(await repository.attachJob(pending.id, job.id)).toBe(true);
		expect(await repository.reconcileTerminalOccurrences()).toBe(1);
		expect((await repository.history('server-a'))[0]).toMatchObject({
			id: pending.id,
			jobId: job.id,
			status: 'completed',
			job: {
				id: job.id,
				status: 'completed',
				summary: { processed: 2, succeeded: 2, failed: 0 }
			}
		});
		expect((await repository.list('server-a'))[0]).toMatchObject({
			consecutiveFailures: 0,
			lastSuccessAt: now.toISOString()
		});
	});

	it('keeps an already-frozen occurrence unchanged when the schedule is edited', async () => {
		const repository = store();
		const created = await repository.create(definition());
		now = new Date('2026-07-10T12:35:00.000Z');
		await repository.materializeDueOccurrences();
		const before = (await database.select().from(automationOccurrences))[0].payload;
		await repository.update(
			created.id,
			'server-a',
			definition({
				name: 'Edited schedule',
				timing: { triggerType: 'interval', intervalMinutes: 60 },
				discoveryInputs: { forceRefresh: true, providers: ['tmdb'] }
			})
		);
		const after = (await database.select().from(automationOccurrences))[0].payload;
		expect(after).toEqual(before);
	});
});
