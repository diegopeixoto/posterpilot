import adapter from '@sveltejs/adapter-node';
import tailwindcss from '@tailwindcss/vite';
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
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// adapter-node produces a standalone server (build/index.js) we run under Bun in Docker.
			adapter: adapter()
		})
	]
});
