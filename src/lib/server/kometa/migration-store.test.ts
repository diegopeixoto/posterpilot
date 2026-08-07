import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { eq } from 'drizzle-orm';

vi.mock('$lib/server/db', async () => {
	const { createClient } = await import('@libsql/client');
	const { drizzle } = await import('drizzle-orm/libsql');
	const schema = await import('$lib/server/db/schema');
	// Transactions may use another connection; shared memory keeps the same schema.
	const client = createClient({ url: 'file::memory:?cache=shared' });
	await client.execute(
		'CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)'
	);
	return { db: drizzle(client, { schema }), migrateDb: async () => undefined };
});
vi.mock('$lib/server/secrets/key', () => ({
	getEncryptionKey: () => Buffer.alloc(32, 7)
}));

import { db } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';
import { encryptSecret } from '$lib/server/secrets/crypto';
import { resolveKometaDestination } from './destination';
import { canonicalConfigPath } from './config-io';
import { kometaFileFingerprint } from './plan';
import {
	KOMETA_MIGRATION_PLAN_KIND,
	KOMETA_MIGRATION_PLAN_VERSION,
	kometaManualSnippetFingerprint,
	type KometaMigrationPlanPayload
} from './migration-plan';
import {
	createKometaMigrationJournal,
	updateKometaMigrationJournal,
	type KometaMigrationJournalV1
} from './migration-journal';
import {
	kometaLastAppliedSettingKey,
	parseKometaLastApplied,
	serializeKometaLastApplied,
	type KometaSnapshotScope
} from './last-applied';
import {
	completeKometaMigrationJournal,
	KometaMigrationStoreError,
	kometaMigrationJournalSettingKey,
	loadKometaMigrationJournal,
	prepareKometaMigrationJournal,
	rollbackKometaMigrationJournal,
	saveKometaMigrationJournal
} from './migration-store';

function pathBinding(path: string) {
	return {
		version: 1 as const,
		canonicalPath: path,
		anchorPath: dirname(path),
		anchorDevice: '1',
		anchorInode: '1'
	};
}

function payload(): KometaMigrationPlanPayload {
	const root = join(tmpdir(), 'migration-store');
	const empty = 'metadata: {}\n';
	const config = 'libraries: {}\n';
	const resolved = resolveKometaDestination({ type: 'movie', tmdbId: '1' });
	if (!resolved.ok) throw new Error('fixture destination');
	return {
		type: KOMETA_MIGRATION_PLAN_KIND,
		version: KOMETA_MIGRATION_PLAN_VERSION,
		migrationId: 'migration_store_123',
		serverInstanceId: 'server-a',
		serverName: 'Server A',
		outputDirectory: root,
		metadataPathPrefix: 'config',
		references: { movie: 'config/movies.yml', show: 'config/shows.yml' },
		pathBindings: {
			legacy: pathBinding(join(root, 'legacy.yml')),
			movie: pathBinding(join(root, 'movies.yml')),
			show: pathBinding(join(root, 'shows.yml')),
			config: pathBinding(join(root, 'config.yml'))
		},
		legacy: { path: join(root, 'legacy.yml'), sourceFingerprint: 'a'.repeat(64) },
		files: {
			movie: {
				path: join(root, 'movies.yml'),
				sourceFingerprint: 'b'.repeat(64),
				proposedFingerprint: kometaFileFingerprint(empty),
				proposedContent: empty
			},
			show: {
				path: join(root, 'shows.yml'),
				sourceFingerprint: 'c'.repeat(64),
				proposedFingerprint: kometaFileFingerprint(empty),
				proposedContent: empty
			}
		},
		config: {
			activation: 'managed',
			path: join(root, 'config.yml'),
			mode: 'merge',
			sourceFingerprint: 'd'.repeat(64),
			proposedFingerprint: kometaFileFingerprint(config),
			proposedContent: config
		},
		evidenceFingerprint: 'e'.repeat(64),
		previousSnapshot: null,
		nextSnapshot: {
			metadataPathPrefix: 'config',
			libraries: {},
			managedSettingKeys: []
		},
		manualSnippet: null,
		manualSnippetFingerprint: null,
		display: {
			classified: [
				{
					legacyKey: '1',
					entryFingerprint: 'f'.repeat(64),
					slots: ['poster:null:null'],
					destination: resolved.destination,
					evidence: 'mapping'
				}
			],
			ambiguous: [],
			files: {
				movie: {
					filename: 'movies.yml',
					physicalPath: join(root, 'movies.yml'),
					configReference: 'config/movies.yml',
					sourceFingerprint: 'b'.repeat(64),
					proposedFingerprint: kometaFileFingerprint(empty),
					added: 1,
					unchanged: 0,
					changes: []
				},
				show: {
					filename: 'shows.yml',
					physicalPath: join(root, 'shows.yml'),
					configReference: 'config/shows.yml',
					sourceFingerprint: 'c'.repeat(64),
					proposedFingerprint: kometaFileFingerprint(empty),
					added: 0,
					unchanged: 0,
					changes: []
				}
			},
			libraries: [],
			diffTruncated: false
		}
	};
}

function scope(value: KometaMigrationPlanPayload = payload()): KometaSnapshotScope {
	return {
		serverInstanceId: value.serverInstanceId,
		configPath: value.config.path === null ? null : canonicalConfigPath(value.config.path),
		outputDirectory: canonicalConfigPath(value.outputDirectory),
		metadataPathPrefix: value.metadataPathPrefix
	};
}

function managedReady(prepared: KometaMigrationJournalV1): KometaMigrationJournalV1 {
	return updateKometaMigrationJournal(
		prepared,
		{
			status: 'config_written',
			checkpoints: {
				movieVerified: true,
				showVerified: true,
				configVerified: true,
				baselinePersisted: false
			},
			backups: {
				...prepared.backups,
				config: { name: 'config.yml.migration.backup', fingerprint: '9'.repeat(64) }
			},
			activationEvidence: {
				type: 'verified_config',
				at: '2026-08-07T12:00:30.000Z'
			}
		},
		new Date('2026-08-07T12:00:30.000Z')
	);
}

function completedFrom(ready: KometaMigrationJournalV1): KometaMigrationJournalV1 {
	return updateKometaMigrationJournal(
		ready,
		{
			status: 'completed',
			checkpoints: { ...ready.checkpoints, baselinePersisted: true },
			completedAt: '2026-08-07T12:01:00.000Z',
			lastFailure: null
		},
		new Date('2026-08-07T12:01:00.000Z')
	);
}

function rollbackPreparedFrom(completed: KometaMigrationJournalV1): KometaMigrationJournalV1 {
	return updateKometaMigrationJournal(
		completed,
		{ status: 'rollback_prepared', lastFailure: null },
		new Date('2026-08-07T12:01:30.000Z')
	);
}

function rolledBackFrom(rollbackPrepared: KometaMigrationJournalV1): KometaMigrationJournalV1 {
	return updateKometaMigrationJournal(
		rollbackPrepared,
		{
			status: 'rolled_back',
			rolledBackAt: '2026-08-07T12:02:00.000Z',
			lastFailure: null
		},
		new Date('2026-08-07T12:02:00.000Z')
	);
}

function manualPayload(): KometaMigrationPlanPayload {
	const value = payload();
	const snippet = 'libraries:\n  Movies:\n    metadata_path:\n      - file: config/movies.yml\n';
	value.config = {
		activation: 'manual',
		path: value.config.path,
		mode: value.config.mode,
		sourceFingerprint: value.config.sourceFingerprint,
		proposedFingerprint: null,
		proposedContent: null
	};
	value.manualSnippet = snippet;
	value.manualSnippetFingerprint = kometaManualSnippetFingerprint(snippet);
	return value;
}

function manualReady(prepared: KometaMigrationJournalV1): KometaMigrationJournalV1 {
	return updateKometaMigrationJournal(
		prepared,
		{
			status: 'awaiting_manual_wiring',
			checkpoints: {
				movieVerified: true,
				showVerified: true,
				configVerified: false,
				baselinePersisted: false
			}
		},
		new Date('2026-08-07T12:00:30.000Z')
	);
}

function manuallyCompletedFrom(ready: KometaMigrationJournalV1): KometaMigrationJournalV1 {
	return updateKometaMigrationJournal(
		ready,
		{
			status: 'completed',
			checkpoints: { ...ready.checkpoints, baselinePersisted: true },
			activationEvidence: {
				type: 'user_acknowledged',
				at: '2026-08-07T12:01:00.000Z'
			},
			completedAt: '2026-08-07T12:01:00.000Z'
		},
		new Date('2026-08-07T12:01:00.000Z')
	);
}

async function forceStoredJournal(journal: KometaMigrationJournalV1): Promise<void> {
	const value = encryptSecret(JSON.stringify(journal), Buffer.alloc(32, 7));
	await db
		.insert(settings)
		.values({
			key: kometaMigrationJournalSettingKey(journal.payload.serverInstanceId),
			value
		})
		.onConflictDoUpdate({ target: settings.key, set: { value } });
}

beforeEach(async () => {
	await db.delete(settings);
});

describe('Kometa migration journal store', () => {
	it('authenticates encrypted durable journal payloads', async () => {
		const journal = createKometaMigrationJournal({
			planId: 'plan-1',
			planDigest: '1'.repeat(64),
			payload: payload(),
			now: new Date('2026-08-07T12:00:00.000Z')
		});
		await prepareKometaMigrationJournal(journal, null);
		const [row] = await db
			.select({ value: settings.value })
			.from(settings)
			.where(eq(settings.key, kometaMigrationJournalSettingKey('server-a')));
		expect(row.value).toMatch(/^enc:v1:/);
		expect(row.value).not.toContain('metadata:');
		expect(await loadKometaMigrationJournal('server-a')).toEqual(journal);

		await db
			.update(settings)
			.set({ value: `${row.value.slice(0, -1)}${row.value.endsWith('A') ? 'B' : 'A'}` })
			.where(eq(settings.key, kometaMigrationJournalSettingKey('server-a')));
		await expect(loadKometaMigrationJournal('server-a')).rejects.toThrow(/authenticated/);
	});

	it('persists the completed baseline and restores a null pre-migration snapshot on rollback', async () => {
		const prepared = createKometaMigrationJournal({
			planId: 'plan-1',
			planDigest: '1'.repeat(64),
			payload: payload(),
			now: new Date('2026-08-07T12:00:00.000Z')
		});
		const ready = managedReady(prepared);
		const completed = completedFrom(ready);
		await prepareKometaMigrationJournal(prepared, null);
		await saveKometaMigrationJournal(ready, prepared);
		await completeKometaMigrationJournal(completed, completed.payload.nextSnapshot, ready);
		await completeKometaMigrationJournal(completed, completed.payload.nextSnapshot, ready);
		expect(await loadKometaMigrationJournal('server-a')).toEqual(completed);
		const baselineKey = kometaLastAppliedSettingKey(scope(completed.payload));
		const [baseline] = await db.select().from(settings).where(eq(settings.key, baselineKey));
		expect(parseKometaLastApplied(baseline.value, scope(completed.payload))).toEqual(
			completed.payload.nextSnapshot
		);

		const rollbackPrepared = rollbackPreparedFrom(completed);
		await saveKometaMigrationJournal(rollbackPrepared, completed);
		const rolledBack = rolledBackFrom(rollbackPrepared);
		expect(
			parseKometaLastApplied(
				(await db.select().from(settings).where(eq(settings.key, baselineKey)))[0].value,
				scope(completed.payload)
			)
		).toEqual(completed.payload.nextSnapshot);
		await expect(rollbackKometaMigrationJournal(rolledBack, null, completed)).rejects.toThrow(
			/predecessor/
		);
		const externallyChanged = {
			metadataPathPrefix: 'config',
			libraries: { External: { metadataReference: 'config/external.yml', defaults: [] } },
			managedSettingKeys: []
		};
		await db
			.update(settings)
			.set({
				value: serializeKometaLastApplied(scope(completed.payload), externallyChanged)
			})
			.where(eq(settings.key, baselineKey));
		await expect(
			rollbackKometaMigrationJournal(rolledBack, null, rollbackPrepared)
		).rejects.toMatchObject({
			code: 'baseline_changed'
		});
		expect((await loadKometaMigrationJournal('server-a'))?.status).toBe('rollback_prepared');
		await db
			.update(settings)
			.set({
				value: serializeKometaLastApplied(scope(completed.payload), completed.payload.nextSnapshot)
			})
			.where(eq(settings.key, baselineKey));
		await rollbackKometaMigrationJournal(rolledBack, null, rollbackPrepared);
		await rollbackKometaMigrationJournal(rolledBack, null, rollbackPrepared);
		expect(await loadKometaMigrationJournal('server-a')).toEqual(rolledBack);
		expect((await db.select().from(settings).where(eq(settings.key, baselineKey))).length).toBe(0);
	});

	it('installs prepared only when the exact terminal journal is unchanged', async () => {
		const first = createKometaMigrationJournal({
			planId: 'plan-1',
			planDigest: '1'.repeat(64),
			payload: payload(),
			now: new Date('2026-08-07T12:00:00.000Z')
		});
		await prepareKometaMigrationJournal(first, null);
		expect(await loadKometaMigrationJournal('server-a')).toEqual(first);

		const competingPayload = payload();
		competingPayload.migrationId = 'migration_store_competing';
		const competing = createKometaMigrationJournal({
			planId: 'plan-2',
			planDigest: '2'.repeat(64),
			payload: competingPayload,
			now: new Date('2026-08-07T12:00:01.000Z')
		});
		await expect(prepareKometaMigrationJournal(competing, null)).rejects.toMatchObject({
			code: 'journal_changed'
		});
		await expect(prepareKometaMigrationJournal(competing, first)).rejects.toThrow(/terminal/);
		expect(await loadKometaMigrationJournal('server-a')).toEqual(first);
	});

	it('does not replace a same-identity terminal journal when its exact state changed', async () => {
		const first = createKometaMigrationJournal({
			planId: 'plan-1',
			planDigest: '1'.repeat(64),
			payload: payload(),
			now: new Date('2026-08-07T12:00:00.000Z')
		});
		const ready = managedReady(first);
		const terminal = completedFrom(ready);
		await prepareKometaMigrationJournal(first, null);
		await saveKometaMigrationJournal(ready, first);
		await completeKometaMigrationJournal(terminal, terminal.payload.nextSnapshot, ready);

		const staleExpected = structuredClone(terminal);
		staleExpected.payload.serverName = 'Stale server name';
		const next = createKometaMigrationJournal({
			planId: terminal.planId,
			planDigest: terminal.planDigest,
			payload: payload(),
			now: new Date('2026-08-07T12:03:00.000Z')
		});
		await expect(prepareKometaMigrationJournal(next, staleExpected)).rejects.toMatchObject({
			code: 'journal_changed'
		});
		expect(await loadKometaMigrationJournal('server-a')).toEqual(terminal);

		await prepareKometaMigrationJournal(next, terminal);
		expect(await loadKometaMigrationJournal('server-a')).toEqual(next);
	});

	it('compare-and-sets a fresh prepared journal over only an exact effectless failure', async () => {
		const first = createKometaMigrationJournal({
			planId: 'plan-effectless',
			planDigest: '7'.repeat(64),
			payload: payload(),
			now: new Date('2026-08-07T12:00:00.000Z')
		});
		const failed = updateKometaMigrationJournal(
			first,
			{
				status: 'recovery_required',
				lastFailure: {
					phase: 'prepare',
					code: 'migration_source_changed',
					at: '2026-08-07T12:00:01.000Z'
				}
			},
			new Date('2026-08-07T12:00:01.000Z')
		);
		await prepareKometaMigrationJournal(first, null);
		await saveKometaMigrationJournal(failed, first);

		const nextPayload = payload();
		nextPayload.migrationId = 'migration_effectless_replacement';
		const next = createKometaMigrationJournal({
			planId: 'plan-fresh',
			planDigest: '8'.repeat(64),
			payload: nextPayload,
			now: new Date('2026-08-07T12:00:02.000Z')
		});
		const stale = structuredClone(failed);
		stale.updatedAt = '2026-08-07T12:00:00.000Z';
		await expect(prepareKometaMigrationJournal(next, stale)).rejects.toMatchObject({
			code: 'journal_changed'
		});
		await prepareKometaMigrationJournal(next, failed);
		expect(await loadKometaMigrationJournal('server-a')).toEqual(next);
	});

	it('rejects replacement when a failed journal retained possible write evidence', async () => {
		const first = createKometaMigrationJournal({
			planId: 'plan-with-backup',
			planDigest: '7'.repeat(64),
			payload: payload(),
			now: new Date('2026-08-07T12:00:00.000Z')
		});
		const failed = updateKometaMigrationJournal(
			first,
			{
				status: 'failed',
				backups: {
					...first.backups,
					movie: { name: 'movie.migration.backup', fingerprint: '9'.repeat(64) }
				},
				lastFailure: {
					phase: 'movie_write',
					code: 'migration_write_failed',
					at: '2026-08-07T12:00:01.000Z'
				}
			},
			new Date('2026-08-07T12:00:01.000Z')
		);
		await prepareKometaMigrationJournal(first, null);
		await saveKometaMigrationJournal(failed, first);

		const nextPayload = payload();
		nextPayload.migrationId = 'migration_unsafe_replacement';
		const next = createKometaMigrationJournal({
			planId: 'plan-fresh',
			planDigest: '8'.repeat(64),
			payload: nextPayload,
			now: new Date('2026-08-07T12:00:02.000Z')
		});
		await expect(prepareKometaMigrationJournal(next, failed)).rejects.toThrow(/effectless/);
		expect(await loadKometaMigrationJournal('server-a')).toEqual(failed);
	});

	it('compare-and-sets every intermediate checkpoint without stale regression', async () => {
		const prepared = createKometaMigrationJournal({
			planId: 'plan-cas',
			planDigest: '4'.repeat(64),
			payload: payload(),
			now: new Date('2026-08-07T12:00:00.000Z')
		});
		const writing = updateKometaMigrationJournal(
			prepared,
			{ status: 'writing_splits' },
			new Date('2026-08-07T12:00:10.000Z')
		);
		await expect(saveKometaMigrationJournal(writing, prepared)).rejects.toMatchObject({
			code: 'journal_changed'
		});

		await prepareKometaMigrationJournal(prepared, null);
		await saveKometaMigrationJournal(writing, prepared);
		await saveKometaMigrationJournal(writing, prepared);

		const competing = updateKometaMigrationJournal(
			prepared,
			{
				status: 'failed',
				lastFailure: {
					phase: 'prepare',
					code: 'competing_process',
					at: '2026-08-07T12:00:11.000Z'
				}
			},
			new Date('2026-08-07T12:00:11.000Z')
		);
		await expect(saveKometaMigrationJournal(competing, prepared)).rejects.toMatchObject({
			code: 'journal_changed'
		});
		expect(await loadKometaMigrationJournal('server-a')).toEqual(writing);

		const advanced = updateKometaMigrationJournal(
			writing,
			{
				checkpoints: { ...writing.checkpoints, movieVerified: true }
			},
			new Date('2026-08-07T12:00:20.000Z')
		);
		await saveKometaMigrationJournal(advanced, writing);
		const delayed = updateKometaMigrationJournal(
			writing,
			{
				status: 'failed',
				lastFailure: {
					phase: 'movie_verify',
					code: 'delayed_process',
					at: '2026-08-07T12:00:21.000Z'
				}
			},
			new Date('2026-08-07T12:00:21.000Z')
		);
		await expect(saveKometaMigrationJournal(delayed, writing)).rejects.toMatchObject({
			code: 'journal_changed'
		});
		expect(await loadKometaMigrationJournal('server-a')).toEqual(advanced);

		const changedPlan = structuredClone(advanced);
		changedPlan.payload.serverName = 'Changed frozen payload';
		await expect(saveKometaMigrationJournal(changedPlan, advanced)).rejects.toThrow(/frozen plan/);
	});

	it('finalizes only the exact activation checkpoint for the frozen payload and backups', async () => {
		const mutations: Array<{
			name: string;
			apply(current: KometaMigrationJournalV1): void;
		}> = [
			{
				name: 'payload',
				apply: (current) => {
					current.payload.serverName = 'Concurrent server name';
				}
			},
			{
				name: 'backups',
				apply: (current) => {
					current.backups.config = {
						name: 'concurrent-config.backup',
						fingerprint: '8'.repeat(64)
					};
				}
			},
			{
				name: 'status',
				apply: (current) => {
					current.status = 'failed';
					current.lastFailure = {
						phase: 'baseline',
						code: 'concurrent_failure',
						at: '2026-08-07T12:00:45.000Z'
					};
				}
			}
		];

		for (const mutation of mutations) {
			await db.delete(settings);
			const prepared = createKometaMigrationJournal({
				planId: 'plan-1',
				planDigest: '1'.repeat(64),
				payload: payload(),
				now: new Date('2026-08-07T12:00:00.000Z')
			});
			const ready = managedReady(prepared);
			const completed = completedFrom(ready);
			const concurrent = structuredClone(ready);
			mutation.apply(concurrent);
			await forceStoredJournal(concurrent);

			await expect(
				completeKometaMigrationJournal(completed, completed.payload.nextSnapshot, ready),
				mutation.name
			).rejects.toMatchObject({ code: 'journal_changed' });
			expect(
				await db
					.select()
					.from(settings)
					.where(eq(settings.key, kometaLastAppliedSettingKey(scope(completed.payload))))
			).toHaveLength(0);
		}
	});

	it('finalizes manual activation only from awaiting wiring with no config checkpoint', async () => {
		const prepared = createKometaMigrationJournal({
			planId: 'plan-manual',
			planDigest: '2'.repeat(64),
			payload: manualPayload(),
			now: new Date('2026-08-07T12:00:00.000Z')
		});
		const ready = manualReady(prepared);
		const completed = manuallyCompletedFrom(ready);
		await prepareKometaMigrationJournal(prepared, null);
		await saveKometaMigrationJournal(ready, prepared);
		await completeKometaMigrationJournal(completed, completed.payload.nextSnapshot, ready);
		expect(await loadKometaMigrationJournal('server-a')).toEqual(completed);

		await db.delete(settings);
		const wrongStatus = updateKometaMigrationJournal(
			ready,
			{ status: 'splits_verified' },
			new Date('2026-08-07T12:00:45.000Z')
		);
		await prepareKometaMigrationJournal(prepared, null);
		await saveKometaMigrationJournal(wrongStatus, prepared);
		await expect(
			completeKometaMigrationJournal(completed, completed.payload.nextSnapshot, ready)
		).rejects.toMatchObject({ code: 'journal_changed' });

		const invalidCompleted = updateKometaMigrationJournal(
			completed,
			{
				checkpoints: { ...completed.checkpoints, configVerified: true }
			},
			new Date('2026-08-07T12:01:01.000Z')
		);
		await expect(
			completeKometaMigrationJournal(invalidCompleted, invalidCompleted.payload.nextSnapshot, ready)
		).rejects.toThrow(/correctly activated/);
	});

	it('rolls back only the exact completed journal with its frozen previous snapshot', async () => {
		const mutations: Array<{
			name: string;
			apply(current: KometaMigrationJournalV1): void;
		}> = [
			{
				name: 'payload',
				apply: (current) => {
					current.payload.serverName = 'Concurrent server name';
				}
			},
			{
				name: 'backups',
				apply: (current) => {
					current.backups.config = {
						name: 'concurrent-config.backup',
						fingerprint: '8'.repeat(64)
					};
				}
			},
			{
				name: 'status',
				apply: (current) => {
					current.status = 'recovery_required';
				}
			}
		];

		for (const mutation of mutations) {
			await db.delete(settings);
			const prepared = createKometaMigrationJournal({
				planId: 'plan-1',
				planDigest: '1'.repeat(64),
				payload: payload(),
				now: new Date('2026-08-07T12:00:00.000Z')
			});
			const ready = managedReady(prepared);
			const completed = completedFrom(ready);
			await prepareKometaMigrationJournal(prepared, null);
			await saveKometaMigrationJournal(ready, prepared);
			await completeKometaMigrationJournal(completed, completed.payload.nextSnapshot, ready);
			const rollbackPrepared = rollbackPreparedFrom(completed);
			await saveKometaMigrationJournal(rollbackPrepared, completed);
			const concurrent = structuredClone(rollbackPrepared);
			mutation.apply(concurrent);
			await forceStoredJournal(concurrent);
			const rolledBack = rolledBackFrom(rollbackPrepared);

			await expect(
				rollbackKometaMigrationJournal(rolledBack, null, rollbackPrepared),
				mutation.name
			).rejects.toMatchObject({ code: 'journal_changed' });
			const baselineKey = kometaLastAppliedSettingKey(scope(completed.payload));
			const [baseline] = await db.select().from(settings).where(eq(settings.key, baselineKey));
			expect(parseKometaLastApplied(baseline.value, scope(completed.payload))).toEqual(
				completed.payload.nextSnapshot
			);
		}

		await db.delete(settings);
		const value = payload();
		value.previousSnapshot = {
			metadataPathPrefix: 'config',
			libraries: { Movies: { metadataReference: 'config/old.yml', defaults: [] } },
			managedSettingKeys: []
		};
		const prepared = createKometaMigrationJournal({
			planId: 'plan-previous',
			planDigest: '3'.repeat(64),
			payload: value,
			now: new Date('2026-08-07T12:00:00.000Z')
		});
		const ready = managedReady(prepared);
		const completed = completedFrom(ready);
		const baselineKey = kometaLastAppliedSettingKey(scope(value));
		await db.insert(settings).values({
			key: baselineKey,
			value: serializeKometaLastApplied(scope(value), value.previousSnapshot)
		});
		await prepareKometaMigrationJournal(prepared, null);
		await saveKometaMigrationJournal(ready, prepared);
		await completeKometaMigrationJournal(completed, completed.payload.nextSnapshot, ready);
		const rollbackPrepared = rollbackPreparedFrom(completed);
		await saveKometaMigrationJournal(rollbackPrepared, completed);
		await expect(
			rollbackKometaMigrationJournal(rolledBackFrom(rollbackPrepared), null, rollbackPrepared)
		).rejects.toThrow(/exact managed/);
		expect((await loadKometaMigrationJournal('server-a'))?.status).toBe('rollback_prepared');
	});

	it('does not complete or roll back when the scoped ownership baseline changed', async () => {
		const value = payload();
		value.previousSnapshot = {
			metadataPathPrefix: 'config',
			libraries: { Movies: { metadataReference: 'config/old.yml', defaults: [] } },
			managedSettingKeys: []
		};
		const prepared = createKometaMigrationJournal({
			planId: 'plan-1',
			planDigest: '1'.repeat(64),
			payload: value,
			now: new Date('2026-08-07T12:00:00.000Z')
		});
		const ready = managedReady(prepared);
		await prepareKometaMigrationJournal(prepared, null);
		await saveKometaMigrationJournal(ready, prepared);
		const scopedKey = kometaLastAppliedSettingKey(scope(value));
		const external = {
			metadataPathPrefix: 'config',
			libraries: { Other: { metadataReference: 'config/external.yml', defaults: [] } },
			managedSettingKeys: []
		};
		await db.insert(settings).values({
			key: scopedKey,
			value: serializeKometaLastApplied(scope(value), external)
		});
		const completed = completedFrom(ready);
		await expect(
			completeKometaMigrationJournal(completed, completed.payload.nextSnapshot, ready)
		).rejects.toBeInstanceOf(KometaMigrationStoreError);
		expect(
			parseKometaLastApplied(
				(await db.select().from(settings).where(eq(settings.key, scopedKey)))[0].value,
				scope(value)
			)
		).toEqual(external);
		expect((await loadKometaMigrationJournal('server-a'))?.status).toBe('config_written');
	});
});
