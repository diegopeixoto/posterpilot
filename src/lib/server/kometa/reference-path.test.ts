import { describe, expect, it } from 'vitest';
import {
	KometaMetadataPathPrefixError,
	kometaMetadataReference,
	kometaMetadataReferenceBasename,
	normalizeKometaMetadataPathPrefix,
	normalizeKometaMetadataReference
} from './reference-path';
import { MOVIE_FILENAME, SHOW_FILENAME } from './destination';

describe('normalizeKometaMetadataPathPrefix', () => {
	it.each([
		['', ''],
		['.', ''],
		['./', ''],
		['.\\', ''],
		['config', 'config'],
		[' ./config/ ', 'config'],
		['.\\config\\metadata\\', 'config/metadata'],
		['dados de mídia/日本語', 'dados de mídia/日本語']
	])('canonicalizes %j to %j', (input, expected) => {
		expect(normalizeKometaMetadataPathPrefix(input)).toBe(expected);
	});

	const unsafePrefixes: [string, KometaMetadataPathPrefixError['code']][] = [
		['/config', 'absolute'],
		['\\config', 'absolute'],
		['//server/config', 'absolute'],
		['\\\\server\\config', 'absolute'],
		['C:\\config', 'absolute'],
		['C:/config', 'absolute'],
		['https://example.com/config', 'url'],
		['../config', 'traversal'],
		['config/../other', 'traversal'],
		['config/./other', 'traversal'],
		['config//other', 'empty_segment'],
		['config///', 'empty_segment'],
		['config\nother', 'control'],
		['config\n', 'control'],
		['config/NUL', 'reserved'],
		['config/com1.txt', 'reserved'],
		['config/bad:name', 'reserved'],
		['config/trailing.', 'reserved'],
		['config/posterpilot-movies.yml', 'filename']
	];

	it.each(unsafePrefixes)('rejects unsafe input %j as %s', (input, code) => {
		expect(() => normalizeKometaMetadataPathPrefix(input)).toThrow(
			expect.objectContaining<Partial<KometaMetadataPathPrefixError>>({ code })
		);
	});

	it('bounds the complete prefix', () => {
		expect(() => normalizeKometaMetadataPathPrefix('a'.repeat(241))).toThrow(
			expect.objectContaining({ code: 'too_long' })
		);
	});
});

describe('Kometa metadata references', () => {
	it('combines only the Kometa-visible prefix and physical basename', () => {
		expect(kometaMetadataReference('config', MOVIE_FILENAME)).toBe(`config/${MOVIE_FILENAME}`);
		expect(kometaMetadataReference('', SHOW_FILENAME)).toBe(SHOW_FILENAME);
	});

	it('normalizes a complete Windows-style reference and enforces the expected basename', () => {
		expect(normalizeKometaMetadataReference(`.\\config\\${MOVIE_FILENAME}`, MOVIE_FILENAME)).toBe(
			`config/${MOVIE_FILENAME}`
		);
		expect(() =>
			normalizeKometaMetadataReference(`config/${SHOW_FILENAME}`, MOVIE_FILENAME)
		).toThrow(expect.objectContaining({ code: 'filename' }));
		expect(() =>
			normalizeKometaMetadataReference(`config//${MOVIE_FILENAME}`, MOVIE_FILENAME)
		).toThrow(expect.objectContaining({ code: 'empty_segment' }));
	});

	it('classifies existing references by basename without treating the prefix as a local path', () => {
		expect(kometaMetadataReferenceBasename(`config/${MOVIE_FILENAME}`)).toBe(MOVIE_FILENAME);
		expect(kometaMetadataReferenceBasename(`config\\${SHOW_FILENAME}`)).toBe(SHOW_FILENAME);
		expect(kometaMetadataReferenceBasename('config/')).toBeNull();
	});
});
