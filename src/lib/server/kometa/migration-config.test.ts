import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { KometaSnapshot } from './config';
import { LEGACY_FILENAME, MOVIE_FILENAME, SHOW_FILENAME } from './destination';
import { planKometaMigrationConfig, type PlanKometaMigrationConfigInput } from './migration-config';
import { kometaFileFingerprint } from './plan';

const PREFIX = 'config';
const REFERENCES = {
	movie: `${PREFIX}/${MOVIE_FILENAME}`,
	show: `${PREFIX}/${SHOW_FILENAME}`
};

function snapshot(
	libraries: KometaSnapshot['libraries'],
	metadataPath = `legacy/${LEGACY_FILENAME}`
): KometaSnapshot {
	return {
		metadataPath,
		libraries,
		managedSettingKeys: ['webhooks.error'],
		connections: { github: ['token'] }
	};
}

function input(
	overrides: Partial<PlanKometaMigrationConfigInput> = {}
): PlanKometaMigrationConfigInput {
	return {
		rawConfig: `libraries:
  Movies:
    metadata_files:
      - file: legacy/${LEGACY_FILENAME}
`,
		mode: 'merge',
		snapshot: snapshot({ Movies: { metadata: true, defaults: ['genre'] } }),
		metadataPathPrefix: PREFIX,
		references: REFERENCES,
		libraries: [{ title: 'Movies', type: 'movie' }],
		...overrides
	};
}

describe('planKometaMigrationConfig — managed activation', () => {
	it('collapses duplicate legacy references into one typed entry', () => {
		// Both entries name the same file (matching is by basename); blocking on
		// the duplicate used to force manual wiring for a config Kometa itself
		// tolerates. The rewrite keeps the owned entry and removes the extra.
		const rawConfig = `libraries:
  Movies:
    metadata_files:
      - file: legacy/${LEGACY_FILENAME}
      - file: ${LEGACY_FILENAME}
`;
		const result = planKometaMigrationConfig(input({ rawConfig }));

		expect(result.activation).toBe('managed');
		expect(result.reasons).toEqual([]);
		const proposed = parse(result.proposedContent ?? '') as {
			libraries: { Movies: { metadata_files: unknown } };
		};
		expect(proposed.libraries.Movies.metadata_files).toEqual([{ file: REFERENCES.movie }]);
		expect(result.changes).toEqual([
			{
				library: 'Movies',
				mediaKind: 'movie',
				before: [LEGACY_FILENAME],
				after: REFERENCES.movie
			}
		]);
		expect(result.legacyReferenceCount).toBe(2);
	});

	it('suggests near-miss synced sections for an unknown library', () => {
		const rawConfig = `libraries:
  Documentarios:
    metadata_files:
      - file: legacy/${LEGACY_FILENAME}
`;
		const result = planKometaMigrationConfig(
			input({
				rawConfig,
				snapshot: null,
				libraries: [
					{ title: 'Documentários Filmes', type: 'movie' },
					{ title: 'Documentarios Seriados', type: 'show' }
				]
			})
		);

		expect(result.manualWiringActionable).toBe(false);
		expect(result.incompatibleLibraries).toContainEqual({
			library: 'Documentarios',
			reason: 'unknown_library',
			suggestion: 'Documentários Filmes, Documentarios Seriados'
		});
	});

	it('rewires exact merge-owned movie and show references by authoritative type', () => {
		const rawConfig = `# keep root comment
libraries:
  Movies:
    metadata_files:
      - file: legacy/${LEGACY_FILENAME} # keep movie comment
  Series:
    metadata_files:
      - file: legacy/${LEGACY_FILENAME} # keep show comment
`;
		const result = planKometaMigrationConfig(
			input({
				rawConfig,
				snapshot: snapshot({
					Movies: { metadata: true, defaults: ['genre'] },
					Series: { metadata: true, defaults: ['network'] }
				}),
				libraries: [
					{ title: 'Movies', type: 'movie' },
					{ title: 'Series', type: 'show' }
				]
			})
		);

		expect(result.activation).toBe('managed');
		expect(result.sourceFingerprint).toBe(kometaFileFingerprint(rawConfig));
		expect(result.proposedFingerprint).toBe(kometaFileFingerprint(result.proposedContent));
		expect(result.proposedContent).toContain(`# keep root comment`);
		expect(result.proposedContent).toContain(`file: ${REFERENCES.movie} # keep movie comment`);
		expect(result.proposedContent).toContain(`file: ${REFERENCES.show} # keep show comment`);
		expect(result.changes).toEqual([
			{
				library: 'Movies',
				mediaKind: 'movie',
				before: [LEGACY_FILENAME],
				after: REFERENCES.movie
			},
			{
				library: 'Series',
				mediaKind: 'show',
				before: [LEGACY_FILENAME],
				after: REFERENCES.show
			}
		]);
		expect(JSON.stringify(result.changes)).not.toContain(`legacy/${LEGACY_FILENAME}`);
		expect(result.nextSnapshot).not.toHaveProperty('metadataPath');
		expect(result.nextSnapshot).toMatchObject({
			metadataPathPrefix: PREFIX,
			libraries: {
				Movies: { metadataReference: REFERENCES.movie, defaults: ['genre'] },
				Series: { metadataReference: REFERENCES.show, defaults: ['network'] }
			},
			managedSettingKeys: ['webhooks.error'],
			connections: { github: ['token'] }
		});
	});

	it('preserves sibling metadata entries and replaces only the legacy scalar in place', () => {
		const result = planKometaMigrationConfig(
			input({
				rawConfig: `libraries:
  Movies:
    metadata_files:
      - file: legacy/${LEGACY_FILENAME} # PosterPilot
        template_variables:
          use_separator: false
      - file: user/custom.yml # user sibling
    operations:
      mass_critic_rating_update: mdb_tomatoes
`
			})
		);

		expect(result.activation).toBe('managed');
		expect(result.proposedContent).toContain(`file: ${REFERENCES.movie} # PosterPilot`);
		expect(result.proposedContent).toContain('template_variables:');
		expect(result.proposedContent).toContain('file: user/custom.yml # user sibling');
		expect(result.proposedContent).toContain('mass_critic_rating_update: mdb_tomatoes');
	});

	it('preserves aliases in unrelated library settings while rewriting an owned reference', () => {
		const result = planKometaMigrationConfig(
			input({
				rawConfig: `shared: &shared
  schedule: daily
libraries:
  Movies:
    operations: *shared
    metadata_files:
      - file: legacy/${LEGACY_FILENAME}
`
			})
		);

		expect(result.activation).toBe('managed');
		expect(result.reasons).toEqual([]);
		expect(result.proposedContent).toContain('shared: &shared');
		expect(result.proposedContent).toContain('operations: *shared');
		expect(result.proposedContent).toContain(`file: ${REFERENCES.movie}`);
	});

	it('treats the complete config as owned in own mode without requiring a snapshot', () => {
		const result = planKometaMigrationConfig(
			input({
				mode: 'own',
				snapshot: null,
				rawConfig: `libraries:
  Series:
    metadata_files:
      - file: /kometa-visible/${LEGACY_FILENAME}
`,
				libraries: [{ title: 'Series', type: 'show' }]
			})
		);

		expect(result.activation).toBe('managed');
		expect(result.proposedContent).toContain(`file: ${REFERENCES.show}`);
		expect(result.nextSnapshot.libraries.Series.metadataReference).toBe(REFERENCES.show);
	});

	it('stores prototype-shaped library titles as own snapshot keys', () => {
		const result = planKometaMigrationConfig(
			input({
				mode: 'own',
				snapshot: null,
				rawConfig: `libraries:
  __proto__:
    metadata_files:
      - file: ${LEGACY_FILENAME}
`,
				libraries: [{ title: '__proto__', type: 'movie' }]
			})
		);

		expect(result.activation).toBe('managed');
		expect(Object.getPrototypeOf(result.nextSnapshot.libraries)).toBeNull();
		expect(Object.hasOwn(result.nextSnapshot.libraries, '__proto__')).toBe(true);
		expect(result.nextSnapshot.libraries['__proto__']).toEqual({
			defaults: [],
			metadataReference: REFERENCES.movie
		});
		expect(JSON.parse(JSON.stringify(result.nextSnapshot)).libraries['__proto__']).toEqual({
			defaults: [],
			metadataReference: REFERENCES.movie
		});
	});

	it('keeps clean config bytes exact when every relevant library is already typed', () => {
		const rawConfig = `# typed layout is already active
libraries:
  Movies:
    metadata_files:
      - file: ${REFERENCES.movie}
`;
		const result = planKometaMigrationConfig(input({ rawConfig, snapshot: null }));
		expect(result.activation).toBe('managed');
		expect(result.proposedContent).toBe(rawConfig);
		expect(result.warnings).toEqual(['no_legacy_references']);
		expect(result.changes).toEqual([]);
		expect(result.nextSnapshot.libraries.Movies.metadataReference).toBe(REFERENCES.movie);
		expect(result.nextSnapshot).not.toHaveProperty('metadataPath');
	});

	it('ignores null library stanzas and null metadata_files while rewriting an owned reference', () => {
		const result = planKometaMigrationConfig(
			input({
				rawConfig: `libraries:
  EmptyLibrary:
  EmptyMetadata:
    metadata_files: null
  Movies:
    metadata_files:
      - file: legacy/${LEGACY_FILENAME}
`
			})
		);

		expect(result.activation).toBe('managed');
		expect(result.reasons).toEqual([]);
		expect(result.proposedContent).toContain(`file: ${REFERENCES.movie}`);
	});

	it('treats a null libraries stanza as absent rather than an unsupported shape', () => {
		const result = planKometaMigrationConfig(
			input({ rawConfig: 'libraries: null\n', snapshot: null })
		);

		expect(result.activation).toBe('manual');
		expect(result.reasons).toContainEqual({
			code: 'missing_typed_reference',
			library: 'Movies'
		});
		expect(result.reasons).not.toContainEqual({ code: 'unsupported_config_shape' });
		expect(result.manualWiringActionable).toBe(true);
	});

	it('requires manual wiring when the legacy file exists but no relevant typed ref is active', () => {
		const rawConfig = '# no active metadata reference\nlibraries: {}\n';
		const result = planKometaMigrationConfig(input({ rawConfig, snapshot: null }));
		expect(result.activation).toBe('manual');
		expect(result.proposedContent).toBeNull();
		expect(result.reasons).toContainEqual({
			code: 'missing_typed_reference',
			library: 'Movies'
		});
		expect(result.manualSnippet).toContain(`file: ${REFERENCES.movie}`);
	});
});

describe('planKometaMigrationConfig — safe manual fallback', () => {
	it('fails safely to manual wiring when config parser limits are exceeded', () => {
		const result = planKometaMigrationConfig(input({ configLimits: { maxBytes: 8 } }));

		expect(result.activation).toBe('manual');
		expect(result.proposedContent).toBeNull();
		expect(result.reasons).toEqual([{ code: 'config_limit_exceeded' }]);
	});

	it('does not rewrite a merge-mode reference without exact snapshot ownership', () => {
		const result = planKometaMigrationConfig(
			input({
				snapshot: snapshot(
					{ Movies: { metadata: true, defaults: [] } },
					`different/${LEGACY_FILENAME}`
				)
			})
		);

		expect(result.activation).toBe('manual');
		expect(result.proposedContent).toBeNull();
		expect(result.proposedFingerprint).toBeNull();
		expect(result.reasons).toContainEqual({
			code: 'unowned_legacy_reference',
			library: 'Movies'
		});
		expect(result.changes).toEqual([
			{
				library: 'Movies',
				mediaKind: 'movie',
				before: [LEGACY_FILENAME],
				after: REFERENCES.movie
			}
		]);
		expect(result.manualSnippet).toContain(`file: ${REFERENCES.movie}`);
	});

	it('rejects aliases and anchors even in own mode', () => {
		const result = planKometaMigrationConfig(
			input({
				mode: 'own',
				snapshot: null,
				rawConfig: `shared: &shared
  metadata_files:
    - file: ${LEGACY_FILENAME}
libraries:
  Movies: *shared
`
			})
		);

		expect(result.activation).toBe('manual');
		expect(result.reasons).toEqual([{ code: 'yaml_alias_or_anchor' }]);
	});

	it('rejects a root inline merge key that can synthesize the libraries shape', () => {
		const result = planKometaMigrationConfig(
			input({
				rawConfig: `defaults:
  libraries: {}
<<:
  libraries: {}
libraries:
  Movies:
    metadata_files:
      - file: ${LEGACY_FILENAME}
`
			})
		);

		expect(result.activation).toBe('manual');
		expect(result.reasons).toEqual([{ code: 'yaml_alias_or_anchor' }]);
		expect(result.manualWiringActionable).toBe(false);
	});

	it('rejects an unknown metadata_files shape instead of guessing', () => {
		const result = planKometaMigrationConfig(
			input({
				mode: 'own',
				snapshot: null,
				rawConfig: `libraries:
  Movies:
    metadata_files: ${LEGACY_FILENAME}
`
			})
		);

		expect(result.activation).toBe('manual');
		expect(result.reasons).toContainEqual({
			code: 'unsupported_config_shape',
			library: 'Movies'
		});
	});

	it('does not infer an unknown library type from its title', () => {
		const result = planKometaMigrationConfig(
			input({
				mode: 'own',
				snapshot: null,
				rawConfig: `libraries:
  Movies 4K:
    metadata_files:
      - file: ${LEGACY_FILENAME}
`,
				libraries: [{ title: 'Movies', type: 'movie' }]
			})
		);

		expect(result.activation).toBe('manual');
		expect(result.reasons).toContainEqual({ code: 'unknown_library', library: 'Movies 4K' });
		expect(result.incompatibleLibraries).toContainEqual({
			library: 'Movies 4K',
			reason: 'unknown_library',
			suggestion: 'Movies'
		});
		expect(result.manualWiringActionable).toBe(false);
	});

	it('marks an active legacy title with conflicting authoritative types as non-actionable', () => {
		const result = planKometaMigrationConfig(
			input({
				mode: 'own',
				snapshot: null,
				rawConfig: `libraries:
  Shared:
    metadata_files:
      - file: ${LEGACY_FILENAME}
`,
				libraries: [
					{ title: 'Shared', type: 'movie' },
					{ title: 'Shared', type: 'show' }
				]
			})
		);

		expect(result.activation).toBe('manual');
		expect(result.incompatibleLibraries).toContainEqual({
			library: 'Shared',
			reason: 'conflicting_authoritative_types'
		});
		expect(result.manualWiringActionable).toBe(false);
	});

	it('marks a duplicated authoritative title as non-actionable even when its types agree', () => {
		const result = planKometaMigrationConfig(
			input({
				mode: 'own',
				snapshot: null,
				rawConfig: `libraries:
  Shared:
    metadata_files:
      - file: ${LEGACY_FILENAME}
`,
				libraries: [
					{ title: 'Shared', type: 'movie' },
					{ title: 'Shared', type: 'movie' }
				]
			})
		);

		expect(result.activation).toBe('manual');
		expect(result.incompatibleLibraries).toContainEqual({
			library: 'Shared',
			reason: 'conflicting_authoritative_types'
		});
		expect(result.manualWiringActionable).toBe(false);
		expect(result.changes).toEqual([]);
	});

	it('rejects a legacy rewire that would duplicate a typed PosterPilot reference', () => {
		const result = planKometaMigrationConfig(
			input({
				mode: 'own',
				snapshot: null,
				rawConfig: `libraries:
  Movies:
    metadata_files:
      - file: ${LEGACY_FILENAME}
      - file: ${REFERENCES.movie}
`
			})
		);
		expect(result.activation).toBe('manual');
		expect(result.reasons).toContainEqual({
			code: 'typed_reference_conflict',
			library: 'Movies'
		});
	});

	it('builds an exact URL-free snippet only for compatible authoritative types', () => {
		const secretUrl = 'https://example.invalid/provider/artwork-with-token';
		const result = planKometaMigrationConfig(
			input({
				mode: 'merge',
				snapshot: null,
				rawConfig: `webhooks:
  error: ${secretUrl}
libraries:
  Movies:
    metadata_files:
      - file: ${LEGACY_FILENAME}
`,
				libraries: [
					{ title: 'Movies', type: 'movie' },
					{ title: 'Series', type: 'show' },
					{ title: 'Music', type: 'artist' }
				]
			})
		);

		expect(result.activation).toBe('manual');
		expect(result.manualSnippet).not.toContain(secretUrl);
		expect(JSON.stringify(result.changes)).not.toContain(secretUrl);
		expect(parse(result.manualSnippet ?? '')).toEqual({
			libraries: {
				Movies: { metadata_files: [{ file: REFERENCES.movie }] },
				Series: { metadata_files: [{ file: REFERENCES.show }] }
			}
		});
		expect(result.manualSnippet).not.toContain('Music');
		expect(result.manualSnippet).toContain('REFERENCE ONLY');
		expect(result.manualSnippet).toContain(LEGACY_FILENAME);
		expect(result.manualSnippet).toContain('Keep every other metadata_files item');
		expect(result.manualSnippet).toContain('otherwise add the shown typed item once');
		expect(result.incompatibleLibraries).toContainEqual({
			library: 'Music',
			reason: 'unsupported_library_type'
		});
		expect(result.nextSnapshot).not.toHaveProperty('metadataPath');
		expect(result.nextSnapshot.libraries.Movies.metadataReference).toBe(REFERENCES.movie);
		expect(result.nextSnapshot.libraries.Series.metadataReference).toBe(REFERENCES.show);
	});

	it('instructs a surgical replacement when an unowned legacy entry has user siblings', () => {
		const result = planKometaMigrationConfig(
			input({
				mode: 'merge',
				snapshot: null,
				rawConfig: `libraries:
  Movies:
    metadata_files:
      - file: legacy/${LEGACY_FILENAME}
      - file: user/custom.yml
    operations:
      mass_critic_rating_update: mdb_tomatoes
`
			})
		);

		expect(result.activation).toBe('manual');
		expect(result.reasons).toContainEqual({ code: 'unowned_legacy_reference', library: 'Movies' });
		expect(result.manualSnippet).toContain(`file: ${REFERENCES.movie}`);
		expect(result.manualSnippet).toContain('replace only the metadata_files item');
		expect(result.manualSnippet).toContain('Keep every other metadata_files item');
		expect(result.manualSnippet).not.toContain('user/custom.yml');
		expect(result.manualSnippet).not.toContain('mass_critic_rating_update');
		expect(result.changes).toContainEqual({
			library: 'Movies',
			mediaKind: 'movie',
			before: [LEGACY_FILENAME],
			after: REFERENCES.movie
		});
	});
});

describe('planKometaMigrationConfig — validated references', () => {
	it('rejects references that do not match the configured prefix', () => {
		expect(() =>
			planKometaMigrationConfig(
				input({ references: { movie: MOVIE_FILENAME, show: SHOW_FILENAME } })
			)
		).toThrow(/prefix/i);
	});
});
