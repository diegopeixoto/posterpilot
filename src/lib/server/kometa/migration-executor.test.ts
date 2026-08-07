import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveKometaDestination } from './destination';
import { kometaFileFingerprint } from './plan';
import {
	KOMETA_MIGRATION_PLAN_KIND,
	KOMETA_MIGRATION_PLAN_VERSION,
	kometaMigrationBaselineFingerprint,
	kometaManualSnippetFingerprint,
	type KometaMigrationPlanPayload
} from './migration-plan';
import { createKometaMigrationJournal, type KometaMigrationJournalV1 } from './migration-journal';
import {
	acknowledgeManualKometaMigration,
	executeKometaMigration,
	rollbackKometaMigration,
	type KometaMigrationExecutorDependencies
} from './migration-executor';

const ROOT = '/var/lib/posterpilot-kometa-test';
const LEGACY = `${ROOT}/posterpilot.yml`;
const MOVIE = `${ROOT}/posterpilot-movies.yml`;
const SHOW = `${ROOT}/posterpilot-shows.yml`;
const CONFIG = `${ROOT}/config.yml`;
const LEGACY_RAW = 'metadata:\n  1:\n    url_poster: https://images.invalid/legacy.jpg\n';
const MOVIE_SOURCE = 'metadata: {}\n';
const MOVIE_PROPOSED = 'metadata:\n  1:\n    url_poster: https://images.invalid/movie.jpg\n';
const SHOW_SOURCE = 'metadata: {}\n';
const SHOW_PROPOSED = 'metadata:\n  2:\n    url_poster: https://images.invalid/show.jpg\n';
const CONFIG_SOURCE = `libraries:\n  Movies:\n    metadata_files:\n      - file: config/posterpilot.yml\n`;
const CONFIG_PROPOSED = `libraries:\n  Movies:\n    metadata_files:\n      - file: config/posterpilot-movies.yml\n`;

function pathBinding(path: string) {
	return {
		version: 1 as const,
		canonicalPath: path,
		anchorPath: dirname(path),
		anchorDevice: '1',
		anchorInode: '1'
	};
}

function payload(activation: 'managed' | 'manual' = 'managed'): KometaMigrationPlanPayload {
	const resolved = resolveKometaDestination({ type: 'movie', tmdbId: '1' });
	if (!resolved.ok) throw new Error('fixture destination');
	const snippet = `libraries:\n  Movies:\n    metadata_files:\n      - file: config/posterpilot-movies.yml\n`;
	return {
		type: KOMETA_MIGRATION_PLAN_KIND,
		version: KOMETA_MIGRATION_PLAN_VERSION,
		migrationId: 'migration_executor_123',
		serverInstanceId: 'server-a',
		serverName: 'Server A',
		outputDirectory: ROOT,
		metadataPathPrefix: 'config',
		references: {
			movie: 'config/posterpilot-movies.yml',
			show: 'config/posterpilot-shows.yml'
		},
		pathBindings: {
			legacy: pathBinding(LEGACY),
			movie: pathBinding(MOVIE),
			show: pathBinding(SHOW),
			config: pathBinding(CONFIG)
		},
		legacy: { path: LEGACY, sourceFingerprint: kometaFileFingerprint(LEGACY_RAW) },
		files: {
			movie: {
				path: MOVIE,
				sourceFingerprint: kometaFileFingerprint(MOVIE_SOURCE),
				proposedFingerprint: kometaFileFingerprint(MOVIE_PROPOSED),
				proposedContent: MOVIE_PROPOSED
			},
			show: {
				path: SHOW,
				sourceFingerprint: kometaFileFingerprint(SHOW_SOURCE),
				proposedFingerprint: kometaFileFingerprint(SHOW_PROPOSED),
				proposedContent: SHOW_PROPOSED
			}
		},
		config:
			activation === 'managed'
				? {
						activation,
						path: CONFIG,
						mode: 'merge',
						sourceFingerprint: kometaFileFingerprint(CONFIG_SOURCE),
						proposedFingerprint: kometaFileFingerprint(CONFIG_PROPOSED),
						proposedContent: CONFIG_PROPOSED
					}
				: {
						activation,
						path: CONFIG,
						mode: 'merge',
						sourceFingerprint: kometaFileFingerprint(CONFIG_SOURCE),
						proposedFingerprint: null,
						proposedContent: null
					},
		evidenceFingerprint: 'e'.repeat(64),
		previousSnapshot: {
			metadataPath: 'config/posterpilot.yml',
			libraries: { Movies: { metadata: true, defaults: [] } },
			managedSettingKeys: []
		},
		previousSnapshotFingerprint: kometaMigrationBaselineFingerprint({
			metadataPath: 'config/posterpilot.yml',
			libraries: { Movies: { metadata: true, defaults: [] } },
			managedSettingKeys: []
		}),
		nextSnapshot: {
			metadataPathPrefix: 'config',
			libraries: {
				Movies: { metadataReference: 'config/posterpilot-movies.yml', defaults: [] }
			},
			managedSettingKeys: []
		},
		manualSnippet: activation === 'manual' ? snippet : null,
		manualSnippetFingerprint:
			activation === 'manual' ? kometaManualSnippetFingerprint(snippet) : null,
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
					filename: 'posterpilot-movies.yml',
					physicalPath: MOVIE,
					configReference: 'config/posterpilot-movies.yml',
					sourceFingerprint: kometaFileFingerprint(MOVIE_SOURCE),
					proposedFingerprint: kometaFileFingerprint(MOVIE_PROPOSED),
					added: 1,
					unchanged: 0,
					changes: []
				},
				show: {
					filename: 'posterpilot-shows.yml',
					physicalPath: SHOW,
					configReference: 'config/posterpilot-shows.yml',
					sourceFingerprint: kometaFileFingerprint(SHOW_SOURCE),
					proposedFingerprint: kometaFileFingerprint(SHOW_PROPOSED),
					added: 1,
					unchanged: 0,
					changes: []
				}
			},
			libraries: [],
			diffTruncated: false
		}
	};
}

function journal(activation: 'managed' | 'manual' = 'managed') {
	return createKometaMigrationJournal({
		planId: 'plan-1',
		planDigest: '1'.repeat(64),
		payload: payload(activation),
		now: new Date('2026-08-07T12:00:00.000Z')
	});
}

function harness(activation: 'managed' | 'manual' = 'managed') {
	const files = new Map<string, string>([
		[LEGACY, LEGACY_RAW],
		[MOVIE, MOVIE_SOURCE],
		[SHOW, SHOW_SOURCE],
		[CONFIG, CONFIG_SOURCE]
	]);
	const backups = new Map<string, string>();
	const protectedBackupCreations: string[] = [];
	const writes: string[] = [];
	const writeAttempts: { path: string; expectedSource: string | null }[] = [];
	const saved: KometaMigrationJournalV1[] = [];
	const completed: KometaMigrationJournalV1[] = [];
	const rolledBack: KometaMigrationJournalV1[] = [];
	const evidenceChecks: (string | null)[] = [];
	let failProtectedBackup: string | null = null;
	let failWrite: string | null = null;
	let corruptAfterWrite: string | null = null;
	let failComplete = false;
	let failRollback = false;
	let failDistinctPathCheck = false;
	let evidenceState: 'current' | 'changed' | 'unavailable' = 'current';
	let completionEvidenceState: 'current' | 'changed' | 'unavailable' = 'current';
	let durableJournal: KometaMigrationJournalV1 | null = null;
	let onSaveJournal: ((value: KometaMigrationJournalV1) => void | Promise<void>) | null = null;
	let onReadProtectedBackup: ((path: string, name: string) => void) | null = null;
	let onAssertEvidence: (() => void | Promise<void>) | null = null;
	const deps: KometaMigrationExecutorDependencies = {
		read: (path) => files.get(path) ?? null,
		assertEvidenceCurrent: async () => {
			evidenceChecks.push(files.get(CONFIG) ?? null);
			await onAssertEvidence?.();
			if (evidenceState === 'unavailable') throw new Error('evidence store unavailable');
			return evidenceState;
		},
		write: (path, content, _stamp, expectedSource) => {
			writeAttempts.push({ path, expectedSource });
			const current = files.get(path) ?? null;
			if (current === content) return;
			if (current !== expectedSource) throw new Error('source changed before writer read');
			writes.push(path);
			if (failWrite === path) {
				failWrite = null;
				throw new Error('private disk error');
			}
			files.set(path, content);
			if (corruptAfterWrite === path) {
				corruptAfterWrite = null;
				files.set(path, `${content}\n# truncated write`);
			}
		},
		createProtectedBackup: (path, migrationId, expected) => {
			if (failProtectedBackup === path) {
				failProtectedBackup = null;
				throw new Error('private backup error');
			}
			expect(files.get(path)).toBe(expected);
			protectedBackupCreations.push(path);
			const name = `protected-${migrationId}-${path.split('/').at(-1)}`;
			backups.set(`${path}:${name}`, expected);
			return {
				name,
				checksum: createHash('sha256').update(expected).digest('hex')
			};
		},
		readProtectedBackup: (path, name, checksum) => {
			const content = backups.get(`${path}:${name}`);
			if (content === undefined) throw new Error('missing');
			if (createHash('sha256').update(content).digest('hex') !== checksum) {
				throw new Error('mismatch');
			}
			onReadProtectedBackup?.(path, name);
			return content;
		},
		assertDistinctPaths: () => {
			if (failDistinctPathCheck) throw new Error('physical target alias');
		},
		saveJournal: async (value, expected) => {
			durableJournal ??= structuredClone(expected);
			expect(durableJournal).toEqual(expected);
			durableJournal = structuredClone(value);
			saved.push(structuredClone(value));
			await onSaveJournal?.(value);
		},
		completeJournal: async (value, _snapshot, expected) => {
			durableJournal ??= structuredClone(expected);
			expect(durableJournal).toEqual(expected);
			if (failComplete) {
				failComplete = false;
				throw new Error('private database error');
			}
			if (completionEvidenceState !== 'current') return completionEvidenceState;
			durableJournal = structuredClone(value);
			completed.push(structuredClone(value));
			return 'current';
		},
		rollbackJournal: async (value, _snapshot, expected) => {
			durableJournal ??= structuredClone(expected);
			expect(durableJournal).toEqual(expected);
			if (failRollback) {
				failRollback = false;
				throw new Error('private rollback database error');
			}
			durableJournal = structuredClone(value);
			rolledBack.push(structuredClone(value));
		},
		now: () => new Date('2026-08-07T12:01:00.000Z')
	};
	return {
		activation,
		files,
		backups,
		protectedBackupCreations,
		writes,
		writeAttempts,
		saved,
		completed,
		rolledBack,
		evidenceChecks,
		deps,
		setFailProtectedBackup(path: string) {
			failProtectedBackup = path;
		},
		setFailWrite(path: string) {
			failWrite = path;
		},
		setCorruptAfterWrite(path: string) {
			corruptAfterWrite = path;
		},
		setFailComplete() {
			failComplete = true;
		},
		setFailRollback() {
			failRollback = true;
		},
		setFailDistinctPathCheck() {
			failDistinctPathCheck = true;
		},
		setEvidenceCurrent(current: boolean) {
			evidenceState = current ? 'current' : 'changed';
		},
		setEvidenceUnavailable() {
			evidenceState = 'unavailable';
		},
		setCompletionEvidenceState(state: 'current' | 'changed' | 'unavailable') {
			completionEvidenceState = state;
		},
		setOnAssertEvidence(callback: () => void | Promise<void>) {
			onAssertEvidence = callback;
		},
		setOnSaveJournal(callback: (value: KometaMigrationJournalV1) => void | Promise<void>) {
			onSaveJournal = callback;
		},
		setOnReadProtectedBackup(callback: (path: string, name: string) => void) {
			onReadProtectedBackup = callback;
		}
	};
}

const EXECUTION_FAILURE_TARGETS = [
	{
		name: 'movie',
		path: MOVIE,
		backupPhase: 'movie_backup',
		writePhase: 'movie_write',
		verifyPhase: 'movie_verify',
		writesBeforeBackupFailure: [],
		writesThroughTarget: [MOVIE],
		retryWrites: [MOVIE, SHOW, CONFIG],
		checkpoints: {
			movieVerified: false,
			showVerified: false,
			configVerified: false,
			baselinePersisted: false
		}
	},
	{
		name: 'show',
		path: SHOW,
		backupPhase: 'show_backup',
		writePhase: 'show_write',
		verifyPhase: 'show_verify',
		writesBeforeBackupFailure: [MOVIE],
		writesThroughTarget: [MOVIE, SHOW],
		retryWrites: [SHOW, CONFIG],
		checkpoints: {
			movieVerified: true,
			showVerified: false,
			configVerified: false,
			baselinePersisted: false
		}
	},
	{
		name: 'config',
		path: CONFIG,
		backupPhase: 'config_backup',
		writePhase: 'config_write',
		verifyPhase: 'config_verify',
		writesBeforeBackupFailure: [MOVIE, SHOW],
		writesThroughTarget: [MOVIE, SHOW, CONFIG],
		retryWrites: [CONFIG],
		checkpoints: {
			movieVerified: true,
			showVerified: true,
			configVerified: false,
			baselinePersisted: false
		}
	}
] as const;

describe('Kometa migration executor', () => {
	it('writes and verifies both split files before config, then commits the baseline', async () => {
		const h = harness();
		const result = await executeKometaMigration(h.deps, journal());

		expect(h.writes).toEqual([MOVIE, SHOW, CONFIG]);
		expect(h.writeAttempts).toEqual([
			{ path: MOVIE, expectedSource: MOVIE_SOURCE },
			{ path: SHOW, expectedSource: SHOW_SOURCE },
			{ path: CONFIG, expectedSource: CONFIG_SOURCE }
		]);
		expect(h.files.get(LEGACY)).toBe(LEGACY_RAW);
		expect(result.status).toBe('completed');
		expect(result.activationEvidence?.type).toBe('verified_config');
		expect(result.checkpoints).toEqual({
			movieVerified: true,
			showVerified: true,
			configVerified: true,
			baselinePersisted: true
		});
		expect(h.completed).toHaveLength(1);
		expect(h.evidenceChecks).toEqual([CONFIG_SOURCE, CONFIG_SOURCE, CONFIG_PROPOSED]);
	});

	it('revalidates authoritative evidence after the config backup await and before activation', async () => {
		const h = harness();
		let invalidated = false;
		h.setOnSaveJournal((value) => {
			if (!invalidated && value.backups.config !== null && !value.checkpoints.configVerified) {
				invalidated = true;
				h.setEvidenceCurrent(false);
			}
		});

		await expect(executeKometaMigration(h.deps, journal())).rejects.toMatchObject({
			code: 'migration_evidence_changed',
			phase: 'source_revalidate',
			recoveryRequired: true
		});
		expect(h.writes).toEqual([MOVIE, SHOW]);
		expect(h.files.get(CONFIG)).toBe(CONFIG_SOURCE);
		expect(h.completed).toHaveLength(0);
		expect(h.saved.at(-1)?.status).toBe('recovery_required');
	});

	it('fails closed but remains resumable when commit evidence is temporarily unavailable', async () => {
		const h = harness();
		let unavailable = false;
		h.setOnSaveJournal((value) => {
			if (!unavailable && value.backups.config !== null && !value.checkpoints.configVerified) {
				unavailable = true;
				h.setEvidenceUnavailable();
			}
		});

		await expect(executeKometaMigration(h.deps, journal())).rejects.toMatchObject({
			code: 'migration_evidence_unavailable',
			phase: 'source_revalidate',
			recoveryRequired: false
		});
		const failed = h.saved.at(-1)!;
		expect(failed.status).toBe('failed');
		expect(h.files.get(CONFIG)).toBe(CONFIG_SOURCE);
		expect(h.completed).toHaveLength(0);

		h.setEvidenceCurrent(true);
		h.writes.length = 0;
		const completed = await executeKometaMigration(h.deps, failed);
		expect(completed.status).toBe('completed');
		expect(h.writes).toEqual([CONFIG]);
	});

	it('revalidates evidence again after config_written and before committing the baseline', async () => {
		const h = harness();
		let checks = 0;
		h.setOnAssertEvidence(() => {
			checks += 1;
			if (checks === 3) h.setEvidenceCurrent(false);
		});

		await expect(executeKometaMigration(h.deps, journal())).rejects.toMatchObject({
			code: 'migration_evidence_changed',
			phase: 'final_verify',
			recoveryRequired: true
		});
		expect(h.writes).toEqual([MOVIE, SHOW, CONFIG]);
		expect(h.files.get(CONFIG)).toBe(CONFIG_PROPOSED);
		expect(h.completed).toHaveLength(0);
		expect(h.saved.at(-1)?.status).toBe('recovery_required');
	});

	it('does not commit a baseline when evidence changes inside the completion transaction', async () => {
		const h = harness();
		h.setCompletionEvidenceState('changed');

		await expect(executeKometaMigration(h.deps, journal())).rejects.toMatchObject({
			code: 'migration_evidence_changed',
			phase: 'final_verify',
			recoveryRequired: true
		});
		expect(h.completed).toHaveLength(0);
		expect(h.saved.at(-1)?.status).toBe('recovery_required');
	});

	it('keeps a transactional evidence outage resumable and classifiable as unavailable', async () => {
		const h = harness();
		h.setCompletionEvidenceState('unavailable');

		await expect(executeKometaMigration(h.deps, journal())).rejects.toMatchObject({
			code: 'migration_evidence_unavailable',
			phase: 'final_verify',
			recoveryRequired: false
		});
		expect(h.completed).toHaveLength(0);
		expect(h.saved.at(-1)?.status).toBe('failed');
	});

	describe.each(EXECUTION_FAILURE_TARGETS)('$name failure boundaries', (target) => {
		it('leaves config and legacy inactive when protected-backup creation fails, then resumes idempotently', async () => {
			const h = harness();
			h.setFailProtectedBackup(target.path);

			await expect(executeKometaMigration(h.deps, journal())).rejects.toMatchObject({
				code: 'migration_write_failed',
				phase: target.backupPhase,
				recoveryRequired: false
			});

			expect(h.writes).toEqual(target.writesBeforeBackupFailure);
			expect(h.writes).not.toContain(CONFIG);
			expect(h.writes).not.toContain(LEGACY);
			expect(h.files.get(CONFIG)).toBe(CONFIG_SOURCE);
			expect(h.files.get(LEGACY)).toBe(LEGACY_RAW);

			const failed = h.saved.at(-1)!;
			expect(failed).toMatchObject({
				status: 'failed',
				checkpoints: target.checkpoints,
				lastFailure: {
					phase: target.backupPhase,
					code: 'migration_write_failed'
				}
			});
			expect(failed.backups[target.name]).toBeNull();

			h.writes.length = 0;
			const completed = await executeKometaMigration(h.deps, failed);

			expect(h.writes).toEqual(target.retryWrites);
			expect(h.writes.at(-1)).toBe(CONFIG);
			expect(h.protectedBackupCreations).toEqual([MOVIE, SHOW, CONFIG]);
			expect(h.files.get(LEGACY)).toBe(LEGACY_RAW);
			expect(h.files.get(MOVIE)).toBe(MOVIE_PROPOSED);
			expect(h.files.get(SHOW)).toBe(SHOW_PROPOSED);
			expect(h.files.get(CONFIG)).toBe(CONFIG_PROPOSED);
			expect(completed.status).toBe('completed');
			expect(h.completed).toHaveLength(1);
		});

		it('keeps config last when the target write fails, then retries only unverified writes', async () => {
			const h = harness();
			h.setFailWrite(target.path);

			await expect(executeKometaMigration(h.deps, journal())).rejects.toMatchObject({
				code: 'migration_write_failed',
				phase: target.writePhase,
				recoveryRequired: false
			});

			expect(h.writes).toEqual(target.writesThroughTarget);
			expect(h.writes).not.toContain(LEGACY);
			expect(h.files.get(CONFIG)).toBe(CONFIG_SOURCE);
			expect(h.files.get(LEGACY)).toBe(LEGACY_RAW);

			const failed = h.saved.at(-1)!;
			expect(failed).toMatchObject({
				status: 'failed',
				checkpoints: target.checkpoints,
				lastFailure: {
					phase: target.writePhase,
					code: 'migration_write_failed'
				}
			});
			const protectedBackup = structuredClone(failed.backups[target.name]);
			expect(protectedBackup).not.toBeNull();

			h.writes.length = 0;
			const completed = await executeKometaMigration(h.deps, failed);

			expect(h.writes).toEqual(target.retryWrites);
			expect(h.writes.at(-1)).toBe(CONFIG);
			expect(completed.backups[target.name]).toEqual(protectedBackup);
			expect(h.protectedBackupCreations).toEqual([MOVIE, SHOW, CONFIG]);
			expect(h.files.get(LEGACY)).toBe(LEGACY_RAW);
			expect(h.files.get(MOVIE)).toBe(MOVIE_PROPOSED);
			expect(h.files.get(SHOW)).toBe(SHOW_PROPOSED);
			expect(h.files.get(CONFIG)).toBe(CONFIG_PROPOSED);
			expect(completed.status).toBe('completed');
			expect(h.completed).toHaveLength(1);
		});

		it('requires recovery when post-write verification observes divergent bytes', async () => {
			const h = harness();
			h.setCorruptAfterWrite(target.path);

			await expect(executeKometaMigration(h.deps, journal())).rejects.toMatchObject({
				code: 'migration_verify_failed',
				phase: target.verifyPhase,
				recoveryRequired: true
			});

			expect(h.writes).toEqual(target.writesThroughTarget);
			expect(h.writes).not.toContain(LEGACY);
			expect(h.protectedBackupCreations).toEqual(target.writesThroughTarget);
			expect(h.files.get(LEGACY)).toBe(LEGACY_RAW);
			expect(h.files.get(target.path)).not.toBe(
				target.name === 'movie'
					? MOVIE_PROPOSED
					: target.name === 'show'
						? SHOW_PROPOSED
						: CONFIG_PROPOSED
			);
			if (target.name !== 'config') expect(h.files.get(CONFIG)).toBe(CONFIG_SOURCE);

			const failed = h.saved.at(-1)!;
			expect(failed).toMatchObject({
				status: 'recovery_required',
				checkpoints: target.checkpoints,
				lastFailure: {
					phase: target.verifyPhase,
					code: 'migration_verify_failed'
				}
			});

			h.writes.length = 0;
			await expect(executeKometaMigration(h.deps, failed)).rejects.toMatchObject({
				code: 'migration_not_resumable',
				phase: 'prepare'
			});
			expect(h.writes).toEqual([]);
			expect(h.saved.at(-1)).toEqual(failed);
			expect(h.completed).toHaveLength(0);
		});
	});

	it('retains the protected config backup when baseline persistence fails after config write', async () => {
		const h = harness();
		h.setFailComplete();
		await expect(executeKometaMigration(h.deps, journal())).rejects.toMatchObject({
			code: 'migration_write_failed',
			phase: 'baseline'
		});
		const failed = h.saved.at(-1)!;
		expect(failed.status).toBe('failed');
		expect(failed.checkpoints.configVerified).toBe(true);
		expect(failed.backups.config).not.toBeNull();
		expect(h.files.get(CONFIG)).toBe(CONFIG_PROPOSED);

		const writesBeforeResume = [...h.writes];
		h.writeAttempts.length = 0;
		const completed = await executeKometaMigration(h.deps, failed);
		expect(completed.status).toBe('completed');
		expect(completed.backups.config).toEqual(failed.backups.config);
		expect(h.writes).toEqual(writesBeforeResume);
		expect(h.writeAttempts).toEqual([
			{ path: MOVIE, expectedSource: MOVIE_PROPOSED },
			{ path: SHOW, expectedSource: SHOW_PROPOSED },
			{ path: CONFIG, expectedSource: CONFIG_PROPOSED }
		]);
	});

	it('does not complete a resumed published config after authoritative evidence changes', async () => {
		const h = harness();
		h.setFailComplete();
		await expect(executeKometaMigration(h.deps, journal())).rejects.toMatchObject({
			code: 'migration_write_failed',
			phase: 'baseline'
		});
		const interrupted = h.saved.at(-1)!;
		expect(h.files.get(CONFIG)).toBe(CONFIG_PROPOSED);

		h.writes.length = 0;
		h.writeAttempts.length = 0;
		h.setEvidenceCurrent(false);
		await expect(executeKometaMigration(h.deps, interrupted)).rejects.toMatchObject({
			code: 'migration_evidence_changed',
			phase: 'source_revalidate',
			recoveryRequired: true
		});
		expect(h.writes).toEqual([]);
		expect(h.completed).toHaveLength(0);
	});

	it('enters recovery-required without overwriting a divergent target', async () => {
		const h = harness();
		h.files.set(MOVIE, 'metadata:\n  externally_changed: true\n');
		await expect(executeKometaMigration(h.deps, journal())).rejects.toMatchObject({
			code: 'migration_target_changed',
			recoveryRequired: true
		});
		expect(h.writes).toEqual([]);
		expect(h.saved.at(-1)?.status).toBe('recovery_required');
	});

	it('revalidates a split immediately after persisting its backup', async () => {
		const h = harness();
		const external = 'metadata:\n  external: true\n';
		let injected = false;
		h.setOnSaveJournal((value) => {
			if (!injected && value.backups.movie !== null && !value.checkpoints.movieVerified) {
				injected = true;
				h.files.set(MOVIE, external);
			}
		});

		await expect(executeKometaMigration(h.deps, journal())).rejects.toMatchObject({
			code: 'migration_target_changed',
			phase: 'movie_write',
			recoveryRequired: true
		});
		expect(h.writes).toEqual([]);
		expect(h.files.get(MOVIE)).toBe(external);
		expect(h.saved.at(-1)?.backups.movie).not.toBeNull();
		expect(h.saved.at(-1)?.status).toBe('recovery_required');
	});

	it('writes no backup or split when legacy changes during the initial journal await', async () => {
		const h = harness();
		const external = 'metadata:\n  external_legacy: true\n';
		let injected = false;
		h.setOnSaveJournal((value) => {
			if (!injected && value.status === 'writing_splits' && value.backups.movie === null) {
				injected = true;
				h.files.set(LEGACY, external);
			}
		});

		await expect(executeKometaMigration(h.deps, journal())).rejects.toMatchObject({
			code: 'migration_legacy_changed',
			phase: 'source_revalidate',
			recoveryRequired: true
		});
		expect(h.writes).toEqual([]);
		expect(h.backups).toEqual(new Map());
		expect(h.files.get(MOVIE)).toBe(MOVIE_SOURCE);
		expect(h.files.get(SHOW)).toBe(SHOW_SOURCE);
		expect(h.files.get(LEGACY)).toBe(external);
	});

	it('revalidates config immediately after persisting its backup', async () => {
		const h = harness();
		const external = 'libraries:\n  External: {}\n';
		let injected = false;
		h.setOnSaveJournal((value) => {
			if (!injected && value.backups.config !== null && !value.checkpoints.configVerified) {
				injected = true;
				h.files.set(CONFIG, external);
			}
		});

		await expect(executeKometaMigration(h.deps, journal())).rejects.toMatchObject({
			code: 'migration_target_changed',
			phase: 'config_write',
			recoveryRequired: true
		});
		expect(h.writes).toEqual([MOVIE, SHOW]);
		expect(h.files.get(CONFIG)).toBe(external);
	});

	it('fails closed when physical targets become aliases at the final config boundary', async () => {
		const h = harness();
		let injected = false;
		h.setOnSaveJournal((value) => {
			if (!injected && value.backups.config !== null && !value.checkpoints.configVerified) {
				injected = true;
				h.setFailDistinctPathCheck();
			}
		});

		await expect(executeKometaMigration(h.deps, journal())).rejects.toMatchObject({
			code: 'migration_target_changed',
			phase: 'source_revalidate',
			recoveryRequired: true
		});
		expect(h.writes).toEqual([MOVIE, SHOW]);
		expect(h.files.get(CONFIG)).toBe(CONFIG_SOURCE);
		expect(h.saved.at(-1)?.status).toBe('recovery_required');
	});

	it.each([
		['legacy source', LEGACY],
		['movie split', MOVIE],
		['show split', SHOW]
	])('revalidates the %s at the last boundary before config overwrite', async (_label, path) => {
		const h = harness();
		const external = `${path}\nexternal boundary mutation\n`;
		let injected = false;
		h.setOnSaveJournal((value) => {
			if (!injected && value.backups.config !== null && !value.checkpoints.configVerified) {
				injected = true;
				h.files.set(path, external);
			}
		});

		await expect(executeKometaMigration(h.deps, journal())).rejects.toMatchObject({
			recoveryRequired: true
		});
		expect(h.writes).toEqual([MOVIE, SHOW]);
		expect(h.files.get(CONFIG)).toBe(CONFIG_SOURCE);
		expect(h.files.get(path)).toBe(external);
	});

	it('fails closed when a registered backup disappears before resume', async () => {
		const h = harness();
		h.setFailWrite(SHOW);
		await expect(executeKometaMigration(h.deps, journal())).rejects.toMatchObject({
			code: 'migration_write_failed',
			phase: 'show_write'
		});
		const failed = h.saved.at(-1)!;
		const movieBackup = failed.backups.movie!;
		h.backups.delete(`${MOVIE}:${movieBackup.name}`);
		h.writes.length = 0;

		await expect(executeKometaMigration(h.deps, failed)).rejects.toMatchObject({
			code: 'migration_backup_invalid',
			phase: 'movie_verify',
			recoveryRequired: true
		});
		expect(h.writes).toEqual([]);
		expect(h.saved.at(-1)?.status).toBe('recovery_required');
	});

	it.each(['movie', 'show', 'config'] as const)(
		'fails closed when the registered %s backup changes before completion',
		async (name) => {
			const h = harness();
			let injected = false;
			h.setOnSaveJournal((value) => {
				if (!injected && value.status === 'config_written') {
					const backup = value.backups[name]!;
					const path = name === 'movie' ? MOVIE : name === 'show' ? SHOW : CONFIG;
					h.backups.set(`${path}:${backup.name}`, 'tampered backup bytes');
					injected = true;
				}
			});

			await expect(executeKometaMigration(h.deps, journal())).rejects.toMatchObject({
				code: 'migration_backup_invalid',
				recoveryRequired: true
			});
			expect(h.completed).toHaveLength(0);
			expect(h.saved.at(-1)?.status).toBe('recovery_required');
		}
	);

	it('waits for explicit manual wiring acknowledgment before completing', async () => {
		const h = harness('manual');
		const awaiting = await executeKometaMigration(h.deps, journal('manual'));
		expect(awaiting.status).toBe('awaiting_manual_wiring');
		expect(h.writes).toEqual([MOVIE, SHOW]);
		expect(h.completed).toHaveLength(0);

		const completed = await acknowledgeManualKometaMigration(h.deps, awaiting);
		expect(completed.status).toBe('completed');
		expect(completed.activationEvidence?.type).toBe('user_acknowledged');
		expect(h.completed).toHaveLength(1);
	});

	it('revalidates authoritative evidence immediately before manual acknowledgment', async () => {
		const h = harness('manual');
		const awaiting = await executeKometaMigration(h.deps, journal('manual'));
		h.setEvidenceCurrent(false);

		await expect(acknowledgeManualKometaMigration(h.deps, awaiting)).rejects.toMatchObject({
			code: 'migration_evidence_changed',
			phase: 'manual_acknowledgment',
			recoveryRequired: true
		});
		expect(h.completed).toHaveLength(0);
		expect(h.saved.at(-1)?.status).toBe('recovery_required');
	});

	it('does not acknowledge manual wiring when the transactional evidence fence changes', async () => {
		const h = harness('manual');
		const awaiting = await executeKometaMigration(h.deps, journal('manual'));
		h.setCompletionEvidenceState('changed');

		await expect(acknowledgeManualKometaMigration(h.deps, awaiting)).rejects.toMatchObject({
			code: 'migration_evidence_changed',
			phase: 'manual_acknowledgment',
			recoveryRequired: true
		});
		expect(h.completed).toHaveLength(0);
		expect(h.saved.at(-1)?.status).toBe('recovery_required');
	});

	it('restores only the protected config backup and the previous ownership snapshot', async () => {
		const h = harness();
		const completed = await executeKometaMigration(h.deps, journal());
		h.writes.length = 0;
		const rolledBack = await rollbackKometaMigration(h.deps, completed);

		expect(rolledBack.status).toBe('rolled_back');
		expect(h.writes).toEqual([CONFIG]);
		expect(h.files.get(CONFIG)).toBe(CONFIG_SOURCE);
		expect(h.files.get(MOVIE)).toBe(MOVIE_PROPOSED);
		expect(h.files.get(SHOW)).toBe(SHOW_PROPOSED);
		expect(h.rolledBack).toHaveLength(1);
	});

	it('finalizes an interrupted prepared rollback without rewriting restored config', async () => {
		const h = harness();
		const completed = await executeKometaMigration(h.deps, journal());
		h.writes.length = 0;
		h.setFailRollback();

		await expect(rollbackKometaMigration(h.deps, completed)).rejects.toMatchObject({
			code: 'migration_write_failed',
			phase: 'rollback'
		});
		const interrupted = h.saved.at(-1)!;
		expect(interrupted.status).toBe('rollback_prepared');
		expect(interrupted.lastFailure?.phase).toBe('rollback');
		expect(h.files.get(CONFIG)).toBe(CONFIG_SOURCE);
		expect(h.writes).toEqual([CONFIG]);
		expect(h.rolledBack).toHaveLength(0);

		h.writes.length = 0;
		h.writeAttempts.length = 0;
		const finalized = await rollbackKometaMigration(h.deps, interrupted);
		expect(finalized.status).toBe('rolled_back');
		expect(finalized.lastFailure).toBeNull();
		expect(h.writes).toEqual([]);
		expect(h.writeAttempts).toEqual([{ path: CONFIG, expectedSource: CONFIG_SOURCE }]);
		expect(h.files.get(CONFIG)).toBe(CONFIG_SOURCE);
		expect(h.rolledBack).toHaveLength(1);
	});

	it('refuses rollback after the active config changes', async () => {
		const h = harness();
		const completed = await executeKometaMigration(h.deps, journal());
		h.files.set(CONFIG, 'libraries:\n  externally_changed: true\n');
		await expect(rollbackKometaMigration(h.deps, completed)).rejects.toMatchObject({
			code: 'migration_target_changed'
		});
		expect(h.files.get(CONFIG)).toContain('externally_changed');
		const failed = h.saved.at(-1)!;
		expect(failed.status).toBe('completed');
		expect(failed.lastFailure?.phase).toBe('rollback');

		h.files.set(CONFIG, CONFIG_PROPOSED);
		const rolledBack = await rollbackKometaMigration(h.deps, failed);
		expect(rolledBack.status).toBe('rolled_back');
		expect(rolledBack.lastFailure).toBeNull();
	});

	it('does not restore over config changed while the protected backup is read', async () => {
		const h = harness();
		const completed = await executeKometaMigration(h.deps, journal());
		const external = 'libraries:\n  External: {}\n';
		h.writes.length = 0;
		h.setOnReadProtectedBackup((path) => {
			if (path === CONFIG) h.files.set(CONFIG, external);
		});

		await expect(rollbackKometaMigration(h.deps, completed)).rejects.toMatchObject({
			code: 'migration_target_changed',
			phase: 'rollback'
		});
		expect(h.writes).toEqual([]);
		expect(h.files.get(CONFIG)).toBe(external);
	});
});
