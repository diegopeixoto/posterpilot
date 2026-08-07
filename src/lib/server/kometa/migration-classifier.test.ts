import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import {
	LegacyMetadataParseError,
	classifyLegacyEntries,
	migrationYamlNodeFingerprint,
	parseLegacyMetadata,
	type AuthoritativeKometaMapping,
	type NormalizedLegacyRevisionEvidence
} from './migration-classifier';

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

function classify(
	raw: string,
	mappings: AuthoritativeKometaMapping[],
	revisions: NormalizedLegacyRevisionEvidence[] = []
) {
	const parsed = parseLegacyMetadata(raw);
	return { parsed, result: classifyLegacyEntries({ parsed, mappings, revisions }) };
}

describe('parseLegacyMetadata', () => {
	it('extracts URL-free root, season, and episode leaf fingerprints', () => {
		const parsed = parseLegacyMetadata(`metadata:
  1399:
    url_poster: https://assets.invalid/root.jpg
    url_background: https://assets.invalid/background.jpg
    custom_field:
      keep: https://assets.invalid/unrelated.jpg
    seasons:
      0:
        url_poster: https://assets.invalid/specials.jpg
      1:
        url_background: https://assets.invalid/season-background.jpg
        episodes:
          2:
            url_poster: https://assets.invalid/title-card.jpg
`);

		expect(parsed.entries).toHaveLength(1);
		expect(parsed.entries[0]).toMatchObject({
			legacyMappingId: '1399',
			displayKey: '1399',
			shapeIssues: []
		});
		expect(parsed.entries[0].leaves.map((leaf) => leaf.slotKey)).toEqual([
			'poster:root:root',
			'background:root:root',
			'poster:0:root',
			'background:1:root',
			'title_card:1:2'
		]);
		expect(JSON.stringify(parsed)).not.toContain('https://');
	});

	it('reports unsupported keys and managed shapes without exposing raw values', () => {
		const parsed = parseLegacyMetadata(`metadata:
  "https://secret.invalid/key": scalar-value
  42:
    seasons:
      "01": not-a-map
    url_poster: 123
`);

		expect(parsed.entries[0].legacyMappingId).toBeNull();
		expect(parsed.entries[0].displayKey).toMatch(/^unsupported:[0-9a-f]{12}$/);
		expect(parsed.entries[0].shapeIssues.map((issue) => issue.code)).toEqual([
			'unsupported_legacy_key',
			'entry_not_mapping'
		]);
		expect(parsed.entries[1].shapeIssues.map((issue) => issue.code).sort()).toEqual([
			'managed_index_not_integer',
			'managed_leaf_not_string'
		]);
		expect(JSON.stringify(parsed)).not.toContain('secret.invalid');
		expect(JSON.stringify(parsed)).not.toContain('scalar-value');
	});

	it('marks quoted and unquoted forms of one numeric key as duplicate', () => {
		const parsed = parseLegacyMetadata(`metadata:
  42: { url_poster: https://assets.invalid/a.jpg }
  "42": { url_poster: https://assets.invalid/b.jpg }
`);
		expect(parsed.entries).toHaveLength(2);
		expect(
			parsed.entries.every((entry) => entry.shapeIssues[0]?.code === 'duplicate_legacy_key')
		).toBe(true);
	});

	it('accepts an empty document or root mapping without metadata', () => {
		expect(parseLegacyMetadata('').entries).toEqual([]);
		expect(parseLegacyMetadata('templates: {}\n').entries).toEqual([]);
	});

	it('fails closed on invalid global structure, aliases, and lowered limits', () => {
		expect(() => parseLegacyMetadata('- metadata\n')).toThrowError(
			expect.objectContaining({ code: 'legacy_document_not_mapping' })
		);
		expect(() => parseLegacyMetadata('metadata: []\n')).toThrowError(
			expect.objectContaining({ code: 'legacy_metadata_not_mapping' })
		);
		expect(() =>
			parseLegacyMetadata(`metadata:
  1: &shared { url_poster: https://assets.invalid/a.jpg }
  2: *shared
`)
		).toThrowError(expect.objectContaining({ code: 'legacy_alias_or_anchor_unsupported' }));
		expect(() =>
			parseLegacyMetadata('metadata:\n  1: {}\n  2: {}\n', { maxEntries: 1 })
		).toThrowError(expect.objectContaining({ code: 'legacy_entry_limit_exceeded' }));
		expect(() => parseLegacyMetadata('metadata: {}\n', { maxBytes: 1 })).toThrowError(
			LegacyMetadataParseError
		);
	});

	it('fingerprints Unicode-equivalent map keys independently of source order', () => {
		const composed = '\u00e9';
		const decomposed = 'e\u0301';
		const first = parseDocument(`"${composed}": same\n"${decomposed}": same\n`).contents;
		const reversed = parseDocument(`"${decomposed}": same\n"${composed}": same\n`).contents;

		expect(migrationYamlNodeFingerprint(first)).toBe(migrationYamlNodeFingerprint(reversed));
	});
});

describe('classifyLegacyEntries', () => {
	it('routes movies to TMDB and shows to TVDB from authoritative mappings', () => {
		const { result } = classify(
			`metadata:
  550: { url_poster: https://assets.invalid/movie.jpg }
  1399:
    seasons:
      1: { url_poster: https://assets.invalid/show.jpg }
`,
			[
				mapping({ mediaItemId: 1, type: 'movie', tmdbId: '550', imdbId: 'tt0137523' }),
				mapping({ mediaItemId: 2, type: 'show', tmdbId: '1399', tvdbId: '121361' })
			]
		);

		expect(result.ambiguous).toEqual([]);
		expect(result.classified).toMatchObject([
			{
				legacyMappingId: '550',
				evidence: 'mapping',
				destination: { mediaKind: 'movie', namespace: 'tmdb', mappingId: '550' }
			},
			{
				legacyMappingId: '1399',
				evidence: 'mapping',
				destination: { mediaKind: 'show', namespace: 'tvdb', mappingId: '121361' }
			}
		]);
	});

	it('uses IMDb fallback for either authoritative kind', () => {
		const parsed = parseLegacyMetadata(`metadata:
  10: { url_poster: https://assets.invalid/movie.jpg }
  20: { url_poster: https://assets.invalid/show.jpg }
`);
		const result = classifyLegacyEntries({
			parsed,
			mappings: [
				// Revision provenance can retain the association after the current TMDB ID is cleared.
				mapping({ mediaItemId: 1, type: 'movie', imdbId: 'tt0000001' }),
				mapping({ mediaItemId: 2, type: 'show', tmdbId: '20', imdbId: 'tt0000002' })
			],
			revisions: [
				{
					revisionId: 'revision-movie-imdb',
					mediaItemId: 1,
					legacyMappingId: '10',
					slot: parsed.entries[0].leaves[0].slot,
					proposedFingerprint: parsed.entries[0].leaves[0].fingerprint
				}
			]
		});
		expect(result.classified.map((entry) => entry.destination)).toMatchObject([
			{ mediaKind: 'movie', namespace: 'imdb', mappingId: 'tt0000001' },
			{ mediaKind: 'show', namespace: 'imdb', mappingId: 'tt0000002' }
		]);
	});

	it('never infers show kind from a seasons-shaped entry', () => {
		const { result } = classify(
			`metadata:
  1399:
    seasons:
      1: { url_poster: https://assets.invalid/show.jpg }
`,
			[]
		);
		expect(result.classified).toEqual([]);
		expect(result.ambiguous[0].reason).toBe('no_authoritative_mapping');
	});

	it('reports equal-key movie/show collision and a missing typed identifier', () => {
		const collision = classify('metadata:\n  42: { url_poster: https://assets.invalid/a.jpg }\n', [
			mapping({ mediaItemId: 1, type: 'movie', tmdbId: '42' }),
			mapping({ mediaItemId: 2, type: 'show', tmdbId: '42', tvdbId: '900' })
		]).result;
		expect(collision.ambiguous[0].reason).toBe('multiple_typed_destinations');

		const missing = classify('metadata:\n  42: { url_poster: https://assets.invalid/a.jpg }\n', [
			mapping({ mediaItemId: 2, type: 'show', tmdbId: '42' })
		]).result;
		expect(missing.ambiguous[0].reason).toBe('missing_typed_identifier');
	});

	it('lets exact V1 revision provenance disambiguate a collision', () => {
		const raw = 'metadata:\n  42: { url_poster: https://assets.invalid/current.jpg }\n';
		const parsed = parseLegacyMetadata(raw);
		const leaf = parsed.entries[0].leaves[0];
		const revisions: NormalizedLegacyRevisionEvidence[] = [
			{
				revisionId: 'revision-show',
				mediaItemId: 2,
				legacyMappingId: '42',
				slot: leaf.slot,
				proposedFingerprint: leaf.fingerprint
			}
		];
		const result = classifyLegacyEntries({
			parsed,
			mappings: [
				mapping({ mediaItemId: 1, type: 'movie', tmdbId: '42' }),
				// The current TMDB identity may have changed; the exact V1 revision still binds the item.
				mapping({ mediaItemId: 2, type: 'show', tmdbId: '99', tvdbId: '900' })
			],
			revisions
		});

		expect(result.ambiguous).toEqual([]);
		expect(result.classified[0]).toMatchObject({
			evidence: 'revision',
			destination: { mediaKind: 'show', namespace: 'tvdb', mappingId: '900' }
		});
	});

	it('reports stale revision provenance instead of trusting its old association', () => {
		const parsed = parseLegacyMetadata(
			'metadata:\n  42: { url_poster: https://assets.invalid/current.jpg }\n'
		);
		const result = classifyLegacyEntries({
			parsed,
			mappings: [mapping({ mediaItemId: 2, type: 'show', tmdbId: '99', tvdbId: '900' })],
			revisions: [
				{
					revisionId: 'revision-stale',
					mediaItemId: 2,
					legacyMappingId: '42',
					slot: parsed.entries[0].leaves[0].slot,
					proposedFingerprint: 'a'.repeat(64)
				}
			]
		});
		expect(result.classified).toEqual([]);
		expect(result.ambiguous[0].reason).toBe('revision_no_longer_matches');
	});

	it('reports mixed provenance when different current slots prove different items', () => {
		const parsed = parseLegacyMetadata(`metadata:
  42:
    url_poster: https://assets.invalid/movie.jpg
    url_background: https://assets.invalid/show.jpg
`);
		const [poster, background] = parsed.entries[0].leaves;
		const result = classifyLegacyEntries({
			parsed,
			mappings: [
				mapping({ mediaItemId: 1, type: 'movie', tmdbId: '42' }),
				mapping({ mediaItemId: 2, type: 'show', tmdbId: '42', tvdbId: '900' })
			],
			revisions: [
				{
					revisionId: 'revision-movie',
					mediaItemId: 1,
					legacyMappingId: '42',
					slot: poster.slot,
					proposedFingerprint: poster.fingerprint
				},
				{
					revisionId: 'revision-show',
					mediaItemId: 2,
					legacyMappingId: '42',
					slot: background.slot,
					proposedFingerprint: background.fingerprint
				}
			]
		});
		expect(result.classified).toEqual([]);
		expect(result.ambiguous[0].reason).toBe('mixed_slot_provenance');
	});

	it('produces an order-independent evidence fingerprint and no public URLs', () => {
		const raw = `metadata:
  10: { url_poster: https://assets.invalid/movie.jpg }
  20: { url_poster: https://assets.invalid/show.jpg }
`;
		const parsed = parseLegacyMetadata(raw);
		const mappings = [
			mapping({ mediaItemId: 1, type: 'movie', tmdbId: '10' }),
			mapping({ mediaItemId: 2, type: 'show', tmdbId: '20', tvdbId: '200' })
		];
		const revisions = parsed.entries.map((entry, index) => ({
			revisionId: `revision-${index}`,
			mediaItemId: index + 1,
			legacyMappingId: entry.legacyMappingId!,
			slot: entry.leaves[0].slot,
			proposedFingerprint: entry.leaves[0].fingerprint
		}));
		const first = classifyLegacyEntries({ parsed, mappings, revisions });
		const reordered = classifyLegacyEntries({
			parsed,
			mappings: [...mappings].reverse(),
			revisions: [...revisions].reverse()
		});

		expect(first.evidenceFingerprint).toBe(reordered.evidenceFingerprint);
		expect(first.evidenceFingerprint).toMatch(/^[0-9a-f]{64}$/);
		expect(JSON.stringify(first)).not.toContain('https://');
	});
});
