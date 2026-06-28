import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { buildMetadataObject, mergeMetadata, toYaml, type KometaItemInput } from './yaml';

describe('buildMetadataObject', () => {
	it('encodes poster-only items under metadata keyed by tmdb id', () => {
		const items: KometaItemInput[] = [
			{ tmdbId: '550', title: 'Fight Club', posterUrl: 'https://example.test/p/550.jpg' }
		];

		const obj = buildMetadataObject(items) as { metadata: Record<string, unknown> };

		expect(obj.metadata['550']).toEqual({ url_poster: 'https://example.test/p/550.jpg' });
		// No background key when none is provided.
		expect(obj.metadata['550']).not.toHaveProperty('url_background');
	});

	it('encodes poster + background', () => {
		const items: KometaItemInput[] = [
			{
				tmdbId: '603',
				title: 'The Matrix',
				posterUrl: 'https://example.test/p/603.jpg',
				backgroundUrl: 'https://example.test/b/603.jpg'
			}
		];

		const obj = buildMetadataObject(items) as { metadata: Record<string, unknown> };

		expect(obj.metadata['603']).toEqual({
			url_poster: 'https://example.test/p/603.jpg',
			url_background: 'https://example.test/b/603.jpg'
		});
	});

	it('omits urls that are null/undefined', () => {
		const items: KometaItemInput[] = [
			{ tmdbId: '1', title: 'No URLs', posterUrl: null, backgroundUrl: undefined }
		];

		const obj = buildMetadataObject(items) as { metadata: Record<string, unknown> };

		expect(obj.metadata['1']).toEqual({});
	});
});

describe('mergeMetadata', () => {
	it('updates an existing tmdb key in place rather than duplicating', () => {
		const existing = {
			metadata: {
				'550': { url_poster: 'https://old.test/550.jpg' }
			}
		};

		const merged = mergeMetadata(existing, [
			{ tmdbId: '550', title: 'Fight Club', posterUrl: 'https://new.test/550.jpg' }
		]) as { metadata: Record<string, unknown> };

		// Exactly one entry for that id, with the new URL.
		expect(Object.keys(merged.metadata)).toEqual(['550']);
		expect(merged.metadata['550']).toEqual({ url_poster: 'https://new.test/550.jpg' });
	});

	it('adds new entries while keeping existing ones', () => {
		const existing = {
			metadata: {
				'550': { url_poster: 'https://example.test/550.jpg' }
			}
		};

		const merged = mergeMetadata(existing, [
			{
				tmdbId: '603',
				title: 'The Matrix',
				posterUrl: 'https://example.test/603.jpg',
				backgroundUrl: 'https://example.test/603-bg.jpg'
			}
		]) as { metadata: Record<string, unknown> };

		expect(Object.keys(merged.metadata).sort()).toEqual(['550', '603']);
		expect(merged.metadata['550']).toEqual({ url_poster: 'https://example.test/550.jpg' });
		expect(merged.metadata['603']).toEqual({
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
			{ tmdbId: '550', title: 'Fight Club', posterUrl: 'https://new.test/550.jpg' }
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
				tmdbId: '1399',
				title: 'GoT',
				seasons: [{ season: 1, posterUrl: 'https://example.test/s1.jpg' }]
			}
		]) as { metadata: Record<string, { url_poster?: string; seasons?: unknown }> };

		// Show poster kept; season added alongside it.
		expect(merged.metadata['1399'].url_poster).toBe('https://example.test/show.jpg');
		expect(merged.metadata['1399'].seasons).toEqual({
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
				tmdbId: '1399',
				title: 'GoT',
				seasons: [{ season: 1, episodes: [{ episode: 2, url: 'https://example.test/s1e2.jpg' }] }]
			}
		]) as { metadata: Record<string, { seasons: Record<number, { episodes: unknown }> }> };

		expect(merged.metadata['1399'].seasons[1].episodes).toEqual({
			1: { url_poster: 'https://example.test/s1e1.jpg' },
			2: { url_poster: 'https://example.test/s1e2.jpg' }
		});
	});

	it('initializes metadata when existing has none', () => {
		const merged = mergeMetadata({}, [
			{ tmdbId: '1', title: 'Solo', posterUrl: 'https://example.test/1.jpg' }
		]) as { metadata: Record<string, unknown> };

		expect(merged.metadata['1']).toEqual({ url_poster: 'https://example.test/1.jpg' });
	});

	it('preserves unrelated top-level keys', () => {
		const existing = { libraries: { Movies: {} }, metadata: {} };

		const merged = mergeMetadata(existing, [
			{ tmdbId: '1', title: 'Solo', posterUrl: 'https://example.test/1.jpg' }
		]) as { libraries: unknown; metadata: Record<string, unknown> };

		expect(merged.libraries).toEqual({ Movies: {} });
		expect(merged.metadata['1']).toEqual({ url_poster: 'https://example.test/1.jpg' });
	});
});

describe('seasons and episodes', () => {
	it('encodes season posters and episode title cards (no season background)', () => {
		const items: KometaItemInput[] = [
			{
				tmdbId: '1399',
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

		const obj = buildMetadataObject(items) as { metadata: Record<string, { seasons: unknown }> };

		expect(obj.metadata['1399']).toEqual({
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
				tmdbId: '1',
				title: 'Show',
				seasons: [{ season: 3, episodes: [{ episode: 5, url: 'https://example.test/s3e5.jpg' }] }]
			}
		]) as { metadata: Record<string, unknown> };

		expect(obj.metadata['1']).toEqual({
			seasons: { 3: { episodes: { 5: { url_poster: 'https://example.test/s3e5.jpg' } } } }
		});
	});

	it('omits the seasons key when no season carries artwork', () => {
		const obj = buildMetadataObject([
			{ tmdbId: '1', title: 'Show', posterUrl: 'https://example.test/p.jpg', seasons: [] }
		]) as { metadata: Record<string, unknown> };

		expect(obj.metadata['1']).toEqual({ url_poster: 'https://example.test/p.jpg' });
	});

	it('round-trips nested seasons through the yaml parser', () => {
		const obj = buildMetadataObject([
			{
				tmdbId: '1399',
				title: 'GoT',
				seasons: [{ season: 1, posterUrl: 'https://example.test/s1.jpg' }]
			}
		]);
		expect(parse(toYaml(obj))).toEqual(obj);
	});
});

describe('toYaml', () => {
	it('round-trips buildMetadataObject output through the yaml parser', () => {
		const items: KometaItemInput[] = [
			{
				tmdbId: '603',
				title: 'The Matrix',
				posterUrl: 'https://example.test/p/603.jpg',
				backgroundUrl: 'https://example.test/b/603.jpg'
			},
			{ tmdbId: '550', title: 'Fight Club', posterUrl: 'https://example.test/p/550.jpg' }
		];

		const obj = buildMetadataObject(items);
		const yaml = toYaml(obj);
		const parsed = parse(yaml);

		expect(parsed).toEqual(obj);
	});
});
