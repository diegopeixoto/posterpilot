import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeMediaServers } from './fake-media-servers.mjs';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const appPort = Number(process.env.POSTERPILOT_E2E_PORT ?? 14170);
const jellyfinPort = Number(process.env.POSTERPILOT_E2E_JELLYFIN_PORT ?? appPort + 1);
const plexPort = Number(process.env.POSTERPILOT_E2E_PLEX_PORT ?? appPort + 2);
const runId = process.env.POSTERPILOT_E2E_RUN_ID;
if (!runId || !/^[a-zA-Z0-9_-]+$/.test(runId)) {
	throw new Error('The Playwright config must provide a safe POSTERPILOT_E2E_RUN_ID.');
}
const runtimeFile = fileURLToPath(new URL(`../.runtime-${appPort}-${runId}.json`, import.meta.url));
const scenarioFile = fileURLToPath(
	new URL(`../.scenario-${appPort}-${runId}.json`, import.meta.url)
);
const dataDirectory = mkdtempSync(join(tmpdir(), 'posterpilot-e2e-'));
const databaseFile = join(dataDirectory, 'posterpilot.db');
const kometaDirectory = join(dataDirectory, 'kometa');

const runtime = {
	appUrl: `http://127.0.0.1:${appPort}`,
	fakeJellyfinUrl: `http://127.0.0.1:${jellyfinPort}`,
	fakePlexUrl: `http://127.0.0.1:${plexPort}`,
	dataDirectory,
	databaseFile,
	kometaDirectory,
	kometaConfigPath: join(kometaDirectory, 'config.yml'),
	kometaAssetsDirectory: join(kometaDirectory, 'assets')
};
let fakeServers;
try {
	// Acquire the fake-server sockets before publishing metadata. A competing run
	// on the same ports therefore fails without touching this run's state.
	fakeServers = await startFakeMediaServers({ jellyfinPort, plexPort });
	writeFileSync(runtimeFile, `${JSON.stringify(runtime, null, 2)}\n`, { mode: 0o600 });
} catch (error) {
	for (const path of [runtimeFile, scenarioFile]) {
		try {
			unlinkSync(path);
		} catch {
			// Nothing was published, or it was already removed.
		}
	}
	rmSync(dataDirectory, { recursive: true, force: true });
	throw error;
}
const inheritedEnvironment = Object.fromEntries(
	[
		'PATH',
		'HOME',
		'USER',
		'LOGNAME',
		'TMPDIR',
		'TMP',
		'TEMP',
		'SHELL',
		'LANG',
		'LC_ALL',
		'TERM',
		'CI',
		'BUN_INSTALL'
	]
		.filter((key) => process.env[key] !== undefined)
		.map((key) => [key, process.env[key]])
);
const isolatedPosterPilotEnvironment = Object.fromEntries(
	[
		'SERVER_TYPE',
		'PLEX_URL',
		'PLEX_TOKEN',
		'PLEX_CLIENT_ID',
		'JELLYFIN_URL',
		'JELLYFIN_API_KEY',
		'EMBY_URL',
		'EMBY_API_KEY',
		'TMDB_KEY',
		'KOMETA_ASSETS_DIR',
		'KOMETA_CONFIG_PATH',
		'KOMETA_CONFIG_MODE',
		'KOMETA_SERVER_INSTANCE_ID',
		'MEDIUX_REQUEST_DELAY_MS',
		'MEDIUX_CONCURRENCY',
		'HTTP_CACHE_TTL_DAYS',
		'DEFAULT_APPLY_METHOD',
		'INCLUDED_SECTIONS',
		'PROVIDER_MEDIUX',
		'PROVIDER_TMDB',
		'PROVIDER_FANART',
		'PROVIDER_THEPOSTERDB',
		'FANART_KEY',
		'APP_LANGUAGE',
		'APPLY_CONCURRENCY',
		'SUGGEST_PRESELECT',
		'INCREMENTAL_SYNC',
		'THUMB_CACHE_TTL_DAYS',
		'THUMB_CACHE_MAX_MB',
		'FUN_ENABLED',
		'LIBRARY_DEFAULT_SORT',
		'AUTH_MODE',
		'APP_KEY_FILE',
		'ADDRESS_HEADER',
		'MAX_UPLOAD_MB',
		'ORIGIN',
		'PROTOCOL_HEADER',
		'HOST_HEADER',
		'PORT_HEADER',
		'BODY_SIZE_LIMIT'
	].map((key) => [key, ''])
);
const application = spawn('bun', ['run', 'dev', '--host', '127.0.0.1', '--port', String(appPort)], {
	cwd: repositoryRoot,
	stdio: 'inherit',
	env: {
		...inheritedEnvironment,
		...isolatedPosterPilotEnvironment,
		DATABASE_URL: `file:${databaseFile}`,
		APP_SECRET: 'posterpilot-local-e2e-secret',
		// Keep language genuinely unset so the first wizard step is exercised;
		// Playwright's en-US browser locale still makes selectors deterministic.
		APP_LANGUAGE: '',
		LOG_DIR: join(dataDirectory, 'logs'),
		EVENT_RETENTION: '500',
		NO_COLOR: '1'
	}
});

let stopping = false;
async function stopApplication() {
	if (application.exitCode !== null || application.signalCode !== null) return;

	const exited = new Promise((resolve) => application.once('exit', resolve));
	application.kill('SIGTERM');
	await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);

	if (application.exitCode === null && application.signalCode === null) {
		application.kill('SIGKILL');
		await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1_000))]);
	}
}

async function stop(exitCode = 0) {
	if (stopping) return;
	stopping = true;
	await stopApplication();
	await fakeServers.close().catch(() => {});
	for (const path of [runtimeFile, scenarioFile]) {
		try {
			unlinkSync(path);
		} catch {
			// Best-effort cleanup after interrupted runs.
		}
	}
	rmSync(dataDirectory, { recursive: true, force: true });
	process.exit(exitCode);
}

process.once('SIGTERM', () => void stop(0));
process.once('SIGINT', () => void stop(130));
application.once('error', (error) => {
	console.error(`[e2e] could not start PosterPilot: ${error.message}`);
	void stop(1);
});
application.once('exit', (code, signal) => {
	if (stopping) return;
	console.error(`[e2e] PosterPilot exited early (${signal ?? code ?? 'unknown'}).`);
	void stop(code ?? 1);
});
