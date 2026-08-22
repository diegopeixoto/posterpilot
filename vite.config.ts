import adapter from '@sveltejs/adapter-node';
import tailwindcss from '@tailwindcss/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { sveltekit } from '@sveltejs/kit/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { defineConfig } from 'vite';

export default defineConfig({
	server: {
		watch: {
			ignored: ['**/test-results/**', '**/playwright-report/**']
		}
	},
	plugins: [
		tailwindcss(),
		// Compiles the message catalogs (project.inlang + messages/*.json) into the
		// type-safe message functions + runtime under src/lib/paraglide (git-ignored,
		// regenerated on dev/build/check). Locale resolution order is: the persisted
		// preferred-language setting (custom-setting, seeded into a cookie/header by the
		// server) → Accept-Language (preferredLanguage) → English (baseLocale).
		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide',
			strategy: ['custom-setting', 'preferredLanguage', 'baseLocale']
		}),
		sveltekit({
			// Stated explicitly, and identically in vitest.config.ts, so the app and its
			// component tests cannot compile the same `<script lang="ts">` differently.
			// Svelte 5's built-in type stripping is syntactic and incomplete — an
			// optional parameter comes out as `function f(a, b?)`, invalid JavaScript
			// that fails only when a browser parses the module. The SvelteKit plugin
			// happens to cover this already; pinning it means a change upstream, or a
			// second plugin setup, cannot quietly reintroduce the gap.
			// `style: false` leaves the CSS pipeline alone — this is about scripts.
			preprocess: vitePreprocess({ script: true, style: false }),
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// adapter-node produces a standalone server (build/index.js) we run under Bun in Docker.
			adapter: adapter(),

			// Let an open tab notice that the container behind it was upgraded. The
			// client polls `_app/version.json` (a few bytes) and flips `updated.current`
			// when the build it loaded is no longer the one serving; the root layout then
			// turns the next navigation into a full page load (#115). Without this a tab
			// keeps running the previous release's code for as long as it stays open,
			// while the data it shows — version footer included — comes from the new one.
			// `version.name` stays the default build timestamp so every rebuild counts.
			version: { pollInterval: 60_000 }
		})
	]
});
