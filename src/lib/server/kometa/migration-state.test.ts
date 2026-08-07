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
	isKometaMigrationIncomplete
} from './migration-journal';
import {
	completedKometaMigrationBaseline,
	kometaMigrationCollisionState,
	publicKometaMigrationState
} from './migration-state';

function pathBinding(path: string) {
	return {
		version: 1 as const,
		canonicalPath: path,
		anchorPath: dirname(path),
		anchorDevice: '1',
		anchorInode: '1'
	};
}

function fixture() {
	const root = join(tmpdir(), 'migration-state');
	const empty = 'metadata: {}\n';
	const resolved = resolveKometaDestination({ type: 'movie', tmdbId: '1' });
	if (!resolved.ok) throw new Error('fixture destination');
	const payload: KometaMigrationPlanPayload = {
		type: KOMETA_MIGRATION_PLAN_KIND,
		version: KOMETA_MIGRATION_PLAN_VERSION,
		migrationId: 'migration_123456',
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
	return createKometaMigrationJournal({
		planId: 'plan-1',
		planDigest: '1'.repeat(64),
		payload,
		now: new Date('2026-08-07T12:00:00.000Z')
	});
}

describe('migration state projections', () => {
	it('never exposes exact proposed YAML bytes', () => {
		const state = publicKometaMigrationState(fixture());
		expect(JSON.stringify(state)).not.toContain('metadata:');
		expect(JSON.stringify(state)).not.toContain('libraries:');
		expect(state).toMatchObject({
			scopeMatches: false,
			frozenScope: {
				serverInstanceId: 'server-a',
				serverName: 'Server A',
				outputDirectory: expect.stringContaining('migration-state'),
				configPath: expect.stringContaining('config.yml'),
				mode: 'merge',
				metadataPathPrefix: 'config'
			}
		});
	});

	it('keeps the frozen server identity visible while a different server scope is active', () => {
		const journal = fixture();
		const state = publicKometaMigrationState(journal, { scopeMatches: false });
		expect(state).toMatchObject({
			scopeMatches: false,
			frozenScope: {
				serverInstanceId: 'server-a',
				serverName: 'Server A'
			},
			canResume: false,
			canRollback: false,
			canRestartPreview: false
		});
	});

	it('gates recovery controls on the current frozen scope', () => {
		const prepared = fixture();
		expect(publicKometaMigrationState(prepared)).toMatchObject({
			scopeMatches: false,
			canResume: false,
			canRestartPreview: false,
			canRollback: false
		});
		expect(publicKometaMigrationState(prepared, { scopeMatches: true })).toMatchObject({
			scopeMatches: true,
			canResume: true,
			canRestartPreview: false,
			canRollback: false
		});
	});

	it('requires completed activation evidence for a collision-guard baseline', () => {
		const journal = fixture();
		expect(completedKometaMigrationBaseline(journal)).toBeNull();
		journal.status = 'completed';
		journal.checkpoints = {
			movieVerified: true,
			showVerified: true,
			configVerified: true,
			baselinePersisted: true
		};
		journal.activationEvidence = {
			type: 'verified_config',
			at: '2026-08-07T12:01:00.000Z'
		};
		journal.completedAt = '2026-08-07T12:01:00.000Z';
		expect(completedKometaMigrationBaseline(journal)).toMatchObject({
			serverInstanceId: 'server-a',
			activationEvidence: 'verified_config'
		});
	});

	it('offers a fresh preview only for an effectless failed journal in the same scope', () => {
		const journal = fixture();
		journal.status = 'recovery_required';
		journal.lastFailure = {
			phase: 'prepare',
			code: 'migration_source_changed',
			at: '2026-08-07T12:01:00.000Z'
		};

		expect(publicKometaMigrationState(journal)).toMatchObject({ canRestartPreview: false });
		expect(publicKometaMigrationState(journal, { scopeMatches: true })).toMatchObject({
			canRestartPreview: true
		});
		journal.backups.movie = {
			name: 'movie.migration.backup',
			fingerprint: '9'.repeat(64)
		};
		expect(publicKometaMigrationState(journal, { scopeMatches: true })).toMatchObject({
			canRestartPreview: false
		});
	});

	it('keeps an abandoned journal guarded while allowing only a fresh preview', () => {
		const journal = fixture();
		journal.status = 'abandoned';
		journal.lastFailure = {
			phase: 'source_revalidate',
			code: 'migration_evidence_changed',
			at: '2026-08-07T12:01:00.000Z'
		};

		expect(() => assertKometaMigrationJournal(journal)).not.toThrow();
		expect(isKometaMigrationIncomplete(journal)).toBe(true);
		expect(kometaMigrationCollisionState(journal)).toMatchObject({ status: 'abandoned' });
		expect(publicKometaMigrationState(journal, { scopeMatches: true })).toMatchObject({
			status: 'abandoned',
			canResume: false,
			canRestartPreview: true,
			canAbandon: false,
			canRollback: false
		});
	});

	it('keeps a prepared rollback incomplete and rollback-only after restart', () => {
		const journal = fixture();
		journal.status = 'rollback_prepared';
		journal.checkpoints = {
			movieVerified: true,
			showVerified: true,
			configVerified: true,
			baselinePersisted: true
		};
		journal.backups.config = {
			name: 'config.yml.migration.backup',
			fingerprint: '9'.repeat(64)
		};
		journal.activationEvidence = {
			type: 'verified_config',
			at: '2026-08-07T12:01:00.000Z'
		};
		journal.completedAt = '2026-08-07T12:01:00.000Z';

		expect(() => assertKometaMigrationJournal(journal)).not.toThrow();
		expect(isKometaMigrationIncomplete(journal)).toBe(true);
		expect(completedKometaMigrationBaseline(journal)).toBeNull();
		expect(kometaMigrationCollisionState(journal)).toMatchObject({
			status: 'rollback_prepared'
		});
		expect(publicKometaMigrationState(journal)).toMatchObject({
			status: 'rollback_prepared',
			canResume: false,
			canRollback: false
		});
		expect(publicKometaMigrationState(journal, { scopeMatches: true })).toMatchObject({
			status: 'rollback_prepared',
			scopeMatches: true,
			canResume: false,
			canRollback: true
		});
	});
});
