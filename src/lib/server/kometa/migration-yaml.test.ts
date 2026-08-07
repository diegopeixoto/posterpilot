import { describe, expect, it } from 'vitest';
import { isMap, isScalar, parseDocument } from 'yaml';
import {
	classifyLegacyEntries,
	parseLegacyMetadata,
	type AuthoritativeKometaMapping
} from './migration-classifier';
import { MigrationYamlBuildError, buildSplitMigrationYaml } from './migration-yaml';

function mapping(
	input: Partial<AuthoritativeKometaMapping> &
		Pick<AuthoritativeKometaMapping, 'mediaItemId' | 'type'>
): AuthoritativeKometaMapping {
	return {
		mediaItemId: input.mediaItemId,
		type: input.type,
		tmdbId: input.tmdbId ?? null,
		tvdbId: input.tvdbId ?? null,
		imdbId: input.imdbId ?? null
	};
}

function classified(legacyRaw: string, mappings: AuthoritativeKometaMapping[]) {
	const parsed = parseLegacyMetadata(legacyRaw);
	return classifyLegacyEntries({ parsed, mappings, revisions: [] });
}

function metadataKeys(raw: string): unknown[] {
	const document = parseDocument(raw);
	const metadata = document.get('metadata', true);
	if (!isMap(metadata)) throw new Error('fixture has no metadata map');
	return metadata.items.map((pair) => (isScalar(pair.key) ? pair.key.value : pair.key));
}

describe('buildSplitMigrationYaml', () => {
	it('builds exact empty split files with an explicit metadata mapping', () => {
		const legacyRaw = 'metadata: {}\n';
		const result = buildSplitMigrationYaml({
			legacyRaw,
			movieRaw: null,
			showRaw: null,
			classification: classified(legacyRaw, [])
		});

		expect(result.files.movie.proposedContent).toBe('metadata: {}\n');
		expect(result.files.show.proposedContent).toBe('metadata: {}\n');
		expect(result.files.movie.proposedFingerprint).toMatch(/^[0-9a-f]{64}$/);
		expect(result.files.show.proposedFingerprint).toMatch(/^[0-9a-f]{64}$/);
		expect(result.conflicts).toEqual([]);
	});

	it('clones comments and unrelated entry content while re-keying movie/show destinations', () => {
		const legacyRaw = `# legacy document
metadata:
  10:
    # movie poster comment
    url_poster: https://assets.invalid/movie.jpg
    custom_field: keep-me
  20:
    url_poster: https://assets.invalid/show.jpg # show poster comment
    seasons:
      1:
        episodes:
          2:
            url_poster: https://assets.invalid/card.jpg
  30:
    url_background: https://assets.invalid/imdb-show.jpg
`;
		const result = buildSplitMigrationYaml({
			legacyRaw,
			movieRaw: '# typed movie file\ntemplates: { keep: true }\n',
			showRaw: null,
			classification: classified(legacyRaw, [
				mapping({ mediaItemId: 1, type: 'movie', tmdbId: '10' }),
				mapping({ mediaItemId: 2, type: 'show', tmdbId: '20', tvdbId: '200' }),
				mapping({ mediaItemId: 3, type: 'show', tmdbId: '30', imdbId: 'tt0000030' })
			])
		});

		expect(metadataKeys(result.files.movie.proposedContent)).toEqual([10]);
		expect(metadataKeys(result.files.show.proposedContent)).toEqual([200, 'tt0000030']);
		expect(result.files.movie.proposedContent).toContain('# typed movie file');
		expect(result.files.movie.proposedContent).toContain('templates: { keep: true }');
		expect(result.files.movie.proposedContent).toContain('# movie poster comment');
		expect(result.files.movie.proposedContent).toContain('custom_field: keep-me');
		expect(result.files.show.proposedContent).toContain('# show poster comment');
		expect(result.files.show.proposedContent).toContain('episodes:');
		expect(result.files.movie.added).toBe(1);
		expect(result.files.show.added).toBe(2);
		expect(result.conflicts).toEqual([]);

		const publicStructure = JSON.stringify({
			movie: result.files.movie.diff,
			show: result.files.show.diff,
			conflicts: result.conflicts
		});
		expect(publicStructure).not.toContain('https://');
		expect(publicStructure).not.toContain('assets.invalid');
	});

	it('retains an identical existing entry as a no-op', () => {
		const legacyRaw = `metadata:
  10:
    # source comment must not replace the target node
    url_poster: https://assets.invalid/same.jpg
`;
		const movieRaw = `metadata:
  10:
    # target comment stays authoritative
    url_poster: https://assets.invalid/same.jpg
`;
		const result = buildSplitMigrationYaml({
			legacyRaw,
			movieRaw,
			showRaw: 'metadata: {}\n',
			classification: classified(legacyRaw, [
				mapping({ mediaItemId: 1, type: 'movie', tmdbId: '10' })
			])
		});

		expect(result.files.movie.proposedContent).toBe(movieRaw);
		expect(result.files.movie.changed).toBe(false);
		expect(result.files.movie.unchanged).toBe(1);
		expect(result.files.movie.diff[0].operation).toBe('unchanged');
		expect(result.files.movie.proposedContent).toContain('target comment stays authoritative');
		expect(result.files.movie.proposedContent).not.toContain('source comment');
	});

	it('normalizes an identical quoted numeric key to a YAML integer', () => {
		const legacyRaw = 'metadata:\n  10: { url_poster: https://assets.invalid/same.jpg }\n';
		const result = buildSplitMigrationYaml({
			legacyRaw,
			movieRaw: 'metadata:\n  "10": { url_poster: https://assets.invalid/same.jpg }\n',
			showRaw: null,
			classification: classified(legacyRaw, [
				mapping({ mediaItemId: 1, type: 'movie', tmdbId: '10' })
			])
		});

		expect(metadataKeys(result.files.movie.proposedContent)).toEqual([10]);
		expect(result.files.movie.normalizedKeys).toBe(1);
		expect(result.files.movie.diff[0].operation).toBe('normalize_key');
	});

	it('does not overwrite a conflicting typed target entry', () => {
		const legacyRaw = 'metadata:\n  10: { url_poster: https://assets.invalid/new.jpg }\n';
		const movieRaw = 'metadata:\n  10: { url_poster: https://assets.invalid/existing.jpg }\n';
		const result = buildSplitMigrationYaml({
			legacyRaw,
			movieRaw,
			showRaw: null,
			classification: classified(legacyRaw, [
				mapping({ mediaItemId: 1, type: 'movie', tmdbId: '10' })
			])
		});

		expect(result.files.movie.proposedContent).toBe(movieRaw);
		expect(result.files.movie.added).toBe(0);
		expect(result.files.movie.diff).toEqual([]);
		expect(result.conflicts).toHaveLength(1);
		expect(result.conflicts[0]).toMatchObject({
			reason: 'typed_target_conflict',
			path: 'metadata[10]',
			targetFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/)
		});
		expect(JSON.stringify(result.conflicts)).not.toContain('https://');
	});

	it('preflights multiple legacy entries converging on one destination', () => {
		const legacyRaw = `metadata:
  10: { url_poster: https://assets.invalid/a.jpg }
  11: { url_poster: https://assets.invalid/b.jpg }
`;
		const parsed = parseLegacyMetadata(legacyRaw);
		const classification = classifyLegacyEntries({
			parsed,
			mappings: [
				mapping({ mediaItemId: 1, type: 'show', tmdbId: '10', tvdbId: '100' }),
				mapping({ mediaItemId: 1, type: 'show', tmdbId: '11', tvdbId: '100' })
			],
			revisions: []
		});
		const result = buildSplitMigrationYaml({
			legacyRaw,
			movieRaw: null,
			showRaw: null,
			classification
		});

		expect(metadataKeys(result.files.show.proposedContent)).toEqual([]);
		expect(result.conflicts).toHaveLength(1);
		expect(result.conflicts[0].sourceIndexes).toEqual([0, 1]);
		expect(result.conflicts[0].legacyMappingIds).toEqual(['10', '11']);
		expect(result.conflicts[0].entryFingerprint).toBe(
			classification.classified[0].entryFingerprint
		);
	});

	it('rejects a stale/forged classification before producing bytes', () => {
		const legacyRaw = 'metadata:\n  10: { url_poster: https://assets.invalid/a.jpg }\n';
		const classification = classified(legacyRaw, [
			mapping({ mediaItemId: 1, type: 'movie', tmdbId: '10' })
		]);
		classification.classified[0].entryFingerprint = 'f'.repeat(64);

		expect(() =>
			buildSplitMigrationYaml({ legacyRaw, movieRaw: null, showRaw: null, classification })
		).toThrowError(expect.objectContaining({ code: 'migration_classification_stale' }));
	});

	it('fails closed on target aliases and defensive operation/output limits', () => {
		const legacyRaw = 'metadata:\n  10: { url_poster: https://assets.invalid/a.jpg }\n';
		const classification = classified(legacyRaw, [
			mapping({ mediaItemId: 1, type: 'movie', tmdbId: '10' })
		]);
		expect(() =>
			buildSplitMigrationYaml({
				legacyRaw,
				movieRaw: 'metadata:\n  20: &entry { keep: true }\n  21: *entry\n',
				showRaw: null,
				classification
			})
		).toThrowError(expect.objectContaining({ code: 'typed_target_alias_or_anchor_unsupported' }));
		expect(() =>
			buildSplitMigrationYaml({
				legacyRaw,
				movieRaw: null,
				showRaw: null,
				classification,
				limits: { maxOperations: 1, maxOutputBytes: 1 }
			})
		).toThrowError(MigrationYamlBuildError);
	});
});
