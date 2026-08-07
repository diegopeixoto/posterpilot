import { describe, expect, it } from 'vitest';
import { classifyKometaLegacyConfig, isLegacyKometaMetadataReference } from './legacy-layout';

describe('Kometa legacy layout classification', () => {
	it.each([
		'posterpilot.yml',
		'config/posterpilot.yml',
		'.\\config\\posterpilot.yml',
		'  /mounted/config/posterpilot.yml  '
	])('recognizes a legacy reference by basename: %s', (reference) => {
		expect(isLegacyKometaMetadataReference(reference)).toBe(true);
	});

	it('reports exact libraries without treating split files as legacy', () => {
		expect(
			classifyKometaLegacyConfig(`libraries:
  Movies:
    metadata_files:
      - file: config/posterpilot.yml
      - file: posterpilot-movies.yml
  Shows:
    metadata_files:
      - file: posterpilot-shows.yml
`)
		).toEqual({ known: true, references: ['Movies'] });
	});

	it.each(['libraries: []\n', 'libraries:\n  Movies:\n    metadata_files: wrong\n', ':[\n'])(
		'fails closed for an unclassifiable config shape',
		(raw) => {
			expect(classifyKometaLegacyConfig(raw).known).toBe(false);
		}
	);
});
