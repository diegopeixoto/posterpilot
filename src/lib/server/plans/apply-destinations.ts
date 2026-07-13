import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';
import { resolveConfig, type AppConfig } from '$lib/server/config';
import { DEFAULT_FILENAME } from '$lib/server/kometa/yaml';
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
	targetId: string;
	current: CurrentArtworkIdentity;
}

interface KometaDocumentState {
	filePath: string;
	metadata: JsonObject;
	parseError: boolean;
}

export interface ApplyDestinationResolverOptions {
	serverRegistry: ApplyServerRegistry;
	loadConfig?: () => Promise<AppConfig>;
	readKometaState?: (
		config: AppConfig,
		tmdbId: string,
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
function readDatabaseKometaDocument(config: AppConfig): KometaDocumentState {
	const outputDirectory = kometaOutputDirectory(config);
	const filePath = join(outputDirectory, DEFAULT_FILENAME);
	let metadata: JsonObject = {};
	let parseError = false;
	if (existsSync(filePath)) {
		try {
			const parsed = object(parse(readFileSync(filePath, 'utf8')));
			metadata = object(parsed.metadata);
		} catch {
			parseError = true;
		}
	}
	return { filePath, metadata, parseError };
}

function kometaStateFromDocument(
	document: KometaDocumentState,
	tmdbId: string,
	slot: ResolveApplyDestinationsInput['selections'][number]['slot']
): KometaDestinationState {
	// A malformed file is still represented by a distinct identity and will fail
	// safely during the existing writer. Preview itself remains read-only.
	const entry = document.parseError
		? { __posterpilotParseError: true }
		: child(document.metadata, tmdbId);
	const url = kometaSlotUrl(entry, slot);
	const destinationFingerprint = hashCanonicalJson({
		filePath: document.filePath,
		tmdbId,
		entry
	});
	return {
		targetId: `kometa:${hashCanonicalJson({ filePath: document.filePath, tmdbId })}`,
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
	tmdbId: string,
	slot: ResolveApplyDestinationsInput['selections'][number]['slot']
): Promise<KometaDestinationState> {
	return kometaStateFromDocument(readDatabaseKometaDocument(config), tmdbId, slot);
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
		const config = wantsKometa ? await loadConfig() : null;
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
		const kometaDocument =
			config && !options.readKometaState ? readDatabaseKometaDocument(config) : null;

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

			if (config) {
				const tmdbId = input.target.item.identity.tmdbId;
				if (tmdbId) {
					const state = kometaDocument
						? kometaStateFromDocument(kometaDocument, tmdbId, selection.slot)
						: await readKometaState(config, tmdbId, selection.slot);
					snapshots.push({
						destination: 'kometa',
						slot: selection.slot,
						targetId: state.targetId,
						capability:
							selection.slot.kind === 'background' && selection.slot.season !== null
								? 'unsupported'
								: 'supported',
						current: state.current,
						skipCode: null,
						parameters: {}
					});
				}
			}
		}

		return snapshots;
	};
}
