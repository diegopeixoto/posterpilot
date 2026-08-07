/**
 * Server-side orchestration for the Kometa config-sync feature. Wires the pure
 * merge engine (`config.ts`) to PosterPilot's resolved configuration, persisted
 * selections, and the atomic file I/O. Impure (db + fs) — not unit-tested here;
 * the logic it composes is tested in `config.test.ts` / `config-io.test.ts`.
 */

import { resolve } from 'node:path';
import {
	getCachedLibraries,
	getKometaDefaultCollections,
	getKometaLastApplied,
	getKometaManagedLibraries,
	getKometaManagedSettings,
	resolveConfig,
	type AppConfig,
	type KometaSnapshotScope
} from '$lib/server/config';
import { logEvent } from '$lib/server/events';
import {
	applyPlan,
	buildOwnedDoc,
	buildPlan,
	checkConsistency,
	loadDoc,
	readDefaultList,
	readFileList,
	readScalarMap,
	readSectionKeys,
	redactSecrets,
	serialize,
	topLevelKeys,
	type ApplyResult,
	type ChangeEntry,
	type ConfigPlan,
	type ConsistencyWarning,
	type KometaSnapshot
} from './config';
import type { KometaConfigMode } from '$lib/server/config';
import {
	canonicalConfigPath,
	clearConfigCommitProofAtBinding,
	freezeConfigPath,
	listBackups,
	prepareConfigCommitProofAtBinding,
	readBackupAtBinding,
	readConfig,
	readConfigAtBinding,
	recoverConfigQuarantineAtBinding,
	validateConfigPathBinding,
	withConfigLock,
	writeConfigAtomicAtBinding,
	type BackupInfo
} from './config-io';
import {
	LEGACY_FILENAME,
	MOVIE_FILENAME,
	SHOW_FILENAME,
	type KometaMetadataFilename
} from './destination';
import { classifyKometaLegacyConfig } from './legacy-layout';
import { kometaMetadataReference, kometaMetadataReferenceBasename } from './reference-path';
import { DEFAULT_COLLECTION_GROUPS, knownDefaults, type DefaultGroup } from './defaults-catalog';
import { MANAGED_SETTINGS, type ManagedSettingDef } from './managed-settings';
import {
	CONNECTORS,
	CONNECTOR_DOCS,
	secretFieldKeys,
	type Connector,
	type ConnectorDoc
} from './connectors';
import { OVERLAY_GROUPS, knownOverlays, type OverlayGroup } from './overlay-defaults';
import { OPERATIONS, type Operation } from './operations';
import type { SyncSelectionInput } from './selection';
import {
	kometaBindingErrorCode,
	resolveKometaServerBinding,
	type KometaServerBinding,
	type KometaServerBindingStatus
} from './server-binding';
import {
	KOMETA_CONFIG_PLAN_KIND,
	assertKometaConfigPlanPayload,
	kometaFileFingerprint,
	kometaProposedFingerprint,
	kometaStructuredDependencyFingerprint,
	rawKometaChanges,
	type KometaConfigPlanAction,
	type KometaConfigPlanPayload
} from './plan';
import {
	OperationPlanError,
	operationPlanStore,
	type OperationPlan
} from '$lib/server/plans/operation-plan-store';
import {
	inspectKometaCollisionGuard,
	kometaOutputDirectory
} from '$lib/server/plans/apply-destinations';
import { loadKometaMigrationJournalForGuard } from './migration-store';
import type { KometaMigrationJournalV1 } from './migration-journal';
import { kometaMigrationCollisionState, type PublicKometaMigrationState } from './migration-state';
import { loadCurrentKometaMigrationState } from './migration';
import {
	isKometaConfigMutationLocked,
	type KometaConfigMutationAction
} from '$lib/kometa-config-mutation-policy';
import { withKometaMigrationControlLock } from './migration-control-lock';
import { PhysicalPathInspectionError } from './physical-path-alias';
import {
	createKometaConfigMutationCheckpoint,
	discardKometaConfigMutationCheckpoint,
	loadKometaConfigMutationCheckpoint,
	prepareKometaConfigMutationCheckpoint
} from './config-mutation-checkpoint';
import {
	assertNoPendingKometaConfigMutationWhileOwned,
	completePreparedKometaConfigMutation,
	publicKometaConfigMutationRecoveryState,
	type PublicKometaConfigMutationRecovery
} from './config-mutation-recovery';

function kometaSnapshotScope(config: AppConfig, serverInstanceId: string): KometaSnapshotScope {
	return {
		serverInstanceId,
		configPath: config.kometaConfigPath ? canonicalConfigPath(config.kometaConfigPath) : null,
		outputDirectory: canonicalConfigPath(kometaOutputDirectory(config)),
		metadataPathPrefix: config.kometaMetadataPathPrefix
	};
}

function migrationJournalScopeMatches(
	config: AppConfig,
	serverInstanceId: string,
	journal: KometaMigrationJournalV1 | null
): boolean {
	if (!journal) return false;
	return (
		journal.payload.serverInstanceId === serverInstanceId &&
		canonicalConfigPath(journal.payload.outputDirectory) ===
			canonicalConfigPath(kometaOutputDirectory(config)) &&
		journal.payload.metadataPathPrefix === config.kometaMetadataPathPrefix &&
		Boolean(journal.payload.config.path) === Boolean(config.kometaConfigPath) &&
		(journal.payload.config.path === null ||
			(canonicalConfigPath(journal.payload.config.path) ===
				canonicalConfigPath(config.kometaConfigPath) &&
				journal.payload.config.mode === config.kometaConfigMode))
	);
}

async function configMutationLocked(
	config: AppConfig,
	serverInstanceId: string,
	action: KometaConfigMutationAction
): Promise<boolean> {
	if (await loadKometaConfigMutationCheckpoint()) return true;
	const journal = await loadKometaMigrationJournalForGuard(serverInstanceId);
	return isKometaConfigMutationLocked(
		action,
		journal
			? {
					status: journal.status,
					scopeMatches: migrationJournalScopeMatches(config, serverInstanceId, journal)
				}
			: null
	);
}

export { type SyncSelectionInput } from './selection';

/** State the settings page needs to render the Kometa tab. */
export interface KometaTabState {
	active: boolean;
	mode: KometaConfigMode;
	configPath: string;
	/** The configured path resolved to absolute (where existence is actually checked).
	 *  Surfaced so a relative path against the container CWD is self-diagnosing. */
	resolvedConfigPath: string;
	/** True when the configured path is relative (fragile in Docker — CWD is /app). */
	configPathRelative: boolean;
	/** Canonical Kometa-visible prefix, kept separate from the physical output directory. */
	metadataPathPrefix: string;
	metadataFiles: { movie: typeof MOVIE_FILENAME; show: typeof SHOW_FILENAME };
	metadataReferences: { movie: string; show: string };
	exists: boolean;
	parseError: string | null;
	/** Client-safe identity of the exact Plex instance that owns this target. */
	serverBinding: { id: string; name: string } | null;
	serverBindingStatus: KometaServerBindingStatus;
	managedLibraries: string[];
	defaultCollections: Record<string, string[]>;
	/** Non-secret managed values only. */
	managedSettings: Record<string, string>;
	/** Secret managed-setting ids that have a value, without returning that value. */
	managedSettingSecretsSet: string[];
	/** Catalog of default collection sets, grouped (static; passed so the client
	 *  never imports a `$lib/server` module). */
	catalog: readonly DefaultGroup[];
	/** Bounded managed-setting definitions to render inputs for. */
	managedSettingDefs: readonly ManagedSettingDef[];

	// ── Complete-manager state (consumed by the /kometa page) ──────────────────
	connectorCatalog: readonly Connector[];
	connectorDocs: Readonly<Record<string, ConnectorDoc>>;
	overlayCatalog: readonly OverlayGroup[];
	operationCatalog: readonly Operation[];
	/** Available libraries (section key → title/type) for the manager UI. */
	availableLibraries: { key: string; title: string; type: string }[];
	/** Current non-secret connector field values from the file (section → key → value). */
	connectionValues: Record<string, Record<string, string>>;
	/** Which secret connector fields are currently set in the file (section → keys). */
	connectionSecretsSet: Record<string, string[]>;
	/** Current per-library state read from the file, keyed by Kometa library name. */
	libraryState: Record<
		string,
		{
			collections: string[];
			overlays: string[];
			operations: Record<string, string>;
			settings: Record<string, string>;
			hasMetadata: boolean;
			metadataFiles: string[];
		}
	>;
	/** Current non-secret globals plus set-state for secret webhook fields. */
	globals: { settings: Record<string, string>; webhooksSet: string[] };
	backups: BackupInfo[];
	consistency: ConsistencyWarning[];
	/** Durable split-layout migration state; exact YAML/provider URLs are redacted. */
	migration: PublicKometaMigrationState | null;
	migrationStateError: 'journal_unreadable' | null;
	migrationRequired: boolean;
	migrationReason: 'active_legacy_reference' | 'unknown_config_with_legacy_file' | null;
	/** Redacted durable recovery state for an interrupted, already-confirmed config save. */
	configCommitRecovery: PublicKometaConfigMutationRecovery | null;
}

/** Result of a preview or sync, with secrets redacted for the browser. */
export interface SyncResult {
	active: boolean;
	mode: KometaConfigMode;
	exists: boolean;
	willScaffold: boolean;
	parseError: string | null;
	changes: ChangeEntry[];
	warnings: string[];
	/** In `own` mode: existing top-level keys that will be dropped on write. */
	dropped: string[];
	/** Enabled charts/overlays whose connector is not configured. */
	consistency: ConsistencyWarning[];
	backup?: boolean;
	scaffolded?: boolean;
	planId?: string | null;
	digest?: string | null;
	expiresAt?: string | null;
	sourceFingerprint?: string;
	proposedFingerprint?: string;
	serverBinding?: { id: string; name: string } | null;
}

export interface ConfirmKometaPlanRequest {
	planId: string;
	digest: string;
}

function jsonSafe<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function planIdentity(plan: OperationPlan<KometaConfigPlanPayload>) {
	return {
		planId: plan.id,
		digest: plan.digest,
		expiresAt: plan.expiresAt.toISOString(),
		sourceFingerprint: plan.payload.sourceFingerprint,
		proposedFingerprint: plan.payload.proposedFingerprint,
		serverBinding: {
			id: plan.payload.serverInstanceId,
			name: plan.payload.serverName
		}
	};
}

const POSTERPILOT_METADATA_FILES = new Set<string>([
	LEGACY_FILENAME,
	MOVIE_FILENAME,
	SHOW_FILENAME
]);

class KometaLibraryPlanError extends Error {
	constructor(
		readonly code:
			| 'kometa_library_missing'
			| 'kometa_library_title_conflict'
			| 'kometa_migration_required'
			| 'kometa_migration_config_locked'
	) {
		super(code);
		this.name = 'KometaLibraryPlanError';
	}
}

function requiresKometaLayoutMigration(raw: string): boolean {
	const classification = classifyKometaLegacyConfig(raw);
	return !classification.known || classification.references.length > 0;
}

/** Select a co-located basename from the authoritative media-server library type. */
function metadataFileForLibraryType(type: string): KometaMetadataFilename | null {
	if (type === 'movie') return MOVIE_FILENAME;
	if (type === 'show') return SHOW_FILENAME;
	return null;
}

function recordsForLibraries<T>(
	values: Record<string, T>,
	allowed: Set<string>
): Record<string, T> {
	return Object.fromEntries(Object.entries(values).filter(([key]) => allowed.has(key)));
}

/** Build the desired-state plan from the user's selections + resolved config. */
async function planFromSelections(
	config: AppConfig,
	sel: SyncSelectionInput,
	binding: KometaServerBinding,
	currentManagedSettings: Record<string, string>,
	storedManagedSettings: Record<string, string>
): Promise<{ plan: ConfigPlan; selection: SyncSelectionInput; warnings: string[] }> {
	const cached = await getCachedLibraries(binding.id);
	const libraryByKey = new Map(cached.map((library) => [library.key, library]));
	const supportedLibraryKeys = new Set<string>();
	const selectedLibraryKeys = [...new Set(sel.libraries)];
	const selectedKeyByTitle = new Map<string, string>();
	const warnings = new Set<string>();
	const libraries: Parameters<typeof buildPlan>[0]['libraries'] = [];
	for (const key of selectedLibraryKeys) {
		const library = libraryByKey.get(key);
		if (!library?.title) throw new KometaLibraryPlanError('kometa_library_missing');
		const metadataFile = metadataFileForLibraryType(library.type);
		if (!metadataFile) {
			warnings.add('kometa_library_type_unsupported');
			continue;
		}
		const existingKey = selectedKeyByTitle.get(library.title);
		// Kometa libraries are keyed by title in YAML. Two authoritative sections
		// cannot safely share that key: one would overwrite the other's typed file
		// and snapshot ownership. Fail closed until the source titles are distinct.
		if (existingKey !== undefined && existingKey !== key) {
			throw new KometaLibraryPlanError('kometa_library_title_conflict');
		}
		selectedKeyByTitle.set(library.title, key);
		supportedLibraryKeys.add(key);
		libraries.push({
			name: library.title,
			defaults: knownDefaults(sel.defaults[key] ?? []),
			overlays: knownOverlays(sel.overlays[key] ?? []),
			operations: sel.operations[key] ?? {},
			settingsOverrides: sel.librarySettings[key] ?? {},
			metadataFile,
			metadataReference: kometaMetadataReference(config.kometaMetadataPathPrefix, metadataFile)
		});
	}
	const selection: SyncSelectionInput = {
		...sel,
		libraries: selectedLibraryKeys.filter((key) => supportedLibraryKeys.has(key)),
		defaults: recordsForLibraries(sel.defaults, supportedLibraryKeys),
		overlays: recordsForLibraries(sel.overlays, supportedLibraryKeys),
		operations: recordsForLibraries(sel.operations, supportedLibraryKeys),
		librarySettings: recordsForLibraries(sel.librarySettings, supportedLibraryKeys)
	};

	// A blank secret means "leave the stored value alone" → carry it forward via
	// connectionKeep so it is not deleted on resync. A blank non-secret means
	// "remove it" (handled by applyManagedMap's removal pass).
	const connections: Record<string, Record<string, string>> = {};
	const connectionKeep: Record<string, string[]> = {};
	for (const [section, fields] of Object.entries(sel.connections)) {
		const secrets = secretFieldKeys(section);
		const values: Record<string, string> = {};
		const keep: string[] = [];
		for (const [k, v] of Object.entries(fields)) {
			if (v === '' && secrets.has(k)) keep.push(k);
			else values[k] = v;
		}
		connections[section] = values;
		if (keep.length) connectionKeep[section] = keep;
	}

	const settings = [] as ConfigPlan['settings'];
	const settingKeep: string[] = [];
	for (const def of MANAGED_SETTINGS) {
		const value = sel.settings[def.id]?.trim() ?? '';
		if (value) {
			settings.push({ section: def.section, key: def.key, value });
			continue;
		}
		if (!def.secret) continue;

		const currentValue = currentManagedSettings[def.id] ?? '';
		const storedValue = storedManagedSettings[def.id] ?? '';
		if (config.kometaConfigMode === 'merge' && currentValue) {
			settingKeep.push(`${def.section}.${def.key}`);
		} else if (currentValue || storedValue) {
			// In own/scaffold mode the document is rebuilt, so the server-held value
			// must be copied into the proposed content without round-tripping via SSR.
			settings.push({
				section: def.section,
				key: def.key,
				value: currentValue || storedValue
			});
		}
	}

	return {
		plan: buildPlan({
			creds: { plexUrl: binding.plexUrl, plexToken: binding.plexToken, tmdbKey: config.tmdbKey },
			metadataPathPrefix: config.kometaMetadataPathPrefix,
			libraries,
			settings,
			settingKeep,
			connections,
			connectionKeep
		}),
		selection,
		warnings: [...warnings]
	};
}

function readManagedSettingValues(doc: ReturnType<typeof loadDoc>): Record<string, string> {
	const bySection = new Map<string, Record<string, string>>();
	const values: Record<string, string> = {};
	for (const def of MANAGED_SETTINGS) {
		let section = bySection.get(def.section);
		if (!section) {
			section = readScalarMap(doc, [def.section]);
			bySection.set(def.section, section);
		}
		const value = section[def.key];
		if (value !== undefined && value !== '') values[def.id] = value;
	}
	return values;
}

function syncStoredSecretSettings(
	base: Record<string, string>,
	proposedContent: string
): Record<string, string> {
	const next = { ...base };
	const doc = loadDoc(proposedContent);
	if (doc.errors.length) return next;
	const proposed = readManagedSettingValues(doc);
	for (const def of MANAGED_SETTINGS) {
		if (!def.secret) continue;
		if (proposed[def.id]) next[def.id] = proposed[def.id];
		else delete next[def.id];
	}
	return next;
}

/** Load everything the Kometa manager page needs to render. */
export async function loadKometaState(): Promise<KometaTabState> {
	const config = await resolveConfig();
	const resolvedBinding = await resolveKometaServerBinding(config.kometaServerInstanceId);
	const binding = resolvedBinding.binding;
	const active = Boolean(config.kometaConfigPath);
	let exists = false;
	let parseError: string | null = null;
	let doc = loadDoc('');
	if (active) {
		const raw = readConfig(config.kometaConfigPath);
		exists = raw !== null;
		if (raw !== null) {
			const parsed = loadDoc(raw);
			if (parsed.errors.length) parseError = parsed.errors[0].message;
			else doc = parsed;
		}
	}

	const cached = binding ? await getCachedLibraries(binding.id) : [];
	let migrationJournal: KometaMigrationJournalV1 | null = null;
	let migration: PublicKometaMigrationState | null = null;
	let migrationStateError: KometaTabState['migrationStateError'] = null;
	try {
		migrationJournal = await loadKometaMigrationJournalForGuard(
			binding?.id ?? config.kometaServerInstanceId
		);
		if (migrationJournal) migration = await loadCurrentKometaMigrationState();
	} catch {
		migrationStateError = 'journal_unreadable';
	}
	const migrationGuard = inspectKometaCollisionGuard(
		config,
		kometaMigrationCollisionState(migrationJournal)
	);
	const storedManagedSettings = await getKometaManagedSettings();
	const configCommitRecovery = await publicKometaConfigMutationRecoveryState();
	const currentManagedSettings = readManagedSettingValues(doc);
	const managedSettings: Record<string, string> = {};
	const managedSettingSecretsSet: string[] = [];
	for (const def of MANAGED_SETTINGS) {
		if (def.secret) {
			if (currentManagedSettings[def.id] || storedManagedSettings[def.id]) {
				managedSettingSecretsSet.push(def.id);
			}
		} else if (storedManagedSettings[def.id]) {
			managedSettings[def.id] = storedManagedSettings[def.id];
		}
	}

	// Connector current values — never expose secret values, only "is set".
	const connectionValues: Record<string, Record<string, string>> = {};
	const connectionSecretsSet: Record<string, string[]> = {};
	for (const c of CONNECTORS) {
		const cur = readScalarMap(doc, [c.section]);
		const secrets = secretFieldKeys(c.section);
		const vals: Record<string, string> = {};
		const setSecrets: string[] = [];
		for (const [k, v] of Object.entries(cur)) {
			if (secrets.has(k)) {
				if (v !== '') setSecrets.push(k);
			} else {
				vals[k] = v;
			}
		}
		connectionValues[c.section] = vals;
		connectionSecretsSet[c.section] = setSecrets;
	}

	// Per-library current state from the file.
	const libraryState: KometaTabState['libraryState'] = {};
	for (const name of readSectionKeys(doc, ['libraries'])) {
		const metadataFiles = readFileList(doc, name);
		libraryState[name] = {
			collections: readDefaultList(doc, name, 'collection_files'),
			overlays: readDefaultList(doc, name, 'overlay_files'),
			operations: readScalarMap(doc, ['libraries', name, 'operations']),
			settings: readScalarMap(doc, ['libraries', name, 'settings']),
			hasMetadata: metadataFiles.some((file) => {
				const basename = kometaMetadataReferenceBasename(file);
				return basename !== null && POSTERPILOT_METADATA_FILES.has(basename);
			}),
			metadataFiles
		};
	}

	// Consistency against the file's current enabled features.
	const currentPlan = buildPlan({
		creds: {
			plexUrl: binding?.plexUrl ?? null,
			plexToken: binding?.plexToken ?? null,
			tmdbKey: config.tmdbKey
		},
		metadataPathPrefix: config.kometaMetadataPathPrefix,
		libraries: Object.entries(libraryState).map(([name, s]) => ({
			name,
			defaults: s.collections,
			overlays: s.overlays,
			metadataFile: null
		}))
	});

	return {
		active,
		mode: config.kometaConfigMode,
		configPath: config.kometaConfigPath,
		resolvedConfigPath: active ? resolve(config.kometaConfigPath) : '',
		configPathRelative: active && !config.kometaConfigPath.startsWith('/'),
		metadataPathPrefix: config.kometaMetadataPathPrefix,
		metadataFiles: { movie: MOVIE_FILENAME, show: SHOW_FILENAME },
		metadataReferences: {
			movie: kometaMetadataReference(config.kometaMetadataPathPrefix, MOVIE_FILENAME),
			show: kometaMetadataReference(config.kometaMetadataPathPrefix, SHOW_FILENAME)
		},
		exists,
		parseError,
		serverBinding: binding ? { id: binding.id, name: binding.name } : null,
		serverBindingStatus: resolvedBinding.status,
		managedLibraries: await getKometaManagedLibraries(),
		defaultCollections: await getKometaDefaultCollections(),
		managedSettings,
		managedSettingSecretsSet,
		catalog: DEFAULT_COLLECTION_GROUPS,
		managedSettingDefs: MANAGED_SETTINGS,
		connectorCatalog: CONNECTORS,
		connectorDocs: CONNECTOR_DOCS,
		overlayCatalog: OVERLAY_GROUPS,
		operationCatalog: OPERATIONS,
		availableLibraries: cached.map((l) => ({ key: l.key, title: l.title, type: l.type })),
		connectionValues,
		connectionSecretsSet,
		libraryState,
		globals: {
			settings: readScalarMap(doc, ['settings']),
			webhooksSet: MANAGED_SETTINGS.filter(
				(def) => def.secret && def.section === 'webhooks' && currentManagedSettings[def.id]
			).map((def) => def.key)
		},
		backups: active && exists ? listBackups(config.kometaConfigPath) : [],
		consistency: checkConsistency(currentPlan, doc),
		migration,
		migrationStateError,
		migrationRequired: migrationGuard.migrationRequired,
		migrationReason:
			migrationGuard.reason === 'migration_incomplete' ? null : migrationGuard.reason,
		configCommitRecovery
	};
}

/** A SyncResult for when the feature is off (no config path set). */
function inactiveResult(): SyncResult {
	return {
		active: false,
		mode: 'merge',
		exists: false,
		willScaffold: false,
		parseError: null,
		changes: [],
		warnings: [],
		dropped: [],
		consistency: []
	};
}

/** A SyncResult carrying a parse error (file present but unparseable). */
function parseErrorResult(mode: KometaConfigMode, message: string): SyncResult {
	return {
		active: true,
		mode,
		exists: true,
		willScaffold: false,
		parseError: message,
		changes: [],
		warnings: [],
		dropped: [],
		consistency: []
	};
}

function bindingErrorResult(
	config: AppConfig,
	status: Exclude<KometaServerBindingStatus, 'ready'>
): SyncResult {
	return {
		active: Boolean(config.kometaConfigPath),
		mode: config.kometaConfigMode,
		exists: Boolean(config.kometaConfigPath && readConfig(config.kometaConfigPath) !== null),
		willScaffold: false,
		parseError: null,
		changes: [],
		warnings: [kometaBindingErrorCode(status)],
		dropped: [],
		consistency: []
	};
}

function libraryPlanErrorResult(
	config: AppConfig,
	raw: string | null,
	error: KometaLibraryPlanError
): SyncResult {
	return {
		active: true,
		mode: config.kometaConfigMode,
		exists: raw !== null,
		willScaffold: false,
		parseError: null,
		changes: [],
		warnings: [error.code],
		dropped: [],
		consistency: [],
		planId: null,
		digest: null,
		expiresAt: null
	};
}

/**
 * Compute what a sync would do against the current file: in `merge` mode this is
 * the surgical diff; in `own` mode it is a full regeneration plus the list of
 * existing top-level keys that would be dropped. Returns null on a parse error
 * (the caller turns that into a parseErrorResult).
 */
function computeSync(
	config: AppConfig,
	plan: ConfigPlan,
	raw: string | null,
	snapshot: KometaSnapshot | null
): { res: ApplyResult; dropped: string[]; willScaffold: boolean } | { parseError: string } {
	const exists = raw !== null;
	if (config.kometaConfigMode === 'own') {
		const res = buildOwnedDoc(plan);
		const dropped = exists
			? (() => {
					const old = loadDoc(raw as string);
					if (old.errors.length) return null;
					const ownedKeys = new Set(topLevelKeys(res.doc));
					return topLevelKeys(old).filter((k) => !ownedKeys.has(k));
				})()
			: [];
		if (dropped === null) return { parseError: 'config.yml could not be parsed' };
		return { res, dropped, willScaffold: !exists };
	}
	// merge mode
	if (!exists) return { res: applyPlan(loadDoc(''), plan, null), dropped: [], willScaffold: true };
	const doc = loadDoc(raw as string);
	if (doc.errors.length) return { parseError: doc.errors[0].message };
	return { res: applyPlan(doc, plan, snapshot), dropped: [], willScaffold: false };
}

async function withCurrentConfigReadLock<T>(
	operation: (config: AppConfig, pathBinding: ReturnType<typeof freezeConfigPath>) => Promise<T>
): Promise<T | null> {
	for (;;) {
		const initial = await resolveConfig();
		if (!initial.kometaConfigPath) return null;
		const attempt = await withConfigLock(initial.kometaConfigPath, async () => {
			const current = await resolveConfig();
			if (current.kometaConfigPath !== initial.kometaConfigPath) {
				return { retry: true as const };
			}
			const pathBinding = freezeConfigPath(current.kometaConfigPath);
			return { retry: false as const, value: await operation(current, pathBinding) };
		});
		if (!attempt.retry) return attempt.value;
	}
}

/** Compute the diff a sync would make, without writing anything. */
async function previewSyncAtBinding(
	sel: SyncSelectionInput,
	config: AppConfig,
	pathBinding: ReturnType<typeof freezeConfigPath>
): Promise<SyncResult> {
	const resolvedBinding = await resolveKometaServerBinding(config.kometaServerInstanceId);
	if (!resolvedBinding.binding) {
		return bindingErrorResult(
			config,
			resolvedBinding.status as Exclude<KometaServerBindingStatus, 'ready'>
		);
	}
	const binding = resolvedBinding.binding;
	if (await configMutationLocked(config, binding.id, 'structured')) {
		return libraryPlanErrorResult(
			config,
			readConfig(config.kometaConfigPath),
			new KometaLibraryPlanError('kometa_migration_config_locked')
		);
	}
	const raw = readConfigAtBinding(pathBinding);
	const sourceDoc = loadDoc(raw ?? '');
	if (sourceDoc.errors.length > 0) {
		return parseErrorResult(config.kometaConfigMode, sourceDoc.errors[0].message);
	}
	// Deliberately block the whole structured config plan: changing settings while
	// preserving a legacy metadata reference would produce a seemingly successful
	// sync that still cannot authorize typed artwork writes. The dedicated migration
	// previews and activates the config plus split files as one recoverable operation.
	if (raw !== null && requiresKometaLayoutMigration(raw)) {
		return libraryPlanErrorResult(
			config,
			raw,
			new KometaLibraryPlanError('kometa_migration_required')
		);
	}
	const [snapshot, storedManagedSettings] = await Promise.all([
		getKometaLastApplied(kometaSnapshotScope(config, binding.id)),
		getKometaManagedSettings()
	]);
	let planned: Awaited<ReturnType<typeof planFromSelections>>;
	try {
		planned = await planFromSelections(
			config,
			sel,
			binding,
			readManagedSettingValues(sourceDoc),
			storedManagedSettings
		);
	} catch (error) {
		if (error instanceof KometaLibraryPlanError) {
			return libraryPlanErrorResult(config, raw, error);
		}
		throw error;
	}
	const { plan, selection, warnings: planningWarnings } = planned;

	const out = computeSync(config, plan, raw, snapshot);
	if ('parseError' in out) return parseErrorResult(config.kometaConfigMode, out.parseError);
	const consistency = checkConsistency(plan, raw !== null ? loadDoc(raw) : loadDoc(''));
	const proposedContent = serialize(out.res.doc);
	const warnings = [...new Set([...out.res.warnings, ...planningWarnings])];
	const payload = jsonSafe<KometaConfigPlanPayload>({
		type: KOMETA_CONFIG_PLAN_KIND,
		version: 2,
		action: 'structured',
		serverInstanceId: binding.id,
		serverName: binding.name,
		configPath: config.kometaConfigPath,
		pathBinding,
		mode: config.kometaConfigMode,
		sourceContent: raw,
		sourceFingerprint: kometaFileFingerprint(raw),
		proposedFingerprint: kometaProposedFingerprint(proposedContent),
		structuredDependencyFingerprint: kometaStructuredDependencyFingerprint({
			serverInstanceId: binding.id,
			plexUrl: binding.plexUrl,
			plexToken: binding.plexToken,
			tmdbKey: config.tmdbKey
		}),
		proposedContent,
		display: {
			changes: out.res.changes,
			warnings,
			dropped: out.dropped,
			consistency,
			willScaffold: out.willScaffold
		},
		structured: { selection, nextSnapshot: out.res.nextSnapshot },
		restore: null
	});
	assertKometaConfigPlanPayload(payload);
	const frozen = await operationPlanStore.create({
		kind: KOMETA_CONFIG_PLAN_KIND,
		serverInstanceId: binding.id,
		payload
	});
	return {
		active: true,
		mode: config.kometaConfigMode,
		exists: raw !== null,
		willScaffold: out.willScaffold,
		parseError: null,
		changes: redactSecrets(out.res.changes),
		warnings,
		dropped: out.dropped,
		consistency,
		...planIdentity(frozen)
	};
}

export async function previewSync(sel: SyncSelectionInput): Promise<SyncResult> {
	return (
		(await withCurrentConfigReadLock((config, binding) =>
			previewSyncAtBinding(sel, config, binding)
		)) ?? inactiveResult()
	);
}

/** Result of a raw-editor/restore preview or confirmation. */
export interface RawResult {
	ok: boolean;
	active?: boolean;
	parseError: string | null;
	backup?: boolean;
	errorCode?: string;
	changes?: ChangeEntry[];
	warnings?: string[];
	planId?: string | null;
	digest?: string | null;
	expiresAt?: string | null;
	sourceFingerprint?: string;
	proposedFingerprint?: string;
	serverBinding?: { id: string; name: string } | null;
	action?: KometaConfigPlanAction;
	backupName?: string;
}

/** Read the current raw config text (for the raw editor). */
export async function loadRaw(): Promise<{ active: boolean; text: string }> {
	return (
		(await withCurrentConfigReadLock(async (_config, binding) => ({
			active: true,
			text: readConfigAtBinding(binding) ?? ''
		}))) ?? { active: false, text: '' }
	);
}

function rawBindingError(status: Exclude<KometaServerBindingStatus, 'ready'>): RawResult {
	return {
		ok: false,
		active: true,
		parseError: null,
		errorCode: kometaBindingErrorCode(status)
	};
}

/** Validate raw YAML and issue a single-use exact-content preview. */
async function previewRawConfigAtBinding(
	text: string,
	config: AppConfig,
	pathBinding: ReturnType<typeof freezeConfigPath>
): Promise<RawResult> {
	const resolvedBinding = await resolveKometaServerBinding(config.kometaServerInstanceId);
	if (!resolvedBinding.binding) {
		return rawBindingError(resolvedBinding.status as Exclude<KometaServerBindingStatus, 'ready'>);
	}
	const binding = resolvedBinding.binding;
	if (await configMutationLocked(config, binding.id, 'raw')) {
		return {
			ok: false,
			active: true,
			parseError: null,
			errorCode: 'kometa_migration_config_locked'
		};
	}
	const doc = loadDoc(text);
	if (doc.errors.length) return { ok: false, active: true, parseError: doc.errors[0].message };
	const raw = readConfigAtBinding(pathBinding);
	const diff = rawKometaChanges(raw, text);
	if (kometaFileFingerprint(raw) === kometaFileFingerprint(text)) {
		return { ok: true, active: true, parseError: null, changes: [], planId: null };
	}
	const payload: KometaConfigPlanPayload = {
		type: KOMETA_CONFIG_PLAN_KIND,
		version: 2,
		action: 'raw',
		serverInstanceId: binding.id,
		serverName: binding.name,
		configPath: config.kometaConfigPath,
		pathBinding,
		mode: config.kometaConfigMode,
		sourceContent: raw,
		sourceFingerprint: kometaFileFingerprint(raw),
		proposedFingerprint: kometaProposedFingerprint(text),
		structuredDependencyFingerprint: null,
		proposedContent: text,
		display: {
			changes: diff.changes,
			warnings: diff.truncated ? ['diff_truncated'] : [],
			dropped: [],
			consistency: [],
			willScaffold: raw === null
		},
		structured: null,
		restore: null
	};
	assertKometaConfigPlanPayload(payload);
	const frozen = await operationPlanStore.create({
		kind: KOMETA_CONFIG_PLAN_KIND,
		serverInstanceId: binding.id,
		payload
	});
	return {
		ok: true,
		active: true,
		parseError: null,
		changes: diff.changes,
		warnings: payload.display.warnings,
		action: 'raw',
		...planIdentity(frozen)
	};
}

export async function previewRawConfig(text: string): Promise<RawResult> {
	return (
		(await withCurrentConfigReadLock((config, binding) =>
			previewRawConfigAtBinding(text, config, binding)
		)) ?? { ok: false, active: false, parseError: null }
	);
}

/** Read a backup, diff it against current bytes, and issue a bound restore preview. */
async function previewRestoreConfigAtBinding(
	name: string,
	config: AppConfig,
	pathBinding: ReturnType<typeof freezeConfigPath>
): Promise<RawResult> {
	const resolvedBinding = await resolveKometaServerBinding(config.kometaServerInstanceId);
	if (!resolvedBinding.binding) {
		return rawBindingError(resolvedBinding.status as Exclude<KometaServerBindingStatus, 'ready'>);
	}
	const binding = resolvedBinding.binding;
	if (await configMutationLocked(config, binding.id, 'restore')) {
		return {
			ok: false,
			active: true,
			parseError: null,
			errorCode: 'kometa_migration_config_locked'
		};
	}
	let backupContent: string;
	try {
		backupContent = readBackupAtBinding(pathBinding, name);
	} catch (error) {
		return {
			ok: false,
			active: true,
			parseError: error instanceof Error ? error.message : String(error)
		};
	}
	const doc = loadDoc(backupContent);
	if (doc.errors.length) return { ok: false, active: true, parseError: doc.errors[0].message };
	const raw = readConfigAtBinding(pathBinding);
	const diff = rawKometaChanges(raw, backupContent);
	if (kometaFileFingerprint(raw) === kometaFileFingerprint(backupContent)) {
		return {
			ok: true,
			active: true,
			parseError: null,
			changes: [],
			planId: null,
			backupName: name
		};
	}
	const payload: KometaConfigPlanPayload = {
		type: KOMETA_CONFIG_PLAN_KIND,
		version: 2,
		action: 'restore',
		serverInstanceId: binding.id,
		serverName: binding.name,
		configPath: config.kometaConfigPath,
		pathBinding,
		mode: config.kometaConfigMode,
		sourceContent: raw,
		sourceFingerprint: kometaFileFingerprint(raw),
		proposedFingerprint: kometaProposedFingerprint(backupContent),
		structuredDependencyFingerprint: null,
		proposedContent: backupContent,
		display: {
			changes: diff.changes,
			warnings: diff.truncated ? ['diff_truncated'] : [],
			dropped: [],
			consistency: [],
			willScaffold: raw === null
		},
		structured: null,
		restore: {
			backupName: name,
			backupFingerprint: kometaFileFingerprint(backupContent)
		}
	};
	assertKometaConfigPlanPayload(payload);
	const frozen = await operationPlanStore.create({
		kind: KOMETA_CONFIG_PLAN_KIND,
		serverInstanceId: binding.id,
		payload
	});
	return {
		ok: true,
		active: true,
		parseError: null,
		changes: diff.changes,
		warnings: payload.display.warnings,
		action: 'restore',
		backupName: name,
		...planIdentity(frozen)
	};
}

export async function previewRestoreConfig(name: string): Promise<RawResult> {
	return (
		(await withCurrentConfigReadLock((config, binding) =>
			previewRestoreConfigAtBinding(name, config, binding)
		)) ?? { ok: false, active: false, parseError: null }
	);
}

async function validateStoredKometaPlan(
	request: ConfirmKometaPlanRequest,
	expectedAction: KometaConfigPlanAction
): Promise<OperationPlan<KometaConfigPlanPayload>> {
	if (!request.planId || !/^[0-9a-f]{64}$/.test(request.digest)) {
		throw new OperationPlanError('plan_digest_mismatch', request.planId || 'unknown');
	}
	const plan = await operationPlanStore.validate<KometaConfigPlanPayload>(request.planId, {
		kind: KOMETA_CONFIG_PLAN_KIND,
		digest: request.digest
	});
	try {
		assertKometaConfigPlanPayload(plan.payload);
	} catch {
		throw new OperationPlanError('plan_corrupt', request.planId);
	}
	if (plan.payload.action !== expectedAction) {
		throw new OperationPlanError('plan_kind_mismatch', request.planId);
	}
	return plan;
}

async function confirmKometaConfigPlan(
	request: ConfirmKometaPlanRequest,
	expectedAction: KometaConfigPlanAction
): Promise<{ payload: KometaConfigPlanPayload; backup: boolean }> {
	const initial = await validateStoredKometaPlan(request, expectedAction);
	return withConfigLock(initial.payload.configPath, async () => {
		const { consumed, backup } = await withKometaMigrationControlLock(
			async (assertControlLockOwned) => {
				const pending = await validateStoredKometaPlan(request, expectedAction);
				try {
					await assertNoPendingKometaConfigMutationWhileOwned(assertControlLockOwned);
				} catch {
					throw new OperationPlanError('plan_stale', request.planId);
				}
				const config = await resolveConfig();
				const resolvedBinding = await resolveKometaServerBinding(config.kometaServerInstanceId);
				const binding = resolvedBinding.binding;
				if (
					!binding ||
					binding.id !== pending.payload.serverInstanceId ||
					config.kometaConfigPath !== pending.payload.configPath ||
					config.kometaConfigMode !== pending.payload.mode ||
					(expectedAction === 'structured' &&
						(pending.payload.structured?.nextSnapshot.metadataPathPrefix !==
							config.kometaMetadataPathPrefix ||
							pending.payload.structuredDependencyFingerprint !==
								kometaStructuredDependencyFingerprint({
									serverInstanceId: binding.id,
									plexUrl: binding.plexUrl,
									plexToken: binding.plexToken,
									tmdbKey: config.tmdbKey
								})))
				) {
					throw new OperationPlanError('plan_stale', request.planId);
				}
				if (await configMutationLocked(config, binding.id, expectedAction)) {
					throw new OperationPlanError('plan_stale', request.planId);
				}

				const pathBinding = validateConfigPathBinding(pending.payload.pathBinding);
				if (canonicalConfigPath(config.kometaConfigPath) !== pathBinding.canonicalPath) {
					throw new OperationPlanError('plan_stale', request.planId);
				}
				await assertControlLockOwned();
				recoverConfigQuarantineAtBinding(pathBinding);
				let current: string | null;
				try {
					current = readConfigAtBinding(pathBinding);
				} catch (error) {
					if (error instanceof PhysicalPathInspectionError) {
						throw new OperationPlanError('plan_stale', request.planId);
					}
					throw error;
				}
				if (
					expectedAction === 'structured' &&
					current !== null &&
					requiresKometaLayoutMigration(current)
				) {
					throw new OperationPlanError('plan_stale', request.planId);
				}
				if (
					current !== pending.payload.sourceContent ||
					kometaFileFingerprint(current) !== pending.payload.sourceFingerprint
				) {
					throw new OperationPlanError('plan_stale', request.planId);
				}
				if (pending.payload.restore) {
					let backupContent: string;
					try {
						backupContent = readBackupAtBinding(pathBinding, pending.payload.restore.backupName);
					} catch {
						throw new OperationPlanError('plan_stale', request.planId);
					}
					if (
						kometaFileFingerprint(backupContent) !== pending.payload.restore.backupFingerprint ||
						kometaProposedFingerprint(backupContent) !== pending.payload.proposedFingerprint
					) {
						throw new OperationPlanError('plan_stale', request.planId);
					}
				}

				let managedSettings = await getKometaManagedSettings();
				if (pending.payload.structured) {
					managedSettings = pending.payload.structured.selection.settings;
				}
				const nextManagedSettings = syncStoredSecretSettings(
					managedSettings,
					pending.payload.proposedContent
				);
				const stateCommit = {
					managedSettings: nextManagedSettings,
					structured: pending.payload.structured
						? {
								managedLibraries: pending.payload.structured.selection.libraries,
								defaultCollections: pending.payload.structured.selection.defaults,
								lastApplied: pending.payload.structured.nextSnapshot,
								scope: kometaSnapshotScope(config, binding.id)
							}
						: undefined
				};
				const checkpoint = createKometaConfigMutationCheckpoint({
					planId: pending.id,
					planDigest: pending.digest,
					action: pending.payload.action,
					configMode: pending.payload.mode,
					metadataPathPrefix: config.kometaMetadataPathPrefix,
					serverInstanceId: pending.payload.serverInstanceId,
					pathBinding,
					sourceContent: pending.payload.sourceContent,
					sourceFingerprint: pending.payload.sourceFingerprint,
					proposedContent: pending.payload.proposedContent,
					proposedFingerprint: pending.payload.proposedFingerprint,
					structuredDependencyFingerprint: pending.payload.structuredDependencyFingerprint,
					stateCommit
				});
				// Reserve and fsync the exact proof inode before the checkpoint becomes
				// visible. A writer that later loses its lease can consume this inode,
				// but can never recreate it after recovery cancels the attempt.
				await assertControlLockOwned();
				prepareConfigCommitProofAtBinding(
					pathBinding,
					checkpoint.proofToken,
					checkpoint.proposedContent
				);
				const prepareLease = await assertControlLockOwned();
				await prepareKometaConfigMutationCheckpoint(checkpoint, prepareLease);

				let consumed: OperationPlan<KometaConfigPlanPayload>;
				try {
					consumed = await operationPlanStore.consume<KometaConfigPlanPayload>(request.planId, {
						kind: KOMETA_CONFIG_PLAN_KIND,
						digest: request.digest,
						serverInstanceId: pending.payload.serverInstanceId
					});
				} catch (error) {
					const discardLease = await assertControlLockOwned();
					await discardKometaConfigMutationCheckpoint(checkpoint, discardLease);
					clearConfigCommitProofAtBinding(
						checkpoint.pathBinding,
						checkpoint.proofToken,
						checkpoint.proposedContent
					);
					throw error;
				}
				// Renew immediately before the synchronous file CAS. The control lock remains
				// held until every derived ownership setting and the checkpoint are durable.
				await assertControlLockOwned();
				let backup: string | null;
				try {
					({ backup } = writeConfigAtomicAtBinding(
						consumed.payload.pathBinding,
						consumed.payload.proposedContent,
						new Date().toISOString(),
						{
							expectedSource: consumed.payload.sourceContent,
							proofToken: checkpoint.proofToken,
							preparedProof: true
						}
					));
				} catch (error) {
					if (error instanceof PhysicalPathInspectionError) {
						throw new OperationPlanError('plan_stale', request.planId);
					}
					throw error;
				}
				await completePreparedKometaConfigMutation(checkpoint, assertControlLockOwned);
				return { consumed, backup };
			}
		);

		await logEvent(
			'info',
			'kometa',
			consumed.payload.action === 'structured'
				? consumed.payload.display.willScaffold
					? 'Created Kometa config.yml from confirmed preview'
					: `Synced Kometa config.yml from confirmed preview (${consumed.payload.mode})`
				: consumed.payload.action === 'raw'
					? 'Saved Kometa config.yml from confirmed raw preview'
					: 'Restored Kometa config.yml from confirmed backup preview',
			{
				serverInstanceId: consumed.payload.serverInstanceId,
				serverName: consumed.payload.serverName,
				operationPlanId: consumed.id,
				action: consumed.payload.action,
				mode: consumed.payload.mode,
				changes: consumed.payload.display.changes.length,
				backup: backup !== null,
				backupName: consumed.payload.restore?.backupName ?? null
			}
		);

		return { payload: consumed.payload, backup: backup !== null };
	});
}

/** Confirm one unchanged structured preview; never recomputes selections. */
export async function runSync(request: ConfirmKometaPlanRequest): Promise<SyncResult> {
	const { payload, backup } = await confirmKometaConfigPlan(request, 'structured');
	return {
		active: true,
		mode: payload.mode,
		exists: true,
		willScaffold: false,
		parseError: null,
		scaffolded: payload.display.willScaffold,
		backup,
		changes: redactSecrets(payload.display.changes),
		warnings: payload.display.warnings,
		dropped: payload.display.dropped,
		consistency: payload.display.consistency,
		serverBinding: { id: payload.serverInstanceId, name: payload.serverName }
	};
}

export async function confirmRawConfig(request: ConfirmKometaPlanRequest): Promise<RawResult> {
	const { payload, backup } = await confirmKometaConfigPlan(request, 'raw');
	return {
		ok: true,
		active: true,
		parseError: null,
		backup,
		action: 'raw',
		changes: payload.display.changes,
		warnings: payload.display.warnings,
		serverBinding: { id: payload.serverInstanceId, name: payload.serverName }
	};
}

export async function confirmRestoreConfig(request: ConfirmKometaPlanRequest): Promise<RawResult> {
	const { payload, backup } = await confirmKometaConfigPlan(request, 'restore');
	return {
		ok: true,
		active: true,
		parseError: null,
		backup,
		action: 'restore',
		backupName: payload.restore?.backupName,
		changes: payload.display.changes,
		warnings: payload.display.warnings,
		serverBinding: { id: payload.serverInstanceId, name: payload.serverName }
	};
}

/** List backups for the configured file (for a refresh). */
export async function getBackups(): Promise<BackupInfo[]> {
	const config = await resolveConfig();
	if (!config.kometaConfigPath) return [];
	return listBackups(config.kometaConfigPath);
}
