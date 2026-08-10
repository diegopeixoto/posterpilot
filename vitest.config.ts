import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const alias = { $lib: resolve('./src/lib') };

// `bun run test` runs these two projects one after the other rather than letting
// Vitest interleave them (see package.json). The component project drives a real
// Chromium, and sharing a machine with it starved the database-backed unit tests
// badly enough that files finishing in seconds hit their timeouts instead — a
// different handful each run. Sequencing costs one extra startup and buys back
// determinism, which is the whole point of a gate.
export default defineConfig({
	test: {
		projects: [
			{
				// Pure-logic unit tests. No SvelteKit plugin needed — the server modules
				// under test keep their testable logic free of $env/$app imports.
				resolve: { alias },
				test: {
					name: 'unit',
					include: ['src/**/*.test.ts'],
					exclude: ['src/**/*.svelte.test.ts'],
					environment: 'node',
					// Bounded rather than one fork per core. Dozens of these files each
					// stand up their own in-memory libsql, and at full width on a busy
					// machine workers began failing to start at all — files that finish
					// in seconds took minutes and tripped their timeouts, a different
					// set every run. A gate whose result changes run to run is not a
					// gate, and the wall-clock cost of capping this is small.
					poolOptions: { forks: { maxForks: 6 } }
				}
			},
			{
				// Component tests, in a real browser rather than a DOM emulator. Focus,
				// `activeElement`, and pointer capture are exactly what these components
				// get wrong, and those are the parts a simulated DOM models least
				// faithfully — a keyboard reorder that silently dropped focus to <body>
				// shipped once already because only end-to-end runs could catch it.
				//
				// Components under test import `svelte` and `$lib/*` only, so the plain
				// Svelte plugin is enough; pulling in the SvelteKit plugin would drag
				// $app/* and the whole server pipeline into a component test.
				// Tailwind is included so a test can assert computed style, not just class
				// names — `touch-action` confined to the drag handle is a real behavioral
				// guarantee, and asserting the class instead would pass even if the
				// utility were renamed out from under it.
				plugins: [tailwindcss(), svelte({ compilerOptions: { runes: true } })],
				resolve: { alias },
				test: {
					name: 'component',
					include: ['src/**/*.svelte.test.ts'],
					browser: {
						enabled: true,
						provider: playwright(),
						headless: true,
						instances: [{ browser: 'chromium' }]
					}
				}
			}
		]
	}
});
