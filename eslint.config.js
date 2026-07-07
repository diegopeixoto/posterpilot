import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';

/**
 * Flat ESLint config. Adds a static-analysis gate on top of Prettier (formatting)
 * and svelte-check (types): unused vars, unsafe patterns, and Svelte/a11y issues.
 * Type-aware rules are intentionally off — `svelte-check` already covers types, and
 * type-aware linting would double the run cost. Generated/output dirs are ignored.
 */
export default ts.config(
	{
		ignores: [
			'src/lib/paraglide/**',
			'build/**',
			'.svelte-kit/**',
			'node_modules/**',
			'drizzle/**',
			'docs/**'
		]
	},
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	{
		languageOptions: {
			globals: { ...globals.node, ...globals.browser }
		},
		rules: {
			// Allow intentional unused via a leading underscore (e.g. `{#each xs as _, i}`).
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }
			],
			// `any` is used deliberately in a few boundary spots; svelte-check guards types.
			'@typescript-eslint/no-explicit-any': 'off',
			// Baseline ratchet — these two Svelte rules are framework-preference, not
			// correctness, and don't fit this app: `resolve()` matters only with a base
			// path (this app has none), and several flagged URLSearchParams are one-shot,
			// non-reactive query builders. Left off for now; a future targeted pass can
			// adopt SvelteSet where a Set is genuinely reactive.
			'svelte/no-navigation-without-resolve': 'off',
			'svelte/prefer-svelte-reactivity': 'off'
		}
	},
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parserOptions: { parser: ts.parser }
		}
	},
	{
		// Runes modules (`.svelte.ts`/`.svelte.js`) are plain TS — the double extension
		// isn't matched by typescript-eslint's default globs, so point them at the TS parser.
		files: ['**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: { parser: ts.parser }
	}
);
