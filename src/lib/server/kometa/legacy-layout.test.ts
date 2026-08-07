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

	it.each([
		`defaults: &library
  metadata_files:
    - file: posterpilot.yml
libraries:
  Movies:
    <<: *library
`,
		`movie_library: &movie_library
  Movies:
    metadata_files:
      - file: posterpilot.yml
libraries: *movie_library
`,
		`defaults: &root
  libraries:
    Movies:
      metadata_files:
        - file: posterpilot.yml
<<: *root
`
	])('fails closed when YAML indirection can hide a legacy reference', (raw) => {
		expect(classifyKometaLegacyConfig(raw)).toEqual({ known: false, references: [] });
	});

	it('allows unrelated YAML indirection outside the libraries subtree', () => {
		expect(
			classifyKometaLegacyConfig(`shared: &shared
  cache: true
copy: *shared
libraries:
  Movies:
    metadata_files:
      - file: posterpilot-movies.yml
`)
		).toEqual({ known: true, references: [] });
	});

	it('allows aliases in a clearly unrelated field inside a library', () => {
		expect(
			classifyKometaLegacyConfig(`shared: &shared
  schedule: daily
libraries:
  Movies:
    operations: *shared
    metadata_files:
      - file: posterpilot-movies.yml
`)
		).toEqual({ known: true, references: [] });
	});

	it('treats null metadata_files as known absence', () => {
		expect(
			classifyKometaLegacyConfig(`libraries:
  Movies:
    metadata_files: null
`)
		).toEqual({ known: true, references: [] });
	});

	it('treats an empty library stanza as known absence', () => {
		expect(
			classifyKometaLegacyConfig(`libraries:
  Movies:
`)
		).toEqual({ known: true, references: [] });
	});
});
