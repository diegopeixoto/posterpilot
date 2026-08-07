import { json } from '@sveltejs/kit';
import { dirname } from 'node:path';
import type { RequestHandler } from './$types';
import {
	resolveConfig,
	saveSettings,
	setArtworkRankingSettings,
	setIncludedSectionsForServer,
	type AppConfig
} from '$lib/server/config';
import { logEvent } from '$lib/server/events';
import { parseProviderPriority, parseScoreWeights } from '$lib/server/posters/score';
import {
	getActiveServerInstance,
	materializeLegacyServerInstance
} from '$lib/server/server-instances';
import { resolveKometaServerBinding } from '$lib/server/kometa/server-binding';
import { canonicalConfigPath } from '$lib/server/kometa/config-io';
import { withKometaMigrationControlLock } from '$lib/server/kometa/migration-control-lock';
import { assertNoPendingKometaConfigMutationWhileOwned } from '$lib/server/kometa/config-mutation-recovery';
import { isKometaMigrationIncomplete } from '$lib/server/kometa/migration-journal';
import type { KometaMigrationPlanPayload } from '$lib/server/kometa/migration-plan';
import { loadActiveKometaMigrationJournal } from '$lib/server/kometa/migration-store';
import {
	KometaMetadataPathPrefixError,
	normalizeKometaMetadataPathPrefix
} from '$lib/server/kometa/reference-path';

const KOMETA_SCOPE_KEYS = [
	'kometaServerInstanceId',
	'kometaAssetsDir',
	'kometaConfigPath',
	'kometaMetadataPathPrefix',
	'kometaConfigMode'
] as const satisfies readonly (keyof AppConfig)[];

const KOMETA_CHECKPOINT_GUARDED_KEYS = [
	...KOMETA_SCOPE_KEYS,
	'tmdbKey',
	'serverType',
	'plexUrl',
	'plexToken',
	'jellyfinUrl',
	'jellyfinApiKey',
	'embyUrl',
	'embyApiKey'
] as const satisfies readonly (keyof AppConfig)[];

interface EffectiveKometaScope {
	serverInstanceId: string;
	configPath: string | null;
	outputDirectory: string;
	metadataPathPrefix: string;
	configMode: string | null;
}

function effectiveKometaScope(
	config: AppConfig,
	payload: Partial<Record<keyof AppConfig, string>> = {}
): EffectiveKometaScope {
	const configPath = payload.kometaConfigPath ?? config.kometaConfigPath;
	const assetsDir = payload.kometaAssetsDir ?? config.kometaAssetsDir;
	return {
		serverInstanceId: payload.kometaServerInstanceId ?? String(config.kometaServerInstanceId ?? ''),
		configPath: configPath ? canonicalConfigPath(configPath) : null,
		outputDirectory: canonicalConfigPath(configPath ? dirname(configPath) : assetsDir),
		metadataPathPrefix: payload.kometaMetadataPathPrefix ?? config.kometaMetadataPathPrefix,
		configMode: configPath ? (payload.kometaConfigMode ?? config.kometaConfigMode) : null
	};
}

function frozenKometaScope(payload: KometaMigrationPlanPayload): EffectiveKometaScope {
	return {
		serverInstanceId: payload.serverInstanceId,
		configPath: payload.config.path,
		outputDirectory: payload.outputDirectory,
		metadataPathPrefix: payload.metadataPathPrefix,
		configMode: payload.config.path ? payload.config.mode : null
	};
}

function requestsKometaScopeChange(
	payload: Partial<Record<keyof AppConfig, string>>,
	config: AppConfig
): boolean {
	return KOMETA_SCOPE_KEYS.some((key) => {
		if (!Object.hasOwn(payload, key)) return false;
		return payload[key] !== String(config[key] ?? '');
	});
}

function movesKometaScopeAwayFromFrozen(
	config: AppConfig,
	payload: Partial<Record<keyof AppConfig, string>>,
	frozenPayload: KometaMigrationPlanPayload
): boolean {
	const current = effectiveKometaScope(config);
	const next = effectiveKometaScope(config, payload);
	const frozen = frozenKometaScope(frozenPayload);
	return (Object.keys(next) as (keyof EffectiveKometaScope)[]).some(
		(key) => next[key] !== current[key] && next[key] !== frozen[key]
	);
}

async function kometaScopeIsLocked(
	payload: Partial<Record<keyof AppConfig, string>>
): Promise<boolean> {
	if (!KOMETA_SCOPE_KEYS.some((key) => Object.hasOwn(payload, key))) return false;
	try {
		const config = await resolveConfig();
		if (!requestsKometaScopeChange(payload, config)) return false;
		const currentScope = effectiveKometaScope(config);
		const nextScope = effectiveKometaScope(config, payload);
		if (
			(Object.keys(currentScope) as (keyof EffectiveKometaScope)[]).every(
				(key) => currentScope[key] === nextScope[key]
			)
		) {
			return false;
		}
		// The journal belongs to the prior binding. Looking it up under a requested
		// replacement id would make an in-flight migration disappear from the API.
		const journal = await loadActiveKometaMigrationJournal();
		return (
			journal !== null &&
			isKometaMigrationIncomplete(journal) &&
			movesKometaScopeAwayFromFrozen(config, payload, journal.payload)
		);
	} catch {
		// A scope write cannot safely proceed when its prior journal is unreadable.
		return true;
	}
}

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const payload: Partial<Record<keyof AppConfig, string>> = {};
	let ranking: {
		providerPriority: string[];
		weights: NonNullable<ReturnType<typeof parseScoreWeights>>;
	} | null = null;
	let includedSectionsChanged = false;
	let includedSections: string[] | null = null;
	let includedSectionsServerId: string | null = null;
	for (const [key, value] of Object.entries(body)) {
		if (key === 'ranking' && value && typeof value === 'object' && !Array.isArray(value)) {
			const raw = value as Record<string, unknown>;
			const providerPriority = parseProviderPriority(raw.providerPriority);
			const weights = parseScoreWeights(raw.weights);
			if (!providerPriority || !weights) {
				return json({ error: { code: 'invalid_artwork_ranking' } }, { status: 400 });
			}
			ranking = { providerPriority, weights };
			continue;
		}
		// includedSections is an array of section keys → persist as JSON.
		if (key === 'includedSections' && Array.isArray(value)) {
			if (value.some((entry) => typeof entry !== 'string')) {
				return json({ error: { code: 'invalid_library_selection' } }, { status: 400 });
			}
			includedSections = value as string[];
			includedSectionsChanged = true;
		} else if (key === 'kometaMetadataPathPrefix' && typeof value === 'string') {
			try {
				payload.kometaMetadataPathPrefix = normalizeKometaMetadataPathPrefix(value);
			} catch (error) {
				if (error instanceof KometaMetadataPathPrefixError) {
					return json(
						{
							error: {
								code: 'invalid_kometa_metadata_path_prefix',
								reason: error.code
							}
						},
						{ status: 400 }
					);
				}
				throw error;
			}
		} else if (typeof value === 'string') {
			(payload as Record<string, string>)[key] = value;
		}
	}
	return withKometaMigrationControlLock(async (assertControlLockOwned) => {
		if (typeof payload.kometaServerInstanceId === 'string' && payload.kometaServerInstanceId) {
			const resolved = await resolveKometaServerBinding(payload.kometaServerInstanceId);
			if (resolved.status !== 'ready') {
				return json(
					{ error: { code: `kometa_server_binding_${resolved.status}` } },
					{ status: 400 }
				);
			}
		}
		if (KOMETA_CHECKPOINT_GUARDED_KEYS.some((key) => Object.hasOwn(payload, key))) {
			try {
				await assertNoPendingKometaConfigMutationWhileOwned(assertControlLockOwned);
			} catch {
				return json({ error: { code: 'kometa_config_recovery_required' } }, { status: 409 });
			}
		}
		if (await kometaScopeIsLocked(payload)) {
			return json({ error: { code: 'kometa_migration_config_locked' } }, { status: 409 });
		}
		if (includedSections !== null) {
			const active = await getActiveServerInstance();
			if (!active) {
				return json({ error: { code: 'server_instance_not_found' } }, { status: 409 });
			}
			includedSectionsServerId = active.id;
			await assertControlLockOwned();
			await setIncludedSectionsForServer(active.id, includedSections);
		}
		const settingsLease = await assertControlLockOwned();
		await saveSettings(payload, settingsLease);
		if (
			[
				'serverType',
				'plexUrl',
				'plexToken',
				'jellyfinUrl',
				'jellyfinApiKey',
				'embyUrl',
				'embyApiKey'
			].some((key) => key in payload)
		) {
			await materializeLegacyServerInstance(await assertControlLockOwned());
		}
		if (ranking) await setArtworkRankingSettings(ranking);

		// Log which settings changed for the activity log — never log secret VALUES,
		// only that a secret key was updated.
		const changedKeys = [
			...Object.keys(payload),
			...(includedSectionsChanged ? ['includedSections'] : []),
			...(ranking ? ['artworkRanking'] : [])
		];
		if (changedKeys.length) {
			await logEvent('info', 'settings', 'Settings updated', { keys: changedKeys });
		}
		if (includedSectionsChanged) {
			const count = Array.isArray(body.includedSections) ? body.includedSections.length : 0;
			await logEvent(
				'info',
				'settings',
				count === 0
					? 'Library selection changed (sync all libraries)'
					: `Library selection changed (${count} libraries)`,
				{ count, serverInstanceId: includedSectionsServerId }
			);
		}

		return json({ ok: true });
	});
};
