import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isMap, isScalar, parse, parseDocument } from 'yaml';
import {
	LEGACY_FILENAME,
	MOVIE_FILENAME,
	SHOW_FILENAME,
	resolveKometaDestination,
	type KometaDestinationV2
} from './destination';
import {
	buildMetadataObject,
	mergeMetadata,
	toYaml,
	writeKometaYaml,
	type KometaItemInput
} from './yaml';

function destination(
	type: 'movie' | 'show',
	mappingId: string,
	namespace: 'preferred' | 'imdb' = 'preferred'
): KometaDestinationV2 {
	const result = resolveKometaDestination(
		type === 'movie'
			? {
					type,
					tmdbId: namespace === 'preferred' ? mappingId : null,
					imdbId: namespace === 'imdb' ? mappingId : null
				}
			: {
					type,
					tvdbId: namespace === 'preferred' ? mappingId : null,
					imdbId: namespace === 'imdb' ? mappingId : null
				}
	);
	if (!result.ok) throw new TypeError('Invalid test destination');
	return result.destination;
}

const movieDestination = (id: string) => destination('movie', id);
const showDestination = (id: string) => destination('show', id);
const imdbMovieDestination = (id: string) => destination('movie', id, 'imdb');

describe('buildMetadataObject', () => {
	it('encodes poster-only items under metadata keyed by tmdb id', () => {
		const items: KometaItemInput[] = [
			{
				destination: movieDestination('550'),
				title: 'Fight Club',
				posterUrl: 'https://example.test/p/550.jpg'
			}
		];

		const obj = buildMetadataObject(items);

		expect(obj.metadata.get(550)).toEqual({ url_poster: 'https://example.test/p/550.jpg' });
		// No background key when none is provided.
		expect(obj.metadata.get(550)).not.toHaveProperty('url_background');
	});

	it('encodes poster + background', () => {
		const items: KometaItemInput[] = [
			{
				destination: movieDestination('603'),
				title: 'The Matrix',
				posterUrl: 'https://example.test/p/603.jpg',
				backgroundUrl: 'https://example.test/b/603.jpg'
			}
		];

		const obj = buildMetadataObject(items);

		expect(obj.metadata.get(603)).toEqual({
			url_poster: 'https://example.test/p/603.jpg',
			url_background: 'https://example.test/b/603.jpg'
		});
	});

	it('omits urls that are null/undefined', () => {
		const items: KometaItemInput[] = [
			{
				destination: movieDestination('1'),
				title: 'No URLs',
				posterUrl: null,
				backgroundUrl: undefined
			}
		];

		const obj = buildMetadataObject(items);

		expect(obj.metadata.get(1)).toEqual({});
	});
});

describe('mergeMetadata', () => {
	it('rejects logically duplicate keys in an existing metadata Map', () => {
		const metadata = new Map<string | number, { url_poster: string }>([
			[550, { url_poster: 'https://example.test/first.jpg' }],
			['550', { url_poster: 'https://example.test/second.jpg' }]
		]);
		const existing = { metadata };

		expect(() =>
			mergeMetadata(existing, [
				{
					destination: movieDestination('550'),
					title: 'Fight Club',
					posterUrl: 'https://example.test/new.jpg'
				}
			])
		).toThrow('Ambiguous existing Kometa YAML keys');
		expect([...metadata.keys()]).toEqual([550, '550']);
	});

	it('updates an existing tmdb key in place rather than duplicating', () => {
		const existing = {
			metadata: {
				'550': { url_poster: 'https://old.test/550.jpg' }
			}
		};

		const merged = mergeMetadata(existing, [
			{
				destination: movieDestination('550'),
				title: 'Fight Club',
				posterUrl: 'https://new.test/550.jpg'
			}
		]);

		// Exactly one entry for that id, with the new URL.
		expect([...merged.metadata.keys()]).toEqual([550]);
		expect(merged.metadata.get(550)).toEqual({ url_poster: 'https://new.test/550.jpg' });
	});

	it('adds new entries while keeping existing ones', () => {
		const existing = {
			metadata: {
				'550': { url_poster: 'https://example.test/550.jpg' }
			}
		};

		const merged = mergeMetadata(existing, [
			{
				destination: movieDestination('603'),
				title: 'The Matrix',
				posterUrl: 'https://example.test/603.jpg',
				backgroundUrl: 'https://example.test/603-bg.jpg'
			}
		]);

		expect([...merged.metadata.keys()].sort()).toEqual([550, 603]);
		expect(merged.metadata.get(550)).toEqual({ url_poster: 'https://example.test/550.jpg' });
		expect(merged.metadata.get(603)).toEqual({
			url_poster: 'https://example.test/603.jpg',
			url_background: 'https://example.test/603-bg.jpg'
		});
	});

	it('does not mutate the existing object', () => {
		const existing = {
			metadata: {
				'550': { url_poster: 'https://old.test/550.jpg' }
			}
		};

		mergeMetadata(existing, [
			{
				destination: movieDestination('550'),
				title: 'Fight Club',
				posterUrl: 'https://new.test/550.jpg'
			}
		]);

		expect(existing.metadata['550']).toEqual({ url_poster: 'https://old.test/550.jpg' });
	});

	it('preserves an existing show poster when a granular-only apply adds seasons', () => {
		const existing = {
			metadata: {
				'1399': { url_poster: 'https://example.test/show.jpg' }
			}
		};

		const merged = mergeMetadata(existing, [
			{
				destination: showDestination('1399'),
				title: 'GoT',
				seasons: [{ season: 1, posterUrl: 'https://example.test/s1.jpg' }]
			}
		]);

		// Show poster kept; season added alongside it.
		expect(merged.metadata.get(1399)?.url_poster).toBe('https://example.test/show.jpg');
		expect(merged.metadata.get(1399)?.seasons).toEqual({
			1: { url_poster: 'https://example.test/s1.jpg' }
		});
	});

	it('merges season episodes across applies rather than replacing the season', () => {
		const existing = {
			metadata: {
				'1399': {
					seasons: { 1: { episodes: { 1: { url_poster: 'https://example.test/s1e1.jpg' } } } }
				}
			}
		};

		const merged = mergeMetadata(existing, [
			{
				destination: showDestination('1399'),
				title: 'GoT',
				seasons: [{ season: 1, episodes: [{ episode: 2, url: 'https://example.test/s1e2.jpg' }] }]
			}
		]);

		expect(merged.metadata.get(1399)?.seasons?.[1].episodes).toEqual({
			1: { url_poster: 'https://example.test/s1e1.jpg' },
			2: { url_poster: 'https://example.test/s1e2.jpg' }
		});
	});

	it('initializes metadata when existing has none', () => {
		const merged = mergeMetadata({}, [
			{
				destination: movieDestination('1'),
				title: 'Solo',
				posterUrl: 'https://example.test/1.jpg'
			}
		]);

		expect(merged.metadata.get(1)).toEqual({ url_poster: 'https://example.test/1.jpg' });
	});

	it('preserves unrelated top-level keys', () => {
		const existing = { libraries: { Movies: {} }, metadata: {} };

		const merged = mergeMetadata(existing, [
			{
				destination: movieDestination('1'),
				title: 'Solo',
				posterUrl: 'https://example.test/1.jpg'
			}
		]);

		expect(merged.libraries).toEqual({ Movies: {} });
		expect(merged.metadata.get(1)).toEqual({ url_poster: 'https://example.test/1.jpg' });
	});
});

describe('seasons and episodes', () => {
	it('encodes season posters and episode title cards (no season background)', () => {
		const items: KometaItemInput[] = [
			{
				destination: showDestination('1399'),
				title: 'Game of Thrones',
				posterUrl: 'https://example.test/p/show.jpg',
				seasons: [
					{
						season: 1,
						posterUrl: 'https://example.test/s1.jpg',
						episodes: [
							{ episode: 1, url: 'https://example.test/s1e1.jpg' },
							{ episode: 2, url: 'https://example.test/s1e2.jpg' }
						]
					},
					{ season: 2, posterUrl: 'https://example.test/s2.jpg' }
				]
			}
		];

		const obj = buildMetadataObject(items);

		expect(obj.metadata.get(1399)).toEqual({
			url_poster: 'https://example.test/p/show.jpg',
			seasons: {
				1: {
					url_poster: 'https://example.test/s1.jpg',
					episodes: {
						1: { url_poster: 'https://example.test/s1e1.jpg' },
						2: { url_poster: 'https://example.test/s1e2.jpg' }
					}
				},
				2: { url_poster: 'https://example.test/s2.jpg' }
			}
		});
	});

	it('emits an episodes-only season (no season poster)', () => {
		const obj = buildMetadataObject([
			{
				destination: showDestination('1'),
				title: 'Show',
				seasons: [{ season: 3, episodes: [{ episode: 5, url: 'https://example.test/s3e5.jpg' }] }]
			}
		]);

		expect(obj.metadata.get(1)).toEqual({
			seasons: { 3: { episodes: { 5: { url_poster: 'https://example.test/s3e5.jpg' } } } }
		});
	});

	it('omits the seasons key when no season carries artwork', () => {
		const obj = buildMetadataObject([
			{
				destination: showDestination('1'),
				title: 'Show',
				posterUrl: 'https://example.test/p.jpg',
				seasons: []
			}
		]);

		expect(obj.metadata.get(1)).toEqual({ url_poster: 'https://example.test/p.jpg' });
	});

	it('round-trips nested seasons through the yaml parser', () => {
		const obj = buildMetadataObject([
			{
				destination: showDestination('1399'),
				title: 'GoT',
				seasons: [{ season: 1, posterUrl: 'https://example.test/s1.jpg' }]
			}
		]);
		expect(parse(toYaml(obj))).toEqual({
			metadata: {
				1399: { seasons: { 1: { url_poster: 'https://example.test/s1.jpg' } } }
			}
		});
	});
});

describe('toYaml', () => {
	it('round-trips output with numeric provider keys encoded as YAML integers', () => {
		const items: KometaItemInput[] = [
			{
				destination: movieDestination('603'),
				title: 'The Matrix',
				posterUrl: 'https://example.test/p/603.jpg',
				backgroundUrl: 'https://example.test/b/603.jpg'
			},
			{
				destination: movieDestination('550'),
				title: 'Fight Club',
				posterUrl: 'https://example.test/p/550.jpg'
			}
		];

		const obj = buildMetadataObject(items);
		const yaml = toYaml(obj);
		const parsed = parse(yaml);

		expect(parsed).toEqual({
			metadata: {
				603: {
					url_poster: 'https://example.test/p/603.jpg',
					url_background: 'https://example.test/b/603.jpg'
				},
				550: { url_poster: 'https://example.test/p/550.jpg' }
			}
		});
		expect(yaml).toMatch(/^ {2}603:/m);
		expect(yaml).not.toContain('"603":');
	});
});

describe('writeKometaYaml', () => {
	const dir = join(tmpdir(), `posterpilot-kometa-yaml-${process.pid}`);
	const movieFile = join(dir, MOVIE_FILENAME);
	const showFile = join(dir, SHOW_FILENAME);
	const legacyFile = join(dir, LEGACY_FILENAME);
	const escapedFile = join(tmpdir(), `posterpilot-kometa-escape-${process.pid}.yml`);

	beforeEach(() => {
		rmSync(dir, { recursive: true, force: true });
		rmSync(escapedFile, { force: true });
		mkdirSync(dir, { recursive: true });
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
		rmSync(escapedFile, { force: true });
	});

	it('atomically merges an existing file and preserves its comments', async () => {
		const original = [
			'# Hand-maintained Kometa metadata',
			'libraries:',
			'  Movies: {} # keep library settings',
			'metadata:',
			'  # Existing title',
			'  "603":',
			'    url_poster: https://old.test/603.jpg # keep poster note',
			'    custom_field: keep-me',
			''
		].join('\n');
		writeFileSync(movieFile, original, 'utf8');

		await writeKometaYaml(dir, [
			{
				destination: movieDestination('603'),
				title: 'The Matrix',
				posterUrl: 'https://new.test/603.jpg',
				backgroundUrl: 'https://new.test/603-bg.jpg'
			}
		]);

		const written = readFileSync(movieFile, 'utf8');
		expect(written).toContain('# Hand-maintained Kometa metadata');
		expect(written).toContain('# keep library settings');
		expect(written).toContain('# Existing title');
		expect(written).toContain('# keep poster note');
		expect(written).toMatch(/^ {2}603:/m);
		expect(written).not.toContain('"603":');
		expect(parse(written)).toEqual({
			libraries: { Movies: {} },
			metadata: {
				603: {
					url_poster: 'https://new.test/603.jpg',
					custom_field: 'keep-me',
					url_background: 'https://new.test/603-bg.jpg'
				}
			}
		});

		const entries = readdirSync(dir);
		expect(entries.some((name) => name.includes('.posterpilot-bak-'))).toBe(true);
		expect(entries.some((name) => name.includes('.tmp-'))).toBe(false);
	});

	it('serializes concurrent read-modify-write calls without losing either item', async () => {
		await Promise.all([
			writeKometaYaml(dir, [
				{
					destination: movieDestination('550'),
					title: 'Fight Club',
					posterUrl: 'https://example.test/550.jpg'
				}
			]),
			writeKometaYaml(dir, [
				{
					destination: movieDestination('603'),
					title: 'The Matrix',
					posterUrl: 'https://example.test/603.jpg'
				}
			])
		]);

		const result = parse(readFileSync(movieFile, 'utf8')) as {
			metadata: Record<string, { url_poster: string }>;
		};
		expect(result.metadata['550'].url_poster).toBe('https://example.test/550.jpg');
		expect(result.metadata['603'].url_poster).toBe('https://example.test/603.jpg');
	});

	it('does not include credential-bearing source text in parse errors', async () => {
		const credential = 'do-not-leak-this-token';
		const malformed = `plex_token: ${credential}\nmetadata: [\n`;
		writeFileSync(movieFile, malformed, 'utf8');

		const error = await writeKometaYaml(dir, [
			{
				destination: movieDestination('550'),
				title: 'Fight Club',
				posterUrl: 'https://example.test/550.jpg'
			}
		]).then(
			() => null,
			(reason: unknown) => reason
		);

		expect(error).toBeInstanceOf(Error);
		expect(String(error)).toContain('Invalid existing Kometa YAML');
		expect(String(error)).not.toContain(credential);
		expect(readFileSync(movieFile, 'utf8')).toBe(malformed);
	});

	it.each([
		{
			name: 'metadata ids',
			raw: [
				'metadata:',
				'  550:',
				'    url_poster: first.jpg',
				'  "550":',
				'    url_poster: second.jpg',
				''
			].join('\n'),
			item: {
				destination: movieDestination('550'),
				title: 'Fight Club',
				posterUrl: 'https://example.test/new.jpg'
			} satisfies KometaItemInput
		},
		{
			name: 'season ids',
			raw: [
				'metadata:',
				'  550:',
				'    seasons:',
				'      1:',
				'        url_poster: first.jpg',
				'      "1":',
				'        url_poster: second.jpg',
				''
			].join('\n'),
			item: {
				destination: movieDestination('550'),
				title: 'Fight Club',
				seasons: [{ season: 1, posterUrl: 'https://example.test/new.jpg' }]
			} satisfies KometaItemInput
		}
	])('rejects logically duplicate $name without changing the file', async ({ raw, item }) => {
		writeFileSync(movieFile, raw, 'utf8');

		await expect(writeKometaYaml(dir, [item])).rejects.toThrow(
			'Ambiguous existing Kometa YAML keys'
		);
		expect(readFileSync(movieFile, 'utf8')).toBe(raw);
	});

	it.each([
		['root', 'keep-this-root\n'],
		['metadata', 'metadata: keep-this-metadata\n'],
		['item', 'metadata:\n  550: [keep-this-item]\n'],
		['seasons', 'metadata:\n  550:\n    seasons: [keep-these-seasons]\n']
	])('rejects an incompatible managed %s node without changing the file', async (_label, raw) => {
		writeFileSync(movieFile, raw, 'utf8');

		await expect(
			writeKometaYaml(dir, [
				{
					destination: movieDestination('550'),
					title: 'Fight Club',
					posterUrl: 'https://example.test/new.jpg'
				}
			])
		).rejects.toThrow(/not a mapping/);
		expect(readFileSync(movieFile, 'utf8')).toBe(raw);
	});

	it('promotes an explicit YAML null root to managed mappings', async () => {
		writeFileSync(movieFile, 'null\n', 'utf8');

		await writeKometaYaml(dir, [
			{
				destination: movieDestination('550'),
				title: 'Fight Club',
				posterUrl: 'https://example.test/new.jpg'
			}
		]);

		expect(parse(readFileSync(movieFile, 'utf8'))).toEqual({
			metadata: { 550: { url_poster: 'https://example.test/new.jpg' } }
		});
	});

	it('rechecks cancellation after async validation and before merge or write', async () => {
		const original = 'metadata: {}\n';
		writeFileSync(movieFile, original, 'utf8');
		let cancelled = false;

		await expect(
			writeKometaYaml(
				dir,
				[
					{
						destination: movieDestination('550'),
						title: 'Fight Club',
						posterUrl: 'https://example.test/new.jpg'
					}
				],
				{
					validateCurrent: async () => {
						queueMicrotask(() => {
							cancelled = true;
						});
					},
					isCancelled: () => cancelled
				}
			)
		).rejects.toThrow('cancelled');
		expect(readFileSync(movieFile, 'utf8')).toBe(original);
	});

	it('isolates equal numeric movie and show identifiers in separate files', async () => {
		await Promise.all([
			writeKometaYaml(dir, [
				{
					destination: movieDestination('42'),
					title: 'Movie 42',
					posterUrl: 'https://example.test/movie-42.jpg'
				}
			]),
			writeKometaYaml(dir, [
				{
					destination: showDestination('42'),
					title: 'Show 42',
					posterUrl: 'https://example.test/show-42.jpg'
				}
			])
		]);

		expect(parse(readFileSync(movieFile, 'utf8'))).toEqual({
			metadata: { 42: { url_poster: 'https://example.test/movie-42.jpg' } }
		});
		expect(parse(readFileSync(showFile, 'utf8'))).toEqual({
			metadata: { 42: { url_poster: 'https://example.test/show-42.jpg' } }
		});
	});

	it('writes numeric provider keys as integer scalars and IMDb keys as strings', async () => {
		await writeKometaYaml(dir, [
			{
				destination: movieDestination('603'),
				title: 'The Matrix',
				posterUrl: 'https://example.test/603.jpg'
			},
			{
				destination: imdbMovieDestination('tt0137523'),
				title: 'Fight Club',
				posterUrl: 'https://example.test/fight-club.jpg'
			}
		]);

		const document = parseDocument(readFileSync(movieFile, 'utf8'));
		expect(isMap(document.contents)).toBe(true);
		if (!isMap(document.contents)) throw new TypeError('Expected YAML root map');
		const metadataPair = document.contents.items.find(
			(pair) => isScalar(pair.key) && pair.key.value === 'metadata'
		);
		expect(isMap(metadataPair?.value)).toBe(true);
		if (!isMap(metadataPair?.value)) throw new TypeError('Expected YAML metadata map');
		const keys = metadataPair.value.items.map((pair) => {
			expect(isScalar(pair.key)).toBe(true);
			return isScalar(pair.key) ? pair.key.value : null;
		});
		expect(keys).toContain(603);
		expect(keys).toContain('tt0137523');
	});

	it('never touches the legacy mixed-kind file during a typed write', async () => {
		const legacy = '# user-owned legacy metadata\nmetadata: {}\n';
		writeFileSync(legacyFile, legacy, 'utf8');

		await writeKometaYaml(dir, [
			{
				destination: movieDestination('550'),
				title: 'Fight Club',
				posterUrl: 'https://example.test/550.jpg'
			}
		]);

		expect(readFileSync(legacyFile, 'utf8')).toBe(legacy);
		expect(existsSync(movieFile)).toBe(true);
		expect(existsSync(showFile)).toBe(false);
	});

	it('awaits final async validation before performing the atomic write', async () => {
		let validationStarted!: () => void;
		const started = new Promise<void>((resolve) => (validationStarted = resolve));
		let resumeValidation!: () => void;
		const paused = new Promise<void>((resolve) => (resumeValidation = resolve));
		const pending = writeKometaYaml(
			dir,
			[
				{
					destination: movieDestination('550'),
					title: 'Fight Club',
					posterUrl: 'https://example.test/550.jpg'
				}
			],
			{
				validateCurrent: async () => {
					validationStarted();
					await paused;
				}
			}
		);

		await started;
		expect(existsSync(movieFile)).toBe(false);
		resumeValidation();
		await pending;
		expect(existsSync(movieFile)).toBe(true);
	});

	it('fails closed when commit ownership is lost after current-file validation', async () => {
		const original = 'metadata: {}\n';
		writeFileSync(movieFile, original, 'utf8');
		const order: string[] = [];
		let ownershipChecks = 0;

		await expect(
			writeKometaYaml(
				dir,
				[
					{
						destination: movieDestination('550'),
						title: 'Fight Club',
						posterUrl: 'https://example.test/550.jpg'
					}
				],
				{
					validateCurrent: async () => {
						await Promise.resolve();
						order.push('validate');
					},
					assertCommitOwned: async () => {
						ownershipChecks++;
						if (ownershipChecks === 1) return;
						order.push('assert-owned');
						throw new Error('migration control lease lost');
					}
				}
			)
		).rejects.toThrow('migration control lease lost');

		expect(order).toEqual(['validate', 'assert-owned']);
		expect(readFileSync(movieFile, 'utf8')).toBe(original);
	});

	it('does not recover a quarantine after commit ownership was already lost', async () => {
		const quarantine = join(dir, `.${MOVIE_FILENAME}.posterpilot-cas-quarantine`);
		const predecessor = 'metadata: {}\n';
		writeFileSync(quarantine, predecessor, 'utf8');

		await expect(
			writeKometaYaml(
				dir,
				[
					{
						destination: movieDestination('550'),
						title: 'Fight Club',
						posterUrl: 'https://example.test/550.jpg'
					}
				],
				{
					assertCommitOwned: async () => {
						throw new Error('migration control lease lost');
					}
				}
			)
		).rejects.toThrow('migration control lease lost');

		expect(existsSync(movieFile)).toBe(false);
		expect(readFileSync(quarantine, 'utf8')).toBe(predecessor);
	});

	it('preserves an external edit that lands between validation and bound publication', async () => {
		const original = 'metadata: {}\n';
		const external = 'metadata:\n  external: { url_poster: https://external.test/edit.jpg }\n';
		writeFileSync(movieFile, original, 'utf8');
		let ownershipChecks = 0;

		await expect(
			writeKometaYaml(
				dir,
				[
					{
						destination: movieDestination('550'),
						title: 'Fight Club',
						posterUrl: 'https://example.test/550.jpg'
					}
				],
				{
					validateCurrent: (raw) => expect(raw).toBe(original),
					assertCommitOwned: async () => {
						ownershipChecks++;
						if (ownershipChecks === 2) writeFileSync(movieFile, external, 'utf8');
					}
				}
			)
		).rejects.toThrow();

		expect(readFileSync(movieFile, 'utf8')).toBe(external);
		expect(readdirSync(dir).some((entry) => entry.includes('.posterpilot-bak-'))).toBe(false);
	});

	it('keeps a repointed alias on its external target after freezing the original file', async () => {
		const managed = join(dir, 'managed-movies.yml');
		const external = join(dir, 'external-movies.yml');
		const original = 'metadata: {}\n';
		const externalEdit = 'metadata:\n  external: { url_poster: https://external.test/edit.jpg }\n';
		writeFileSync(managed, original, 'utf8');
		writeFileSync(external, externalEdit, 'utf8');
		symlinkSync(managed, movieFile);
		let ownershipChecks = 0;

		await writeKometaYaml(
			dir,
			[
				{
					destination: movieDestination('550'),
					title: 'Fight Club',
					posterUrl: 'https://example.test/550.jpg'
				}
			],
			{
				validateCurrent: (raw) => expect(raw).toBe(original),
				assertCommitOwned: async () => {
					ownershipChecks++;
					if (ownershipChecks === 2) {
						unlinkSync(movieFile);
						symlinkSync(external, movieFile);
					}
				}
			}
		);

		expect(parse(readFileSync(managed, 'utf8'))).toEqual({
			metadata: { 550: { url_poster: 'https://example.test/550.jpg' } }
		});
		expect(readFileSync(movieFile, 'utf8')).toBe(externalEdit);
		expect(readFileSync(external, 'utf8')).toBe(externalEdit);
	});

	it('creates a new typed file when its frozen nested parent does not exist yet', async () => {
		const nested = join(dir, 'future', 'nested');

		await writeKometaYaml(nested, [
			{
				destination: movieDestination('550'),
				title: 'Fight Club',
				posterUrl: 'https://example.test/550.jpg'
			}
		]);

		expect(parse(readFileSync(join(nested, MOVIE_FILENAME), 'utf8'))).toEqual({
			metadata: { 550: { url_poster: 'https://example.test/550.jpg' } }
		});
	});

	it('rejects mixed split destinations before creating either file', async () => {
		await expect(
			writeKometaYaml(dir, [
				{ destination: movieDestination('42'), title: 'Movie 42' },
				{ destination: showDestination('42'), title: 'Show 42' }
			])
		).rejects.toThrow('cannot mix metadata files');
		expect(existsSync(movieFile)).toBe(false);
		expect(existsSync(showFile)).toBe(false);
	});

	it('rejects explicit legacy destinations rather than default-writing them', async () => {
		const legacyDestination = {
			version: 1,
			filename: LEGACY_FILENAME,
			namespace: 'tmdb',
			mappingId: '550',
			key: `kometa:v1:legacy:tmdb:550:${LEGACY_FILENAME}`
		} as unknown as KometaDestinationV2;

		await expect(
			writeKometaYaml(dir, [{ destination: legacyDestination, title: 'Legacy item' }])
		).rejects.toThrow('Invalid Kometa destination');
		expect(existsSync(legacyFile)).toBe(false);
	});

	it('rejects forged filenames before path resolution or filesystem access', async () => {
		const forged = {
			...movieDestination('550'),
			filename: `../${escapedFile.split('/').at(-1)}`,
			key: `kometa:v2:movie:tmdb:550:../${escapedFile.split('/').at(-1)}`
		} as unknown as KometaDestinationV2;

		await expect(writeKometaYaml(dir, [{ destination: forged, title: 'Forged' }])).rejects.toThrow(
			'Invalid Kometa destination'
		);
		expect(existsSync(escapedFile)).toBe(false);
	});

	it('rejects an empty write without creating a default file', async () => {
		await expect(writeKometaYaml(dir, [])).rejects.toThrow('requires at least one typed item');
		expect(readdirSync(dir)).toEqual([]);
	});
});
