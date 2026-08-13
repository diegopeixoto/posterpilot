import { desc } from 'drizzle-orm';
import { isAbsolute } from 'node:path';
import { db, databaseClient } from '$lib/server/db';
import {
	events,
	jobAttempts,
	jobs,
	mediaItems,
	providerDiscoveryOutcomes
} from '$lib/server/db/schema';
import { env } from '$env/dynamic/private';
import { resolveDataPaths } from '$lib/server/data-paths';
import { resolveConfig } from '$lib/server/config';
import { getDiagnostics } from '$lib/server/diagnostics';
import { getServerInstanceConnection, listServerInstances } from '$lib/server/server-instances';
import { version } from '$lib/version';
import { buildSupportBundle } from './builder';
import { inspectSupportDatabase } from './database';

// Reported as `latestExpected` and compared against the applied migrations, so a
// stale value makes a healthy database look behind. Bump it with every migration.
const LATEST_SCHEMA_MIGRATION = '0011_provider_discovery_truncation';

function secretMarker(value: string | null): '<redacted>' | '<unset>' {
	return value ? '<redacted>' : '<unset>';
}

async function appliedMigrations(): Promise<unknown> {
	try {
		const result = await databaseClient.execute(
			'select id, hash, created_at from __drizzle_migrations order by created_at asc'
		);
		return {
			latestExpected: LATEST_SCHEMA_MIGRATION,
			applied: result.rows.map((row) => ({
				id: Number(row.id),
				hash: String(row.hash),
				createdAt: Number(row.created_at)
			}))
		};
	} catch {
		return {
			latestExpected: LATEST_SCHEMA_MIGRATION,
			applied: null,
			errorCode: 'state_unavailable'
		};
	}
}

/** Gather bounded summaries only; never add the database, artwork, raw responses, or secrets. */
export async function createSupportBundle(includeTitles = false) {
	const dataPaths = resolveDataPaths(env.DATABASE_URL, env.APP_KEY_FILE);
	const [
		config,
		servers,
		recentJobs,
		recentAttempts,
		diagnostics,
		outcomes,
		recentEvents,
		migrations,
		database
	] = await Promise.all([
		resolveConfig(),
		listServerInstances(),
		db
			.select({
				id: jobs.id,
				serverInstanceId: jobs.serverInstanceId,
				librarySectionKey: jobs.librarySectionKey,
				type: jobs.type,
				status: jobs.status,
				phase: jobs.phase,
				attempt: jobs.attempt,
				maxAttempts: jobs.maxAttempts,
				processed: jobs.processed,
				total: jobs.total,
				errorCode: jobs.errorCode,
				createdAt: jobs.createdAt,
				startedAt: jobs.startedAt,
				finishedAt: jobs.finishedAt
			})
			.from(jobs)
			.orderBy(desc(jobs.createdAt))
			.limit(50),
		db
			.select({
				id: jobAttempts.id,
				jobId: jobAttempts.jobId,
				attemptNumber: jobAttempts.attemptNumber,
				trigger: jobAttempts.trigger,
				status: jobAttempts.status,
				retryable: jobAttempts.retryable,
				errorCode: jobAttempts.errorCode,
				startedAt: jobAttempts.startedAt,
				finishedAt: jobAttempts.finishedAt
			})
			.from(jobAttempts)
			.orderBy(desc(jobAttempts.createdAt))
			.limit(100),
		getDiagnostics(undefined, 10),
		db
			.select({
				serverInstanceId: providerDiscoveryOutcomes.serverInstanceId,
				mediaItemId: providerDiscoveryOutcomes.mediaItemId,
				provider: providerDiscoveryOutcomes.provider,
				status: providerDiscoveryOutcomes.status,
				candidateCount: providerDiscoveryOutcomes.candidateCount,
				retainedStaleCandidates: providerDiscoveryOutcomes.retainedStaleCandidates,
				truncatedKinds: providerDiscoveryOutcomes.truncatedKinds,
				latencyMs: providerDiscoveryOutcomes.latencyMs,
				errorCode: providerDiscoveryOutcomes.errorCode,
				error: providerDiscoveryOutcomes.error,
				lastSuccessAt: providerDiscoveryOutcomes.lastSuccessAt,
				completedAt: providerDiscoveryOutcomes.completedAt
			})
			.from(providerDiscoveryOutcomes)
			.orderBy(desc(providerDiscoveryOutcomes.completedAt))
			.limit(100),
		db
			.select({
				id: events.id,
				serverInstanceId: events.serverInstanceId,
				jobId: events.jobId,
				level: events.level,
				type: events.type,
				code: events.code,
				createdAt: events.createdAt
			})
			.from(events)
			.orderBy(desc(events.createdAt))
			.limit(100),
		appliedMigrations(),
		inspectSupportDatabase(databaseClient, dataPaths.databaseFile).catch(() => ({
			errorCode: 'database_diagnostics_unavailable'
		}))
	]);

	const knownSecrets = [
		config.plexToken,
		config.jellyfinApiKey,
		config.embyApiKey,
		config.tmdbKey,
		config.fanartKey,
		config.thePosterDbPassword
	].filter((value): value is string => Boolean(value));
	for (const server of servers) {
		if (!server.credentialSet) continue;
		try {
			const connection = await getServerInstanceConnection(server.id);
			if (connection.credential) knownSecrets.push(connection.credential);
		} catch {
			// An undecryptable credential is never materialized into the bundle.
		}
	}

	const titles = includeTitles
		? await db
				.select({
					id: mediaItems.id,
					serverInstanceId: mediaItems.serverInstanceId,
					title: mediaItems.title,
					year: mediaItems.year,
					type: mediaItems.type
				})
				.from(mediaItems)
				.orderBy(desc(mediaItems.updatedAt))
				.limit(500)
		: null;

	const configurationShape = {
		mediaServer: {
			legacyType: config.serverType,
			legacyConnectionConfigured: Boolean(
				(config.plexUrl && config.plexToken) ||
				(config.jellyfinUrl && config.jellyfinApiKey) ||
				(config.embyUrl && config.embyApiKey)
			),
			namedInstances: servers.map((server) => ({
				id: server.id,
				type: server.type,
				enabled: server.enabled,
				protected: server.protected,
				credential: server.credentialSet ? '<redacted>' : '<unset>',
				connectionStatus: server.connectionStatus,
				lastTestedAt: server.lastTestedAt
			}))
		},
		credentials: {
			tmdb: secretMarker(config.tmdbKey),
			fanart: secretMarker(config.fanartKey)
		},
		providers: {
			mediux: config.providerMediux,
			tmdb: config.providerTmdb,
			fanart: config.providerFanart,
			thePosterDb: config.providerThePosterDb
		},
		paths: {
			kometaAssets: {
				configured: config.kometaAssetsDir.trim() !== '',
				absolute: isAbsolute(config.kometaAssetsDir),
				expectedType: 'directory'
			},
			kometaConfig: {
				configured: config.kometaConfigPath.trim() !== '',
				absolute: config.kometaConfigPath ? isAbsolute(config.kometaConfigPath) : false,
				expectedType: 'file'
			}
		},
		behavior: {
			defaultApplyMethod: config.defaultApplyMethod,
			incrementalSync: config.incrementalSync,
			suggestPreselect: config.suggestPreselect,
			applyConcurrency: config.applyConcurrency,
			httpCacheTtlDays: config.httpCacheTtlDays
		}
	};

	return buildSupportBundle({
		appVersion: version,
		generatedAt: new Date(),
		includeTitles,
		secrets: knownSecrets,
		sources: [
			{
				path: 'runtime.json',
				value: {
					appVersion: version,
					runtime: process.versions.bun ? 'bun' : 'node',
					runtimeVersion: process.versions.bun ?? process.version,
					platform: process.platform,
					architecture: process.arch
				}
			},
			{ path: 'configuration.json', value: configurationShape },
			{ path: 'schema.json', value: migrations },
			{ path: 'database.json', value: database },
			{ path: 'jobs.json', value: recentJobs },
			{ path: 'job-attempts.json', value: recentAttempts },
			{ path: 'diagnostics.json', value: diagnostics, optional: true },
			{ path: 'provider-outcomes.json', value: outcomes, optional: true },
			{ path: 'events.json', value: recentEvents, optional: true },
			...(titles ? [{ path: 'titles.json', value: titles }] : [])
		]
	});
}
