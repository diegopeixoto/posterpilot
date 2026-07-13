import { defineConfig, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const appPort = Number(process.env.POSTERPILOT_E2E_PORT ?? 14170);
const baseURL = `http://127.0.0.1:${appPort}`;
const runId = process.env.POSTERPILOT_E2E_RUN_ID ?? randomUUID();
if (!/^[a-zA-Z0-9_-]+$/.test(runId)) {
	throw new Error(
		'POSTERPILOT_E2E_RUN_ID may only contain letters, numbers, underscores, and dashes.'
	);
}
// Config, web server, and worker processes share this unique identity. This keeps
// metadata and artifacts from separate invocations isolated, even on the same port.
process.env.POSTERPILOT_E2E_RUN_ID = runId;
const artifactNamespace = `e2e-${appPort}-${runId}`;

export default defineConfig({
	testDir: './tests/e2e/specs',
	outputDir: `./test-results/${artifactNamespace}`,
	fullyParallel: false,
	workers: 1,
	forbidOnly: Boolean(process.env.CI),
	// The projects intentionally mutate one shared throwaway database. A retry
	// without resetting that database would start from a different state and could
	// hide the original failure, so retries stay disabled in every environment.
	retries: 0,
	timeout: 90_000,
	expect: { timeout: 15_000 },
	reporter: process.env.CI
		? [
				['line'],
				['html', { outputFolder: `playwright-report/${artifactNamespace}`, open: 'never' }]
			]
		: [
				['list'],
				['html', { outputFolder: `playwright-report/${artifactNamespace}`, open: 'never' }]
			],
	use: {
		...devices['Desktop Chrome'],
		baseURL,
		locale: 'en-US',
		timezoneId: 'UTC',
		colorScheme: 'dark',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure'
	},
	webServer: {
		command: 'node ./tests/e2e/support/start.mjs',
		url: `${baseURL}/api/health`,
		reuseExistingServer: false,
		timeout: 120_000,
		gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 },
		stdout: 'pipe',
		stderr: 'pipe'
	},
	projects: [
		{
			name: 'bootstrap',
			testMatch: /00-bootstrap\.setup\.e2e\.mjs/
		},
		{
			name: 'product-flows',
			testMatch: /10-product-flows\.e2e\.mjs/,
			dependencies: ['bootstrap']
		},
		{
			name: 'multi-server-kometa',
			testMatch: /20-multi-server-kometa\.e2e\.mjs/,
			dependencies: ['product-flows']
		},
		{
			name: 'authentication',
			testMatch: /30-authentication\.e2e\.mjs/,
			dependencies: ['multi-server-kometa']
		}
	]
});
