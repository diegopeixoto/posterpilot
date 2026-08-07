import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveKometaDestination } from './destination';
import { kometaFileFingerprint } from './plan';
import {
	KOMETA_MIGRATION_PLAN_KIND,
	KOMETA_MIGRATION_PLAN_VERSION,
	assertKometaMigrationPlanPayload,
	kometaMigrationBaselineFingerprint,
	kometaManualSnippetFingerprint,
	type KometaMigrationPlanPayload
} from './migration-plan';

function pathBinding(path: string) {
	return {
		version: 1 as const,
		canonicalPath: path,
		anchorPath: dirname(path),
		anchorDevice: '1',
		anchorInode: '1'
	};
}

function destination() {
	const out = resolveKometaDestination({ type: 'movie', tmdbId: '10' });
	if (!out.ok) throw new Error('fixture destination failed');
	return out.destination;
}

function payload(activation: 'managed' | 'manual' = 'managed'): KometaMigrationPlanPayload {
	const root = join(tmpdir(), 'posterpilot-kometa-migration-plan');
	const movie = 'metadata:\n  10:\n    url_poster: https://images.invalid/movie.jpg\n';
	const show = 'metadata: {}\n';
	const config =
		'libraries:\n  Movies:\n    metadata_files:\n      - file: config/posterpilot-movies.yml\n';
	const snippet =
		'libraries:\n  Movies:\n    metadata_files:\n      - file: config/posterpilot-movies.yml\n';
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
			config: activation === 'managed' ? pathBinding(join(root, 'config.yml')) : null
		},
		legacy: {
			path: join(root, 'posterpilot.yml'),
			sourceFingerprint: kometaFileFingerprint('metadata: {}\n')
		},
		files: {
			movie: {
				path: join(root, 'posterpilot-movies.yml'),
				sourceFingerprint: kometaFileFingerprint(null),
				proposedFingerprint: kometaFileFingerprint(movie),
				proposedContent: movie
			},
			show: {
				path: join(root, 'posterpilot-shows.yml'),
				sourceFingerprint: kometaFileFingerprint(null),
				proposedFingerprint: kometaFileFingerprint(show),
				proposedContent: show
			}
		},
		config:
			activation === 'managed'
				? {
						activation,
						path: join(root, 'config.yml'),
						mode: 'merge',
						sourceFingerprint: kometaFileFingerprint('libraries: {}\n'),
						proposedFingerprint: kometaFileFingerprint(config),
						proposedContent: config
					}
				: {
						activation,
						path: null,
						mode: null,
						sourceFingerprint: null,
						proposedFingerprint: null,
						proposedContent: null
					},
		evidenceFingerprint: 'a'.repeat(64),
		previousSnapshot: null,
		previousSnapshotFingerprint: kometaMigrationBaselineFingerprint(null),
		nextSnapshot: { libraries: {}, managedSettingKeys: [], connections: {} },
		manualSnippet: activation === 'manual' ? snippet : null,
		manualSnippetFingerprint:
			activation === 'manual' ? kometaManualSnippetFingerprint(snippet) : null,
		display: {
			classified: [
				{
					legacyKey: '10',
					entryFingerprint: 'b'.repeat(64),
					slots: ['url_poster'],
					destination: destination(),
					evidence: 'mapping'
				}
			],
			ambiguous: [],
			files: {
				movie: {
					filename: 'posterpilot-movies.yml',
					physicalPath: join(root, 'posterpilot-movies.yml'),
					configReference: 'config/posterpilot-movies.yml',
					sourceFingerprint: kometaFileFingerprint(null),
					proposedFingerprint: kometaFileFingerprint(movie),
					added: 1,
					unchanged: 0,
					changes: []
				},
				show: {
					filename: 'posterpilot-shows.yml',
					physicalPath: join(root, 'posterpilot-shows.yml'),
					configReference: 'config/posterpilot-shows.yml',
					sourceFingerprint: kometaFileFingerprint(null),
					proposedFingerprint: kometaFileFingerprint(show),
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

describe('assertKometaMigrationPlanPayload', () => {
	it('accepts managed and manual frozen plans', () => {
		expect(() => assertKometaMigrationPlanPayload(payload())).not.toThrow();
		expect(() => assertKometaMigrationPlanPayload(payload('manual'))).not.toThrow();
	});

	it('rejects tampered proposed bytes', () => {
		const candidate = payload();
		candidate.files.movie.proposedContent += '# changed\n';
		expect(() => assertKometaMigrationPlanPayload(candidate)).toThrow(/fingerprint mismatch/);
	});

	it('rejects a previous snapshot whose frozen fingerprint was tampered', () => {
		const candidate = payload();
		candidate.previousSnapshotFingerprint = '0'.repeat(64);
		expect(() => assertKometaMigrationPlanPayload(candidate)).toThrow(
			/previous Kometa snapshot fingerprint mismatch/i
		);
	});

	it('rejects overlapping physical targets', () => {
		const candidate = payload();
		candidate.files.show.path = candidate.files.movie.path;
		candidate.pathBindings.show = candidate.pathBindings.movie;
		expect(() => assertKometaMigrationPlanPayload(candidate)).toThrow(/physically distinct/);
	});

	it('accepts the complete summary plus file diff for more than 10k valid entries', () => {
		const candidate = payload();
		const classified = candidate.display.classified[0];
		candidate.display.classified = Array.from({ length: 10_001 }, () => ({ ...classified }));
		candidate.display.files.movie.changes = Array.from({ length: 10_001 }, (_, index) => ({
			operation: 'add' as const,
			path: `metadata[${index + 1}]`,
			targetMappingId: String(index + 1),
			entryFingerprint: 'c'.repeat(64),
			targetFingerprint: null
		}));

		expect(() => assertKometaMigrationPlanPayload(candidate)).not.toThrow();
	});

	it('rejects managed bytes in a manual plan', () => {
		const candidate = payload('manual');
		candidate.config.proposedContent = 'libraries: {}\n';
		expect(() => assertKometaMigrationPlanPayload(candidate)).toThrow(/proposed config bytes/);
	});

	it('accepts an observed config path for manual wiring', () => {
		const candidate = payload('manual');
		candidate.config.path = join(tmpdir(), 'manual-config.yml');
		candidate.config.mode = 'merge';
		candidate.config.sourceFingerprint = kometaFileFingerprint('libraries: {}\n');
		candidate.pathBindings.config = pathBinding(candidate.config.path);
		expect(() => assertKometaMigrationPlanPayload(candidate)).not.toThrow();
	});

	it('rejects a frozen binding that points somewhere other than its target', () => {
		const candidate = payload();
		candidate.pathBindings.movie = pathBinding(join(tmpdir(), 'external.yml'));
		expect(() => assertKometaMigrationPlanPayload(candidate)).toThrow(/does not match/);
	});
});
