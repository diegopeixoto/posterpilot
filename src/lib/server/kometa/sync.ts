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
	setKometaDefaultCollections,
	setKometaLastApplied,
	setKometaManagedLibraries,
	setKometaManagedSettings,
	type AppConfig
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
	listBackups,
	readBackup,
	readConfig,
	withConfigLock,
	writeConfigAtomic,
	type BackupInfo
} from './config-io';
import { DEFAULT_FILENAME } from './yaml';
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
	rawKometaChanges,
	type KometaConfigPlanAction,
	type KometaConfigPlanPayload
} from './plan';
import {
	OperationPlanError,
	operationPlanStore,
	type OperationPlan
} from '$lib/server/plans/operation-plan-store';

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
	metadataFile: string;
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
		}
	>;
	/** Current non-secret globals plus set-state for secret webhook fields. */
	globals: { settings: Record<string, string>; webhooksSet: string[] };
	backups: BackupInfo[];
	consistency: ConsistencyWarning[];
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

/**
 * The `metadata_files` `file:` value written into config.yml. PosterPilot writes
 * `posterpilot.yml` into the config-file's own directory, so the reference is the
 * bare basename — Kometa resolves it relative to its config directory.
 */
function metadataFilePath(_config: AppConfig): string {
	return DEFAULT_FILENAME;
}

/** Build the desired-state plan from the user's selections + resolved config. */
async function planFromSelections(
	config: AppConfig,
	sel: SyncSelectionInput,
	binding: KometaServerBinding,
	currentManagedSettings: Record<string, string>,
	storedManagedSettings: Record<string, string>
): Promise<ConfigPlan> {
	const cached = await getCachedLibraries(binding.id);
	const titleByKey = new Map(cached.map((l) => [l.key, l.title]));
	const libraries = sel.libraries
		.map((key) => ({
			name: titleByKey.get(key) ?? '',
			defaults: knownDefaults(sel.defaults[key] ?? []),
			overlays: knownOverlays(sel.overlays[key] ?? []),
			operations: sel.operations[key] ?? {},
			settingsOverrides: sel.librarySettings[key] ?? {},
			metadata: true
		}))
		.filter((l) => l.name !== '');

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

	return buildPlan({
		creds: { plexUrl: binding.plexUrl, plexToken: binding.plexToken, tmdbKey: config.tmdbKey },
		metadataFile: metadataFilePath(config),
		libraries,
		settings,
		settingKeep,
		connections,
		connectionKeep
	});
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
	const metadataRef = metadataFilePath(config);
	const storedManagedSettings = await getKometaManagedSettings();
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
		libraryState[name] = {
			collections: readDefaultList(doc, name, 'collection_files'),
			overlays: readDefaultList(doc, name, 'overlay_files'),
			operations: readScalarMap(doc, ['libraries', name, 'operations']),
			settings: readScalarMap(doc, ['libraries', name, 'settings']),
			hasMetadata: readFileList(doc, name).includes(metadataRef)
		};
	}

	// Consistency against the file's current enabled features.
	const currentPlan = buildPlan({
		creds: {
			plexUrl: binding?.plexUrl ?? null,
			plexToken: binding?.plexToken ?? null,
			tmdbKey: config.tmdbKey
		},
		metadataFile: metadataRef,
		libraries: Object.entries(libraryState).map(([name, s]) => ({
			name,
			defaults: s.collections,
			overlays: s.overlays,
			metadata: false
		}))
	});

	return {
		active,
		mode: config.kometaConfigMode,
		configPath: config.kometaConfigPath,
		resolvedConfigPath: active ? resolve(config.kometaConfigPath) : '',
		configPathRelative: active && !config.kometaConfigPath.startsWith('/'),
		metadataFile: metadataRef,
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
		consistency: checkConsistency(currentPlan, doc)
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

/** Compute the diff a sync would make, without writing anything. */
export async function previewSync(sel: SyncSelectionInput): Promise<SyncResult> {
	const config = await resolveConfig();
	if (!config.kometaConfigPath) return inactiveResult();
	const resolvedBinding = await resolveKometaServerBinding(config.kometaServerInstanceId);
	if (!resolvedBinding.binding) {
		return bindingErrorResult(
			config,
			resolvedBinding.status as Exclude<KometaServerBindingStatus, 'ready'>
		);
	}
	const binding = resolvedBinding.binding;
	const raw = readConfig(config.kometaConfigPath);
	const sourceDoc = loadDoc(raw ?? '');
	const [snapshot, storedManagedSettings] = await Promise.all([
		getKometaLastApplied(),
		getKometaManagedSettings()
	]);
	const plan = await planFromSelections(
		config,
		sel,
		binding,
		readManagedSettingValues(sourceDoc),
		storedManagedSettings
	);

	const out = computeSync(config, plan, raw, snapshot);
	if ('parseError' in out) return parseErrorResult(config.kometaConfigMode, out.parseError);
	const consistency = checkConsistency(plan, raw !== null ? loadDoc(raw) : loadDoc(''));
	const proposedContent = serialize(out.res.doc);
	const payload = jsonSafe<KometaConfigPlanPayload>({
		type: KOMETA_CONFIG_PLAN_KIND,
		version: 1,
		action: 'structured',
		serverInstanceId: binding.id,
		serverName: binding.name,
		configPath: config.kometaConfigPath,
		mode: config.kometaConfigMode,
		sourceFingerprint: kometaFileFingerprint(raw),
		proposedFingerprint: kometaProposedFingerprint(proposedContent),
		proposedContent,
		display: {
			changes: out.res.changes,
			warnings: out.res.warnings,
			dropped: out.dropped,
			consistency,
			willScaffold: out.willScaffold
		},
		structured: { selection: sel, nextSnapshot: out.res.nextSnapshot },
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
		warnings: out.res.warnings,
		dropped: out.dropped,
		consistency,
		...planIdentity(frozen)
	};
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
	const config = await resolveConfig();
	if (!config.kometaConfigPath) return { active: false, text: '' };
	return { active: true, text: readConfig(config.kometaConfigPath) ?? '' };
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
export async function previewRawConfig(text: string): Promise<RawResult> {
	const config = await resolveConfig();
	if (!config.kometaConfigPath) return { ok: false, active: false, parseError: null };
	const resolvedBinding = await resolveKometaServerBinding(config.kometaServerInstanceId);
	if (!resolvedBinding.binding) {
		return rawBindingError(resolvedBinding.status as Exclude<KometaServerBindingStatus, 'ready'>);
	}
	const binding = resolvedBinding.binding;
	const doc = loadDoc(text);
	if (doc.errors.length) return { ok: false, active: true, parseError: doc.errors[0].message };
	const raw = readConfig(config.kometaConfigPath);
	const diff = rawKometaChanges(raw, text);
	if (kometaFileFingerprint(raw) === kometaFileFingerprint(text)) {
		return { ok: true, active: true, parseError: null, changes: [], planId: null };
	}
	const payload: KometaConfigPlanPayload = {
		type: KOMETA_CONFIG_PLAN_KIND,
		version: 1,
		action: 'raw',
		serverInstanceId: binding.id,
		serverName: binding.name,
		configPath: config.kometaConfigPath,
		mode: config.kometaConfigMode,
		sourceFingerprint: kometaFileFingerprint(raw),
		proposedFingerprint: kometaProposedFingerprint(text),
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

/** Read a backup, diff it against current bytes, and issue a bound restore preview. */
export async function previewRestoreConfig(name: string): Promise<RawResult> {
	const config = await resolveConfig();
	if (!config.kometaConfigPath) return { ok: false, active: false, parseError: null };
	const resolvedBinding = await resolveKometaServerBinding(config.kometaServerInstanceId);
	if (!resolvedBinding.binding) {
		return rawBindingError(resolvedBinding.status as Exclude<KometaServerBindingStatus, 'ready'>);
	}
	const binding = resolvedBinding.binding;
	let backupContent: string;
	try {
		backupContent = readBackup(config.kometaConfigPath, name);
	} catch (error) {
		return {
			ok: false,
			active: true,
			parseError: error instanceof Error ? error.message : String(error)
		};
	}
	const doc = loadDoc(backupContent);
	if (doc.errors.length) return { ok: false, active: true, parseError: doc.errors[0].message };
	const raw = readConfig(config.kometaConfigPath);
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
		version: 1,
		action: 'restore',
		serverInstanceId: binding.id,
		serverName: binding.name,
		configPath: config.kometaConfigPath,
		mode: config.kometaConfigMode,
		sourceFingerprint: kometaFileFingerprint(raw),
		proposedFingerprint: kometaProposedFingerprint(backupContent),
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
		const pending = await validateStoredKometaPlan(request, expectedAction);
		const config = await resolveConfig();
		const resolvedBinding = await resolveKometaServerBinding(config.kometaServerInstanceId);
		if (
			!resolvedBinding.binding ||
			resolvedBinding.binding.id !== pending.payload.serverInstanceId ||
			config.kometaConfigPath !== pending.payload.configPath ||
			config.kometaConfigMode !== pending.payload.mode
		) {
			throw new OperationPlanError('plan_stale', request.planId);
		}

		const current = readConfig(pending.payload.configPath);
		if (kometaFileFingerprint(current) !== pending.payload.sourceFingerprint) {
			throw new OperationPlanError('plan_stale', request.planId);
		}
		if (pending.payload.restore) {
			let backupContent: string;
			try {
				backupContent = readBackup(pending.payload.configPath, pending.payload.restore.backupName);
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

		const consumed = await operationPlanStore.consume<KometaConfigPlanPayload>(request.planId, {
			kind: KOMETA_CONFIG_PLAN_KIND,
			digest: request.digest,
			serverInstanceId: pending.payload.serverInstanceId
		});
		const { backup } = writeConfigAtomic(
			consumed.payload.configPath,
			consumed.payload.proposedContent,
			new Date().toISOString()
		);

		let managedSettings = await getKometaManagedSettings();
		if (consumed.payload.structured) {
			const { selection, nextSnapshot } = consumed.payload.structured;
			await setKometaManagedLibraries(selection.libraries);
			await setKometaDefaultCollections(selection.defaults);
			await setKometaLastApplied(nextSnapshot);
			managedSettings = selection.settings;
		}
		await setKometaManagedSettings(
			syncStoredSecretSettings(managedSettings, consumed.payload.proposedContent)
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
