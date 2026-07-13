import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import { createDiagnosticHistoryStore } from './history';
import type { DiagnosticResultValue } from './types';

let client: Client;
let database: LibSQLDatabase<typeof schema>;
let databasePath: string;
let runNumber: number;

beforeEach(async () => {
	databasePath = `/tmp/posterpilot-diagnostics-${randomUUID()}.db`;
	client = createClient({ url: `file:${databasePath}` });
	database = drizzle(client, { schema });
	await client.executeMultiple(`
		PRAGMA foreign_keys = ON;
		CREATE TABLE provider_status (
			id integer PRIMARY KEY AUTOINCREMENT,
			server_instance_id text,
			component_type text NOT NULL,
			component_key text NOT NULL,
			status text DEFAULT 'unknown' NOT NULL,
			credential_status text DEFAULT 'unknown' NOT NULL,
			latency_ms integer,
			last_attempt_at integer,
			last_success_at integer,
			last_error_at integer,
			error_code text,
			error text,
			capabilities text,
			updated_at integer NOT NULL
		);
		CREATE UNIQUE INDEX provider_status_global_component_unique
			ON provider_status(component_type, component_key)
			WHERE server_instance_id IS NULL;
		CREATE TABLE diagnostic_runs (
			id text PRIMARY KEY NOT NULL,
			server_instance_id text,
			job_id integer,
			status text DEFAULT 'running' NOT NULL,
			initiator text DEFAULT 'user' NOT NULL,
			summary text,
			started_at integer NOT NULL,
			completed_at integer
		);
		CREATE TABLE diagnostic_results (
			id integer PRIMARY KEY AUTOINCREMENT,
			run_id text NOT NULL REFERENCES diagnostic_runs(id) ON DELETE CASCADE,
			server_instance_id text,
			component_type text NOT NULL,
			component_key text NOT NULL,
			status text NOT NULL,
			credential_status text,
			latency_ms integer,
			last_success_at integer,
			capabilities text,
			path_checks text,
			error_code text,
			error text,
			checked_at integer NOT NULL
		);
	`);
	runNumber = 0;
});

afterEach(() => {
	client.close();
	for (const suffix of ['', '-shm', '-wal']) rmSync(`${databasePath}${suffix}`, { force: true });
});

function result(index: number): DiagnosticResultValue {
	const date = new Date(`2026-07-${String(index).padStart(2, '0')}T12:00:00.000Z`);
	return {
		serverInstanceId: null,
		componentType: 'tmdb',
		componentKey: 'tmdb',
		status: 'healthy',
		credentialStatus: 'valid',
		latencyMs: index,
		lastSuccessAt: date,
		capabilities: { configurationRead: true },
		pathChecks: null,
		errorCode: null,
		error: null,
		checkedAt: date
	};
}

describe('diagnostic history store', () => {
	it('keeps latest health and prunes component and run history to configured bounds', async () => {
		const store = createDiagnosticHistoryStore(database, {
			historyPerComponent: 2,
			runsPerScope: 2,
			generateId: () => `run-${++runNumber}`,
			clock: () => new Date(`2026-08-${String(runNumber || 1).padStart(2, '0')}T00:00:00Z`)
		});

		for (let index = 1; index <= 3; index++) {
			const run = await store.start(null);
			await store.record(run.id, result(index));
			await store.complete(run.id, 'completed', { healthy: 1 });
		}

		const latest = await store.latest(null);
		expect(latest).toHaveLength(1);
		expect(latest[0]).toMatchObject({
			componentKey: 'tmdb',
			status: 'healthy',
			latencyMs: 3,
			credentialStatus: 'valid'
		});
		const history = await store.history(10);
		expect(history.map(({ run }) => run.id)).toEqual(['run-3', 'run-2']);
		expect(history.flatMap(({ results }) => results)).toHaveLength(2);
	});
});
