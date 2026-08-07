import { describe, expect, it } from 'vitest';
import {
	LEGACY_FILENAME,
	MOVIE_FILENAME,
	SHOW_FILENAME,
	isCanonicalKometaImdbId,
	isCanonicalKometaNumericId,
	isKometaDestinationV2,
	isKometaLegacyDestinationV1,
	kometaYamlMappingKey,
	legacyKometaDestinationKey,
	parseKometaDestinationKey,
	parseKometaLegacyDestinationKey,
	resolveKometaDestination
} from './destination';

describe('resolveKometaDestination', () => {
	it('uses TMDb for movies before the IMDb fallback', () => {
		expect(
			resolveKometaDestination({
				type: 'movie',
				tmdbId: '550',
				tvdbId: '999',
				imdbId: 'tt0137523'
			})
		).toEqual({
			ok: true,
			destination: {
				version: 2,
				mediaKind: 'movie',
				namespace: 'tmdb',
				mappingId: '550',
				filename: MOVIE_FILENAME,
				key: `kometa:v2:movie:tmdb:550:${MOVIE_FILENAME}`
			}
		});
	});

	it('uses TVDb for shows even when provider/TMDb identity disagrees', () => {
		const input = {
			type: 'show' as const,
			tmdbId: '42',
			tvdbId: '121361',
			imdbId: 'tt0944947',
			mediaType: 'movie'
		};
		expect(resolveKometaDestination(input)).toEqual({
			ok: true,
			destination: {
				version: 2,
				mediaKind: 'show',
				namespace: 'tvdb',
				mappingId: '121361',
				filename: SHOW_FILENAME,
				key: `kometa:v2:show:tvdb:121361:${SHOW_FILENAME}`
			}
		});
	});

	it.each([
		['movie', { tmdbId: null, imdbId: 'tt0111161' }, MOVIE_FILENAME],
		['show', { tvdbId: null, imdbId: 'tt0944947' }, SHOW_FILENAME]
	] as const)('uses IMDb as the %s fallback', (type, ids, filename) => {
		const result = resolveKometaDestination({ type, ...ids });
		expect(result).toMatchObject({
			ok: true,
			destination: { mediaKind: type, namespace: 'imdb', filename }
		});
	});

	it('keeps equal movie TMDb and show TVDb numbers in distinct identities', () => {
		const movie = resolveKometaDestination({ type: 'movie', tmdbId: '42' });
		const show = resolveKometaDestination({ type: 'show', tvdbId: '42' });
		expect(movie.ok && movie.destination.key).toBe(`kometa:v2:movie:tmdb:42:${MOVIE_FILENAME}`);
		expect(show.ok && show.destination.key).toBe(`kometa:v2:show:tvdb:42:${SHOW_FILENAME}`);
	});

	it('falls back when a preferred identifier is non-canonical', () => {
		const result = resolveKometaDestination({
			type: 'movie',
			tmdbId: '0550',
			imdbId: 'tt0137523'
		});
		expect(result).toMatchObject({ ok: true, destination: { namespace: 'imdb' } });
	});

	it.each([
		{ type: 'movie' as const, tmdbId: null, imdbId: null },
		{ type: 'show' as const, tmdbId: '1399', tvdbId: null, imdbId: null },
		{ type: 'movie' as const, tmdbId: '0', imdbId: 'TT0137523' },
		{ type: 'show' as const, tvdbId: '1.5', imdbId: 'tt123' }
	])('returns an explicit missing outcome for unsupported identity %#', (input) => {
		expect(resolveKometaDestination(input)).toEqual({
			ok: false,
			reason: 'missing_kometa_identifier'
		});
	});
});

describe('strict identifier validation', () => {
	it.each(['1', '550', String(Number.MAX_SAFE_INTEGER)])(
		'accepts canonical numeric ID %s',
		(id) => {
			expect(isCanonicalKometaNumericId(id)).toBe(true);
		}
	);

	it.each(['', '0', '-1', '+1', '01', '1.0', ' 1', '1 ', '9007199254740992'])(
		'rejects non-canonical numeric ID %s',
		(id) => expect(isCanonicalKometaNumericId(id)).toBe(false)
	);

	it.each(['tt0000001', 'tt0137523', 'tt12345678'])('accepts canonical IMDb ID %s', (id) => {
		expect(isCanonicalKometaImdbId(id)).toBe(true);
	});

	it.each(['', '0137523', 'TT0137523', 'tt123', 'tt123456x', ' tt0137523'])(
		'rejects non-canonical IMDb ID %s',
		(id) => expect(isCanonicalKometaImdbId(id)).toBe(false)
	);
});

describe('destination guards and key parsers', () => {
	it('round-trips V2 keys and emits the scalar type Kometa expects', () => {
		const movie = parseKometaDestinationKey(`kometa:v2:movie:tmdb:550:${MOVIE_FILENAME}`);
		const showImdb = parseKometaDestinationKey(`kometa:v2:show:imdb:tt0944947:${SHOW_FILENAME}`);
		expect(isKometaDestinationV2(movie)).toBe(true);
		expect(kometaYamlMappingKey(movie!)).toBe(550);
		expect(kometaYamlMappingKey(showImdb!)).toBe('tt0944947');
	});

	it.each([
		`kometa:v2:show:tmdb:42:${SHOW_FILENAME}`,
		`kometa:v2:movie:tvdb:42:${MOVIE_FILENAME}`,
		`kometa:v2:movie:tmdb:42:${SHOW_FILENAME}`,
		`kometa:v2:movie:tmdb:042:${MOVIE_FILENAME}`,
		`kometa:v2:movie:imdb:TT0137523:${MOVIE_FILENAME}`,
		`kometa:v3:movie:tmdb:42:${MOVIE_FILENAME}`,
		`kometa:v2:movie:tmdb:42:${MOVIE_FILENAME}:extra`
	])('rejects an invalid or internally inconsistent V2 key: %s', (key) => {
		expect(parseKometaDestinationKey(key)).toBeNull();
	});

	it('round-trips only explicit legacy destinations', () => {
		const key = legacyKometaDestinationKey('550');
		const legacy = parseKometaLegacyDestinationKey(key);
		expect(legacy).toEqual({
			version: 1,
			filename: LEGACY_FILENAME,
			namespace: 'tmdb',
			mappingId: '550',
			key
		});
		expect(isKometaLegacyDestinationV1(legacy)).toBe(true);
		expect(parseKometaLegacyDestinationKey('550')).toBeNull();
		expect(
			parseKometaLegacyDestinationKey(`kometa:v1:legacy:tmdb:0550:${LEGACY_FILENAME}`)
		).toBeNull();
	});
});
