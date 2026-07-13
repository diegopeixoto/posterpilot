import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import { artworkRevisionGroups } from '$lib/server/db/schema';
import { recoverInterruptedRevisionGroups } from './group-recovery';

const NOW = new Date('2026-07-11T12:00:00.000Z');

let client: Client;
let database: LibSQLDatabase<typeof schema>;

beforeEach(async () => {
	// Shared-cache memory is required because libsql transactions may use a second
	// connection; plain `:memory:` would create an empty database per connection.
	client = createClient({ url: 'file::memory:?cache=shared' });
	database = drizzle(client, { schema });
	await client.executeMultiple(`
		PRAGMA foreign_keys = ON;
		DROP TABLE IF EXISTS artwork_revisions;
		DROP TABLE IF EXISTS artwork_revision_groups;
		DROP TABLE IF EXISTS jobs;
		DROP TABLE IF EXISTS server_instances;
		CREATE TABLE server_instances (
			id text PRIMARY KEY NOT NULL
		);
		CREATE TABLE jobs (
			id integer PRIMARY KEY AUTOINCREMENT,
			server_instance_id text REFERENCES server_instances(id)
		);
		CREATE TABLE artwork_revision_groups (
			id text PRIMARY KEY NOT NULL,
			server_instance_id text NOT NULL REFERENCES server_instances(id),
			operation_plan_id text,
			job_id integer REFERENCES jobs(id) ON DELETE SET NULL,
			kind text NOT NULL,
			initiator text NOT NULL,
			outcome text DEFAULT 'pending' NOT NULL,
			summary text,
			created_at integer NOT NULL,
			completed_at integer
		);
		CREATE TABLE artwork_revisions (
			id text PRIMARY KEY NOT NULL,
			group_id text NOT NULL REFERENCES artwork_revision_groups(id),
			server_instance_id text NOT NULL REFERENCES server_instances(id),
			action text NOT NULL,
			destination text NOT NULL,
			kind text NOT NULL,
			outcome text DEFAULT 'pending' NOT NULL,
			verification text DEFAULT 'pending' NOT NULL,
			created_at integer NOT NULL,
			completed_at integer
		);
		INSERT INTO server_instances (id) VALUES ('server-a');
		INSERT INTO jobs (id, server_instance_id) VALUES (1, 'server-a');
	`);
});

afterEach(() => {
	client.close();
});

function insertGroup(id: string, jobId: number | null, outcome = 'pending'): Promise<unknown> {
	return client.execute({
		sql: `INSERT INTO artwork_revision_groups
			(id, server_instance_id, job_id, kind, initiator, outcome, created_at)
			VALUES (?, 'server-a', ?, 'undo', 'user', ?, ?)`,
		args: [id, jobId, outcome, NOW.getTime()]
	});
}

function insertRevision(id: string, groupId: string, outcome: string): Promise<unknown> {
	return client.execute({
		sql: `INSERT INTO artwork_revisions
			(id, group_id, server_instance_id, action, destination, kind, outcome, verification, created_at)
			VALUES (?, ?, 'server-a', 'undo', 'server', 'poster', ?, 'exact', ?)`,
		args: [id, groupId, outcome, NOW.getTime()]
	});
}

async function groupRow(id: string) {
	return (
		await database
			.select()
			.from(artworkRevisionGroups)
			.where(eq(artworkRevisionGroups.id, id))
			.limit(1)
	)[0];
}

describe('recoverInterruptedRevisionGroups', () => {
	it('closes a job-less pending group with recorded successes as partial', async () => {
		await insertGroup('group-1', null);
		await insertRevision('rev-1', 'group-1', 'success');
		await insertRevision('rev-2', 'group-1', 'failed');

		const result = await recoverInterruptedRevisionGroups(database, NOW);

		expect(result.recovered).toBe(1);
		const group = await groupRow('group-1');
		expect(group.outcome).toBe('partial');
		expect(group.completedAt).toEqual(NOW);
		expect(group.summary).toMatchObject({ interruptedByRestart: true, recordedOutcomes: 2 });
	});

	it('closes a job-less pending group with no recorded successes as failed', async () => {
		await insertGroup('group-1', null);

		const result = await recoverInterruptedRevisionGroups(database, NOW);

		expect(result.recovered).toBe(1);
		const group = await groupRow('group-1');
		expect(group.outcome).toBe('failed');
		expect(group.summary).toMatchObject({ interruptedByRestart: true, recordedOutcomes: 0 });
	});

	it('leaves job-owned pending groups to durable job recovery', async () => {
		await insertGroup('group-1', 1);

		const result = await recoverInterruptedRevisionGroups(database, NOW);

		expect(result.recovered).toBe(0);
		expect((await groupRow('group-1')).outcome).toBe('pending');
	});

	it('never touches finalized groups', async () => {
		await insertGroup('group-1', null, 'success');

		const result = await recoverInterruptedRevisionGroups(database, NOW);

		expect(result.recovered).toBe(0);
		const group = await groupRow('group-1');
		expect(group.outcome).toBe('success');
		expect(group.summary).toBeNull();
	});
});
