import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveKometaDestination } from './destination';
import { kometaFileFingerprint } from './plan';
import {
	KOMETA_MIGRATION_PLAN_KIND,
	KOMETA_MIGRATION_PLAN_VERSION,
	kometaMigrationBaselineFingerprint,
	type KometaMigrationPlanPayload
} from './migration-plan';
import {
	assertKometaMigrationJournal,
	createKometaMigrationJournal,
	isEffectlessKometaMigrationFailure,
	isKometaMigrationIncomplete,
	updateKometaMigrationJournal
} from './migration-journal';

function pathBinding(path: string) {
	return {
		version: 1 as const,
		canonicalPath: path,
		anchorPath: dirname(path),
		anchorDevice: '1',
		anchorInode: '1'
	};
}

function plan(): KometaMigrationPlanPayload {
	const root = join(tmpdir(), 'posterpilot-journal');
	const empty = 'metadata: {}\n';
	const destination = resolveKometaDestination({ type: 'movie', tmdbId: '1' });
	if (!destination.ok) throw new Error('fixture destination failed');
	return {
		type: KOMETA_MIGRATION_PLAN_KIND,
		version: KOMETA_MIGRATION_PLAN_VERSION,
		migrationId: 'migration_123456',
		serverInstanceId: 'server-a',
		serverName: 'Server A',
		outputDirectory: root,
		metadataPathPrefix: 'config',
		references: {
			movie: 'config/posterpilot-movies.yml',
			show: 'config/posterpilot-shows.yml'
		},
		pathBindings: {
			legacy: pathBinding(join(root, 'posterpilot.yml')),
			movie: pathBinding(join(root, 'posterpilot-movies.yml')),
			show: pathBinding(join(root, 'posterpilot-shows.yml')),
			config: pathBinding(join(root, 'config.yml'))
		},
		legacy: { path: join(root, 'posterpilot.yml'), sourceFingerprint: 'a'.repeat(64) },
		files: {
			movie: {
				path: join(root, 'posterpilot-movies.yml'),
				sourceFingerprint: 'b'.repeat(64),
				proposedFingerprint: kometaFileFingerprint(empty),
				proposedContent: empty
			},
			show: {
				path: join(root, 'posterpilot-shows.yml'),
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
			proposedFingerprint: kometaFileFingerprint('libraries: {}\n'),
			proposedContent: 'libraries: {}\n'
		},
		evidenceFingerprint: 'e'.repeat(64),
		previousSnapshot: null,
		previousSnapshotFingerprint: kometaMigrationBaselineFingerprint(null),
		nextSnapshot: { libraries: {}, managedSettingKeys: [], connections: {} },
		manualSnippet: null,
		manualSnippetFingerprint: null,
		display: {
			classified: [
				{
					legacyKey: '1',
					entryFingerprint: 'f'.repeat(64),
					slots: ['url_poster'],
					destination: destination.destination,
					evidence: 'mapping'
				}
			],
			ambiguous: [],
			files: {
				movie: {
					filename: 'posterpilot-movies.yml',
					physicalPath: join(root, 'posterpilot-movies.yml'),
					configReference: 'config/posterpilot-movies.yml',
					sourceFingerprint: 'b'.repeat(64),
					proposedFingerprint: kometaFileFingerprint(empty),
					added: 1,
					unchanged: 0,
					changes: []
				},
				show: {
					filename: 'posterpilot-shows.yml',
					physicalPath: join(root, 'posterpilot-shows.yml'),
					configReference: 'config/posterpilot-shows.yml',
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

describe('Kometa migration journal', () => {
	it('creates a valid durable prepared checkpoint', () => {
		const journal = createKometaMigrationJournal({
			planId: 'plan-1',
			planDigest: '1'.repeat(64),
			payload: plan(),
			now: new Date('2026-08-07T12:00:00.000Z')
		});
		expect(() => assertKometaMigrationJournal(journal)).not.toThrow();
		expect(isKometaMigrationIncomplete(journal)).toBe(true);
	});

	it('recognizes only failed journals with zero durable migration effects', () => {
		const journal = createKometaMigrationJournal({
			planId: 'plan-1',
			planDigest: '1'.repeat(64),
			payload: plan(),
			now: new Date('2026-08-07T12:00:00.000Z')
		});
		journal.status = 'recovery_required';
		journal.lastFailure = {
			phase: 'prepare',
			code: 'migration_source_changed',
			at: '2026-08-07T12:00:01.000Z'
		};
		expect(isEffectlessKometaMigrationFailure(journal)).toBe(true);
		journal.status = 'failed';
		expect(isEffectlessKometaMigrationFailure(journal)).toBe(true);

		const mutations: Array<(candidate: typeof journal) => void> = [
			(candidate) => {
				candidate.checkpoints.movieVerified = true;
			},
			(candidate) => {
				candidate.backups.movie = {
					name: 'movie.migration.backup',
					fingerprint: '9'.repeat(64)
				};
			},
			(candidate) => {
				candidate.activationEvidence = {
					type: 'verified_config',
					at: '2026-08-07T12:00:02.000Z'
				};
			},
			(candidate) => {
				candidate.completedAt = '2026-08-07T12:00:02.000Z';
			},
			(candidate) => {
				candidate.rolledBackAt = '2026-08-07T12:00:02.000Z';
			}
		];
		for (const mutate of mutations) {
			const candidate = structuredClone(journal);
			mutate(candidate);
			expect(isEffectlessKometaMigrationFailure(candidate)).toBe(false);
		}
	});

	it('rejects impossible checkpoint ordering', () => {
		const journal = createKometaMigrationJournal({
			planId: 'plan-1',
			planDigest: '1'.repeat(64),
			payload: plan(),
			now: new Date('2026-08-07T12:00:00.000Z')
		});
		journal.checkpoints.showVerified = true;
		expect(() => assertKometaMigrationJournal(journal)).toThrow(/cannot precede/);
	});

	it('requires the complete durable baseline before completed', () => {
		const journal = createKometaMigrationJournal({
			planId: 'plan-1',
			planDigest: '1'.repeat(64),
			payload: plan(),
			now: new Date('2026-08-07T12:00:00.000Z')
		});
		expect(() =>
			updateKometaMigrationJournal(
				journal,
				{ status: 'completed' },
				new Date('2026-08-07T12:01:00.000Z')
			)
		).toThrow(/missing split verification/);
	});

	it('accepts only an activated managed migration as a durable rollback checkpoint', () => {
		const prepared = createKometaMigrationJournal({
			planId: 'plan-1',
			planDigest: '1'.repeat(64),
			payload: plan(),
			now: new Date('2026-08-07T12:00:00.000Z')
		});
		const completed = updateKometaMigrationJournal(
			prepared,
			{
				status: 'completed',
				checkpoints: {
					movieVerified: true,
					showVerified: true,
					configVerified: true,
					baselinePersisted: true
				},
				backups: {
					...prepared.backups,
					config: { name: 'config.yml.migration.backup', fingerprint: '9'.repeat(64) }
				},
				activationEvidence: {
					type: 'verified_config',
					at: '2026-08-07T12:01:00.000Z'
				},
				completedAt: '2026-08-07T12:01:00.000Z'
			},
			new Date('2026-08-07T12:01:00.000Z')
		);
		const rollbackPrepared = updateKometaMigrationJournal(
			completed,
			{ status: 'rollback_prepared' },
			new Date('2026-08-07T12:02:00.000Z')
		);

		expect(() => assertKometaMigrationJournal(rollbackPrepared)).not.toThrow();
		expect(isKometaMigrationIncomplete(rollbackPrepared)).toBe(true);
		const missingBackup = structuredClone(rollbackPrepared);
		missingBackup.backups.config = null;
		expect(() => assertKometaMigrationJournal(missingBackup)).toThrow(/recoverable managed/);
	});
});
