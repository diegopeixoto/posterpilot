import { env } from '$env/dynamic/private';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { posterCandidates } from '$lib/server/db/schema';
import { resolveConfig, type AppConfig } from '$lib/server/config';
import { resolveDataPaths } from '$lib/server/data-paths';
import { fetchJson, fetchText } from '$lib/server/http';
import { createMediaServer } from '$lib/server/media-server';
import {
	PROVIDER_ORDER,
	providerAvailability,
	type ProviderId
} from '$lib/server/posters/providers';
import {
	getServerInstanceConnection,
	listServerInstances,
	type ServerInstanceConnection,
	type ServerInstanceSummary
} from '$lib/server/server-instances';
import { tmdbAuth } from '$lib/server/tmdb/auth';
import { createDiagnosticHistoryStore } from './history';
import { probePath } from './path';
import { runDiagnosticChecks } from './runner';
import {
	DiagnosticCheckError,
	type DiagnosticDefinition,
	type DiagnosticResultValue
} from './types';

const CHECK_TIMEOUT_MS = 6_000;
const TMDB_BASE = 'https://api.themoviedb.org/3';

const historyStore = createDiagnosticHistoryStore(db);

function latestKey(serverId: string | null, type: string, key: string): string {
	return `${serverId ?? 'global'}\u0000${type}\u0000${key}`;
}

function remoteFailure(error: unknown): never {
	const text = error instanceof Error ? error.message : '';
	if (/HTTP (401|403)\b/.test(text)) {
		throw new DiagnosticCheckError('credential_rejected', 'The credential was rejected.', true);
	}
	throw new DiagnosticCheckError('network_unavailable', 'The component could not be reached.');
}

async function remoteCheck(check: () => Promise<unknown>): Promise<void> {
	try {
		await check();
	} catch (error) {
		remoteFailure(error);
	}
}

function serverDefinition(
	server: ServerInstanceSummary,
	lastSuccessAt: Date | null
): DiagnosticDefinition {
	return {
		componentType: 'server',
		componentKey: server.id,
		serverInstanceId: server.id,
		enabled: server.enabled && server.disconnectedAt === null,
		credentialRequired: true,
		credentialPresent: server.credentialSet,
		timeoutMs: CHECK_TIMEOUT_MS,
		lastSuccessAt,
		check: async () => {
			let connection: ServerInstanceConnection;
			try {
				connection = await getServerInstanceConnection(server.id, { requireEnabled: true });
			} catch {
				throw new DiagnosticCheckError(
					'network_unavailable',
					'The server connection is unavailable.'
				);
			}
			const provider = createMediaServer({
				instanceId: connection.id,
				name: connection.name,
				type: connection.type,
				baseUrl: connection.baseUrl!,
				credential: connection.credential!,
				capabilities: connection.capabilities
			});
			const result = await provider.testConnection();
			if (!result.ok) {
				throw new DiagnosticCheckError(
					result.unauthorized ? 'credential_rejected' : 'network_unavailable',
					'The server connection check failed.',
					result.unauthorized === true
				);
			}
			return { capabilities: provider.capabilities };
		}
	};
}

function tmdbDefinition(config: AppConfig, lastSuccessAt: Date | null): DiagnosticDefinition {
	return {
		componentType: 'tmdb',
		componentKey: 'tmdb',
		enabled: true,
		credentialRequired: true,
		credentialPresent: Boolean(config.tmdbKey),
		timeoutMs: CHECK_TIMEOUT_MS,
		lastSuccessAt,
		check: async () => {
			const auth = tmdbAuth(config.tmdbKey!);
			const url = auth.query
				? `${TMDB_BASE}/configuration?${auth.query}`
				: `${TMDB_BASE}/configuration`;
			await remoteCheck(() =>
				fetchJson(url, { headers: auth.headers, retries: 0, timeoutMs: CHECK_TIMEOUT_MS })
			);
		}
	};
}

async function hasStaleCandidates(
	provider: ProviderId,
	serverInstanceId?: string | null
): Promise<boolean> {
	const predicates = [
		eq(posterCandidates.provider, provider),
		eq(posterCandidates.active, true),
		eq(posterCandidates.stale, true)
	];
	if (serverInstanceId) {
		predicates.push(eq(posterCandidates.serverInstanceId, serverInstanceId));
	}
	return Boolean(
		(
			await db
				.select({ id: posterCandidates.id })
				.from(posterCandidates)
				.where(and(...predicates))
				.limit(1)
		)[0]
	);
}

function providerRemoteCheck(provider: ProviderId, config: AppConfig): () => Promise<void> {
	switch (provider) {
		case 'tmdb':
			return tmdbDefinition(config, null).check as () => Promise<void>;
		case 'fanarttv':
			return () =>
				remoteCheck(() =>
					fetchJson(
						`https://webservice.fanart.tv/v3/movies/550?api_key=${encodeURIComponent(config.fanartKey!)}`,
						{ retries: 0, timeoutMs: CHECK_TIMEOUT_MS }
					)
				);
		case 'mediux':
			return () =>
				remoteCheck(() =>
					fetchText('https://mediux.pro/', { retries: 0, timeoutMs: CHECK_TIMEOUT_MS })
				);
		case 'theposterdb':
			return () =>
				remoteCheck(() =>
					fetchText('https://theposterdb.com/', { retries: 0, timeoutMs: CHECK_TIMEOUT_MS })
				);
	}
}

async function providerDefinitions(
	config: AppConfig,
	lastSuccess: Map<string, Date | null>,
	serverInstanceId?: string | null
): Promise<DiagnosticDefinition[]> {
	return Promise.all(
		PROVIDER_ORDER.map(async (provider) => {
			const availability = providerAvailability(provider, config);
			const keyPresent =
				provider === 'fanarttv' ? Boolean(config.fanartKey) : Boolean(config.tmdbKey);
			return {
				componentType: 'artwork_provider' as const,
				componentKey: provider,
				serverInstanceId: serverInstanceId ?? null,
				enabled: availability !== 'disabled',
				credentialRequired: provider === 'fanarttv' || provider === 'tmdb',
				credentialPresent: provider === 'mediux' || provider === 'theposterdb' || keyPresent,
				timeoutMs: CHECK_TIMEOUT_MS,
				lastSuccessAt:
					lastSuccess.get(latestKey(serverInstanceId ?? null, 'artwork_provider', provider)) ??
					null,
				degradedOnFailure: await hasStaleCandidates(provider, serverInstanceId),
				check: providerRemoteCheck(provider, config)
			};
		})
	);
}

function pathDefinition(
	componentType: 'kometa' | 'data_path' | 'backup_path',
	componentKey: string,
	path: string,
	expectedType: 'file' | 'directory',
	lastSuccessAt: Date | null,
	enabled = true
): DiagnosticDefinition {
	return {
		componentType,
		componentKey,
		enabled,
		lastSuccessAt,
		timeoutMs: CHECK_TIMEOUT_MS,
		check: async () => ({
			pathChecks: await probePath(path, {
				expectedType,
				requireReadable: true,
				requireWritable: true
			})
		})
	};
}

export interface RunDiagnosticsOptions {
	serverInstanceId?: string | null;
	initiator?: string;
	/** Called after this component result is durably recorded. */
	onResult?: (result: DiagnosticResultValue) => void | Promise<void>;
}

export interface CompletedDiagnostics {
	runId: string;
	status: 'completed' | 'partial' | 'failed';
	results: DiagnosticResultValue[];
}

/** Run every configured check independently and persist only sanitized observations. */
export async function runDiagnostics(
	options: RunDiagnosticsOptions = {}
): Promise<CompletedDiagnostics> {
	const [config, servers, latest] = await Promise.all([
		resolveConfig(),
		listServerInstances(),
		historyStore.latest()
	]);
	const lastSuccess = new Map(
		latest.map((status) => [
			latestKey(status.serverInstanceId, status.componentType, status.componentKey),
			status.lastSuccessAt
		])
	);
	const selectedServers = options.serverInstanceId
		? servers.filter((server) => server.id === options.serverInstanceId)
		: servers;
	if (options.serverInstanceId && selectedServers.length === 0) {
		throw new DiagnosticCheckError('server_not_found', 'The requested server does not exist.');
	}

	const paths = resolveDataPaths(env.DATABASE_URL, env.APP_KEY_FILE);
	const definitions: DiagnosticDefinition[] = [
		...selectedServers.map((server) =>
			serverDefinition(server, lastSuccess.get(latestKey(server.id, 'server', server.id)) ?? null)
		),
		tmdbDefinition(config, lastSuccess.get(latestKey(null, 'tmdb', 'tmdb')) ?? null),
		...(await providerDefinitions(config, lastSuccess, options.serverInstanceId)),
		pathDefinition(
			'data_path',
			'application_data',
			paths.dataDirectory,
			'directory',
			lastSuccess.get(latestKey(null, 'data_path', 'application_data')) ?? null
		),
		pathDefinition(
			'backup_path',
			'application_backups',
			paths.backupsDirectory,
			'directory',
			lastSuccess.get(latestKey(null, 'backup_path', 'application_backups')) ?? null
		),
		pathDefinition(
			'kometa',
			'assets',
			config.kometaAssetsDir,
			'directory',
			lastSuccess.get(latestKey(null, 'kometa', 'assets')) ?? null,
			config.kometaAssetsDir.trim() !== ''
		),
		pathDefinition(
			'kometa',
			'config',
			config.kometaConfigPath,
			'file',
			lastSuccess.get(latestKey(null, 'kometa', 'config')) ?? null,
			config.kometaConfigPath.trim() !== ''
		)
	];

	const run = await historyStore.start(
		options.serverInstanceId ?? null,
		options.initiator ?? 'user'
	);
	let persistence = Promise.resolve();
	const results = await runDiagnosticChecks(definitions, undefined, async (result) => {
		persistence = persistence.then(async () => {
			await historyStore.record(run.id, result);
			await options.onResult?.(result);
		});
		await persistence;
	});
	await persistence;

	const healthy = results.filter((result) => result.status === 'healthy').length;
	const failed = results.filter((result) =>
		['degraded', 'unavailable', 'unknown'].includes(result.status)
	).length;
	const status = failed === 0 ? 'completed' : healthy === 0 ? 'failed' : 'partial';
	await historyStore.complete(run.id, status, {
		total: results.length,
		healthy,
		failed,
		disabled: results.filter((result) => result.status === 'disabled').length
	});
	return { runId: run.id, status, results };
}

export async function getDiagnostics(serverInstanceId?: string, limit = 10) {
	const [latest, history] = await Promise.all([
		historyStore.latest(serverInstanceId),
		historyStore.history(limit, serverInstanceId)
	]);
	return { latest, history };
}
