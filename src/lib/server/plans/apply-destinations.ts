import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';
import { resolveConfig, type AppConfig } from '$lib/server/config';
import {
	LEGACY_FILENAME,
	resolveKometaDestination,
	type KometaDestinationV2
} from '$lib/server/kometa/destination';
import { classifyKometaLegacyConfig } from '$lib/server/kometa/legacy-layout';
import { canonicalConfigPath } from '$lib/server/kometa/config-io';
import type { KometaMigrationCollisionState } from '$lib/server/kometa/migration-state';
import { hashCanonicalJson } from './canonical-json';
import {
	applySlotKey,
	type CurrentArtworkIdentity,
	type DestinationSlotSnapshot
} from './apply-plan';
import { ApplyPlannerError, type ResolveApplyDestinationsInput } from './apply-planner';
import type { ApplyServerRegistry } from './apply-server-registry';
import { sha256Bytes } from '$lib/server/revisions/verification';

type JsonObject = Record<string, unknown>;

export interface KometaDestinationState {
	kometaFileFingerprint: string;
	current: CurrentArtworkIdentity;
}

interface KometaDocumentState {
	filePath: string;
	metadata: JsonObject;
	parseError: boolean;
	fileFingerprint: string;
}

interface InspectedKometaFile {
	path: string;
	exists: boolean;
	readable: boolean;
	content: string | null;
	fingerprint: string;
}

export interface KometaCollisionGuardState {
	migrationRequired: boolean;
	reason:
		| 'active_legacy_reference'
		| 'migration_incomplete'
		| 'unknown_config_with_legacy_file'
		| null;
	fingerprint: string;
}

export interface ApplyDestinationResolverOptions {
	serverRegistry: ApplyServerRegistry;
	loadConfig?: () => Promise<AppConfig>;
	/** Cache immutable config/file reads for one preview or freshness-validation pass. */
	cacheKometaReads?: boolean;
	loadMigrationState?: (serverInstanceId: string) => Promise<KometaMigrationCollisionState | null>;
	readKometaState?: (
		config: AppConfig,
		destination: KometaDestinationV2,
		slot: ResolveApplyDestinationsInput['selections'][number]['slot']
	) => Promise<KometaDestinationState>;
}

function object(value: unknown): JsonObject {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as JsonObject)
		: {};
}

function child(objectValue: JsonObject, key: string | number): JsonObject {
	return object(objectValue[String(key)]);
}

function stringValue(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Keep Kometa output-path resolution identical between preview, validation, and execution. */
export function kometaOutputDirectory(config: AppConfig): string {
	return config.kometaConfigPath ? dirname(config.kometaConfigPath) : config.kometaAssetsDir;
}

function inspectKometaFile(path: string): InspectedKometaFile {
	const exists = existsSync(path);
	let content: string | null = null;
	let readable = !exists;
	if (exists) {
		try {
			content = readFileSync(path, 'utf8');
			readable = true;
		} catch {
			readable = false;
		}
	}
	return {
		path,
		exists,
		readable,
		content,
		fingerprint: hashCanonicalJson({ path, exists, readable, content })
	};
}

/**
 * Freeze the active config and preserved legacy file into every Kometa snapshot.
 * This is intentionally read-only: migration owns all config/file mutation.
 */
export function inspectKometaCollisionGuard(
	config: AppConfig,
	migration: KometaMigrationCollisionState | null = null
): KometaCollisionGuardState {
	const activeConfig = Boolean(config.kometaConfigPath);
	const configFile = activeConfig
		? inspectKometaFile(config.kometaConfigPath)
		: {
				path: '',
				exists: false,
				readable: true,
				content: null,
				fingerprint: hashCanonicalJson({ path: '', exists: false, readable: true, content: null })
			};
	const legacyFile = inspectKometaFile(join(kometaOutputDirectory(config), LEGACY_FILENAME));
	const classification =
		activeConfig && configFile.exists && configFile.readable && configFile.content !== null
			? classifyKometaLegacyConfig(configFile.content)
			: { known: false, references: [] as string[] };
	const hasActiveLegacyReference = classification.references.length > 0;
	const migrationScopeMatches =
		migration?.serverInstanceId === config.kometaServerInstanceId &&
		migration.metadataPathPrefix === config.kometaMetadataPathPrefix &&
		canonicalConfigPath(migration.outputDirectory) ===
			canonicalConfigPath(kometaOutputDirectory(config)) &&
		((migration.configPath === null && !activeConfig) ||
			(migration.configPath !== null &&
				activeConfig &&
				canonicalConfigPath(migration.configPath) ===
					canonicalConfigPath(config.kometaConfigPath)));
	const migrationIncomplete =
		migrationScopeMatches &&
		migration?.status !== 'completed' &&
		migration?.status !== 'rolled_back';
	const manualBaselineMatches =
		migrationScopeMatches &&
		migration?.status === 'completed' &&
		migration.activationEvidence === 'user_acknowledged';
	const unknownConfigWithLegacyFile =
		legacyFile.exists && (!activeConfig || !classification.known) && !manualBaselineMatches;
	const reason = hasActiveLegacyReference
		? ('active_legacy_reference' as const)
		: migrationIncomplete
			? ('migration_incomplete' as const)
			: unknownConfigWithLegacyFile
				? ('unknown_config_with_legacy_file' as const)
				: null;
	const migrationRequired = reason !== null;
	return {
		migrationRequired,
		reason,
		fingerprint: hashCanonicalJson({
			version: 2,
			activeConfig,
			configFile: configFile.fingerprint,
			configKnown: classification.known,
			activeLegacyReferences: classification.references,
			legacyFile: legacyFile.fingerprint,
			migration: migrationScopeMatches
				? {
						migrationId: migration.migrationId,
						status: migration.status,
						completedAt: migration.completedAt,
						activationEvidence: migration.activationEvidence,
						configPath: migration.configPath,
						outputDirectory: migration.outputDirectory,
						metadataPathPrefix: migration.metadataPathPrefix
					}
				: null,
			manualBaselineAccepted: manualBaselineMatches,
			migrationRequired,
			reason
		})
	};
}

function bindCollisionGuard(
	state: KometaDestinationState,
	guard: KometaCollisionGuardState
): KometaDestinationState {
	return {
		kometaFileFingerprint: state.kometaFileFingerprint,
		current: {
			...state.current,
			destinationFingerprint: hashCanonicalJson({
				typedDestinationFingerprint: state.current.destinationFingerprint,
				collisionGuardFingerprint: guard.fingerprint
			})
		}
	};
}

function emptyKometaCurrent(guard: KometaCollisionGuardState): CurrentArtworkIdentity {
	return {
		url: null,
		fingerprint: null,
		artworkVersion: null,
		observedAt: null,
		destinationFingerprint: hashCanonicalJson({
			typedDestinationFingerprint: null,
			collisionGuardFingerprint: guard.fingerprint
		})
	};
}

function kometaSlotUrl(
	entry: JsonObject,
	slot: ResolveApplyDestinationsInput['selections'][number]['slot']
) {
	if (slot.season === null) {
		return stringValue(slot.kind === 'background' ? entry.url_background : entry.url_poster);
	}
	const season = child(object(entry.seasons), slot.season);
	if (slot.kind === 'title_card' && slot.episode !== null) {
		return stringValue(child(object(season.episodes), slot.episode).url_poster);
	}
	return stringValue(slot.kind === 'background' ? season.url_background : season.url_poster);
}

/** Read only the target Kometa entry; no preview path may create or rewrite a file. */
function readDatabaseKometaDocument(
	config: AppConfig,
	destination: KometaDestinationV2
): KometaDocumentState {
	const outputDirectory = kometaOutputDirectory(config);
	const filePath = join(outputDirectory, destination.filename);
	let metadata: JsonObject = {};
	let parseError = false;
	let raw: string | null = null;
	const exists = existsSync(filePath);
	if (exists) {
		try {
			raw = readFileSync(filePath, 'utf8');
			const parsed = object(parse(raw));
			metadata = object(parsed.metadata);
		} catch {
			parseError = true;
		}
	}
	return {
		filePath,
		metadata,
		parseError,
		fileFingerprint: hashCanonicalJson({ exists, content: raw })
	};
}

function kometaStateFromDocument(
	document: KometaDocumentState,
	destination: KometaDestinationV2,
	slot: ResolveApplyDestinationsInput['selections'][number]['slot']
): KometaDestinationState {
	// A malformed file is still represented by a distinct identity and will fail
	// safely during the existing writer. Preview itself remains read-only.
	const entry = document.parseError
		? { __posterpilotParseError: true }
		: child(document.metadata, destination.mappingId);
	const url = kometaSlotUrl(entry, slot);
	const destinationFingerprint = hashCanonicalJson({
		filePath: document.filePath,
		destination,
		fileFingerprint: document.fileFingerprint
	});
	return {
		kometaFileFingerprint: document.fileFingerprint,
		current: {
			url,
			fingerprint: url === null ? null : hashCanonicalJson({ url }),
			artworkVersion: null,
			observedAt: null,
			destinationFingerprint
		}
	};
}

async function readDatabaseKometaState(
	config: AppConfig,
	destination: KometaDestinationV2,
	slot: ResolveApplyDestinationsInput['selections'][number]['slot']
): Promise<KometaDestinationState> {
	return kometaStateFromDocument(
		readDatabaseKometaDocument(config, destination),
		destination,
		slot
	);
}

function currentSlot(
	input: ResolveApplyDestinationsInput,
	slot: ResolveApplyDestinationsInput['selections'][number]['slot']
): CurrentArtworkIdentity {
	const state = input.target.item.currentSlots.find(
		(candidate) => applySlotKey(candidate.slot) === applySlotKey(slot)
	);
	return {
		url: state?.url ?? null,
		fingerprint: state?.fingerprint ?? null,
		artworkVersion: state?.artworkVersion ?? null,
		observedAt: state?.observedAt ?? null,
		destinationFingerprint: null
	};
}

/**
 * Resolve exact provider-native target ids and destination identities for planning.
 * The same resolver is reused by stale validation, so a child mapping, connection,
 * current slot, or Kometa entry change invalidates confirmation.
 */
export function createApplyDestinationResolver(options: ApplyDestinationResolverOptions) {
	const loadConfig = options.loadConfig ?? resolveConfig;
	const readKometaState = options.readKometaState ?? readDatabaseKometaState;
	const cacheKometaReads = options.cacheKometaReads ?? false;
	let cachedConfig: Promise<AppConfig> | null = null;
	let cachedGuard: KometaCollisionGuardState | null = null;
	const cachedMigrationStates = new Map<string, Promise<KometaMigrationCollisionState | null>>();
	const cachedDocuments = new Map<string, KometaDocumentState>();
	const resolveKometaConfig = () => {
		if (!cacheKometaReads) return loadConfig();
		cachedConfig ??= loadConfig();
		return cachedConfig;
	};
	const resolveMigrationState = (serverInstanceId: string) => {
		if (!options.loadMigrationState) return Promise.resolve(null);
		if (!cacheKometaReads) return options.loadMigrationState(serverInstanceId);
		let pending = cachedMigrationStates.get(serverInstanceId);
		if (!pending) {
			pending = options.loadMigrationState(serverInstanceId);
			cachedMigrationStates.set(serverInstanceId, pending);
		}
		return pending;
	};

	return async function resolveApplyDestinationSlots(
		input: ResolveApplyDestinationsInput
	): Promise<DestinationSlotSnapshot[]> {
		const snapshots: DestinationSlotSnapshot[] = [];
		const wantsServer = input.destinations.includes('server');
		const wantsKometa = input.destinations.includes('kometa');
		const serverBinding =
			wantsServer || wantsKometa
				? await options.serverRegistry.resolve(input.target.item.identity.serverInstanceId)
				: null;
		const config = wantsKometa ? await resolveKometaConfig() : null;
		if (
			wantsKometa &&
			(config?.kometaServerInstanceId !== input.target.item.identity.serverInstanceId ||
				serverBinding?.server.type !== 'plex')
		) {
			throw new ApplyPlannerError(
				'scope_mismatch',
				'Kometa target is not bound to this named Plex server'
			);
		}
		const kometaResolution = wantsKometa
			? resolveKometaDestination({
					type: input.target.item.identity.type,
					tmdbId: input.target.item.identity.tmdbId,
					tvdbId: input.target.item.identity.tvdbId,
					imdbId: input.target.item.identity.imdbId
				})
			: null;
		const migrationState = config
			? await resolveMigrationState(input.target.item.identity.serverInstanceId)
			: null;
		const kometaGuard = config
			? cacheKometaReads
				? (cachedGuard ??= inspectKometaCollisionGuard(config, migrationState))
				: inspectKometaCollisionGuard(config, migrationState)
			: null;
		const kometaDocuments = cacheKometaReads
			? cachedDocuments
			: new Map<string, KometaDocumentState>();

		let seasons: Awaited<
			ReturnType<NonNullable<typeof serverBinding>['server']['listSeasons']>
		> | null = null;
		const episodes = new Map<
			number,
			Awaited<ReturnType<NonNullable<typeof serverBinding>['server']['listEpisodes']>>
		>();

		for (const selection of input.selections) {
			if (wantsServer && serverBinding) {
				let targetId: string | null = input.target.item.identity.sourceId;
				if (selection.slot.season !== null) {
					seasons ??= await serverBinding.server.listSeasons(input.target.item.identity.sourceId);
					const season = seasons.find((row) => row.number === selection.slot.season);
					targetId = season?.id ?? null;
					if (selection.slot.episode !== null && season) {
						let rows = episodes.get(selection.slot.season);
						if (!rows) {
							rows = await serverBinding.server.listEpisodes(season.id);
							episodes.set(selection.slot.season, rows);
						}
						targetId = rows.find((row) => row.number === selection.slot.episode)?.id ?? null;
					}
				}

				const current = currentSlot(input, selection.slot);
				let liveIdentity: string | null = null;
				if (targetId !== null && serverBinding.server.readArtwork) {
					const live = await serverBinding.server.readArtwork(
						targetId,
						selection.slot.kind === 'background' ? 'background' : 'poster'
					);
					current.url = live?.url ?? null;
					current.fingerprint = live ? sha256Bytes(live.data) : null;
					// A fresh provider read supersedes the database observation timestamp.
					current.observedAt = null;
					liveIdentity = live?.identity ?? null;
				}
				current.destinationFingerprint = hashCanonicalJson({
					server: serverBinding.fingerprint,
					targetId,
					slot: selection.slot,
					liveIdentity,
					current: {
						url: current.url,
						fingerprint: current.fingerprint,
						artworkVersion: current.artworkVersion,
						observedAt: current.observedAt
					}
				});
				const backgroundUnsupported =
					selection.slot.kind === 'background' && !serverBinding.server.applyBackgroundUrl;
				snapshots.push({
					destination: 'server',
					slot: selection.slot,
					targetId,
					capability: backgroundUnsupported ? 'unsupported' : 'supported',
					current,
					skipCode: targetId === null ? 'target_unresolved' : null,
					parameters:
						targetId === null
							? { season: selection.slot.season, episode: selection.slot.episode }
							: {}
				});
			}

			if (config && kometaGuard) {
				if (kometaResolution?.ok) {
					const destination = kometaResolution.destination;
					let state: KometaDestinationState;
					if (options.readKometaState) {
						state = await readKometaState(config, destination, selection.slot);
					} else {
						let document = kometaDocuments.get(destination.filename);
						if (!document) {
							document = readDatabaseKometaDocument(config, destination);
							kometaDocuments.set(destination.filename, document);
						}
						state = kometaStateFromDocument(document, destination, selection.slot);
					}
					state = bindCollisionGuard(state, kometaGuard);
					snapshots.push({
						destination: 'kometa',
						kometaDestination: destination,
						kometaFileFingerprint: state.kometaFileFingerprint,
						slot: selection.slot,
						targetId: destination.key,
						capability:
							selection.slot.kind === 'background' && selection.slot.season !== null
								? 'unsupported'
								: 'supported',
						current: state.current,
						skipCode: kometaGuard.migrationRequired ? 'kometa_migration_required' : null,
						parameters: kometaGuard.migrationRequired
							? { reason: kometaGuard.reason, legacyFile: LEGACY_FILENAME }
							: {}
					});
				} else {
					snapshots.push({
						destination: 'kometa',
						slot: selection.slot,
						targetId: null,
						capability: 'supported',
						current: emptyKometaCurrent(kometaGuard),
						skipCode: kometaGuard.migrationRequired
							? 'kometa_migration_required'
							: 'missing_kometa_identifier',
						parameters: kometaGuard.migrationRequired
							? { reason: kometaGuard.reason, legacyFile: LEGACY_FILENAME }
							: { mediaKind: input.target.item.identity.type }
					});
				}
			}
		}

		return snapshots;
	};
}
