/**
 * Server-side orchestration for the Kometa config-sync feature. Wires the pure
 * merge engine (`config.ts`) to PosterPilot's resolved configuration, persisted
 * selections, and the atomic file I/O. Impure (db + fs) — not unit-tested here;
 * the logic it composes is tested in `config.test.ts` / `config-io.test.ts`.
 */

import { posix, resolve } from 'node:path';
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
	readConfig,
	restoreBackup,
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

export { parseSelectionInput, type SyncSelectionInput } from './selection';

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
	managedLibraries: string[];
	defaultCollections: Record<string, string[]>;
	managedSettings: Record<string, string>;
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
	/** Current global settings/webhooks from the file. */
	globals: { settings: Record<string, string>; webhooks: Record<string, string> };
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
}

/**
 * The `metadata_files` `file:` value written into config.yml. PosterPilot writes
 * `posterpilot.yml` into the config-file's own directory, so the reference is the
 * bare basename — Kometa resolves it relative to its config directory.
 */
function metadataFilePath(_config: AppConfig): string {
	return DEFAULT_FILENAME;
}

/** Absolute on-disk directory where posterpilot.yml is written (the config dir). */
export function kometaOutputDir(config: AppConfig): string {
	return config.kometaConfigPath ? posix.dirname(config.kometaConfigPath) : config.kometaAssetsDir;
}

/** Build the desired-state plan from the user's selections + resolved config. */
async function planFromSelections(config: AppConfig, sel: SyncSelectionInput): Promise<ConfigPlan> {
	const cached = await getCachedLibraries();
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

	const settings = MANAGED_SETTINGS.flatMap((def) => {
		const value = sel.settings[def.id];
		return value ? [{ section: def.section, key: def.key, value }] : [];
	});

	return buildPlan({
		creds: { plexUrl: config.plexUrl, plexToken: config.plexToken, tmdbKey: config.tmdbKey },
		metadataFile: metadataFilePath(config),
		libraries,
		settings,
		connections,
		connectionKeep
	});
}

/** Load everything the Kometa manager page needs to render. */
export async function loadKometaState(): Promise<KometaTabState> {
	const config = await resolveConfig();
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

	const cached = await getCachedLibraries();
	const metadataRef = metadataFilePath(config);

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
		creds: { plexUrl: config.plexUrl, plexToken: config.plexToken, tmdbKey: config.tmdbKey },
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
		managedLibraries: await getKometaManagedLibraries(),
		defaultCollections: await getKometaDefaultCollections(),
		managedSettings: await getKometaManagedSettings(),
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
			webhooks: readScalarMap(doc, ['webhooks'])
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
	const raw = readConfig(config.kometaConfigPath);
	const plan = await planFromSelections(config, sel);
	const snapshot = await getKometaLastApplied();

	const out = computeSync(config, plan, raw, snapshot);
	if ('parseError' in out) return parseErrorResult(config.kometaConfigMode, out.parseError);
	return {
		active: true,
		mode: config.kometaConfigMode,
		exists: raw !== null,
		willScaffold: out.willScaffold,
		parseError: null,
		changes: redactSecrets(out.res.changes),
		warnings: out.res.warnings,
		dropped: out.dropped,
		consistency: checkConsistency(plan, raw !== null ? loadDoc(raw) : loadDoc(''))
	};
}

/** Apply the sync: write the file atomically (+ backup) and persist selections. */
export async function runSync(sel: SyncSelectionInput): Promise<SyncResult> {
	const config = await resolveConfig();
	if (!config.kometaConfigPath) return inactiveResult();
	return withConfigLock(config.kometaConfigPath, async () => {
		const raw = readConfig(config.kometaConfigPath);
		const plan = await planFromSelections(config, sel);
		const snapshot = await getKometaLastApplied();

		const out = computeSync(config, plan, raw, snapshot);
		if ('parseError' in out) return parseErrorResult(config.kometaConfigMode, out.parseError);

		const stamp = new Date().toISOString();
		const { backup } = writeConfigAtomic(config.kometaConfigPath, serialize(out.res.doc), stamp);

		await setKometaManagedLibraries(sel.libraries);
		await setKometaDefaultCollections(sel.defaults);
		await setKometaManagedSettings(sel.settings);
		await setKometaLastApplied(out.res.nextSnapshot);

		const created = out.willScaffold;
		await logEvent(
			'info',
			'kometa',
			created
				? 'Created Kometa config.yml'
				: `Synced Kometa config.yml (${config.kometaConfigMode})`,
			{
				mode: config.kometaConfigMode,
				changes: out.res.changes.length,
				dropped: out.dropped.length,
				warnings: out.res.warnings,
				backup: backup !== null
			}
		);

		return {
			active: true,
			mode: config.kometaConfigMode,
			exists: true,
			willScaffold: false,
			parseError: null,
			scaffolded: created,
			backup: backup !== null,
			changes: redactSecrets(out.res.changes),
			warnings: out.res.warnings,
			dropped: out.dropped,
			consistency: checkConsistency(plan, raw !== null ? loadDoc(raw) : loadDoc(''))
		};
	});
}

/** Result of a raw-editor save or a backup restore. */
export interface RawResult {
	ok: boolean;
	active?: boolean;
	parseError: string | null;
	backup?: boolean;
}

/** Read the current raw config text (for the raw editor). */
export async function loadRaw(): Promise<{ active: boolean; text: string }> {
	const config = await resolveConfig();
	if (!config.kometaConfigPath) return { active: false, text: '' };
	return { active: true, text: readConfig(config.kometaConfigPath) ?? '' };
}

/** Validate and save raw config text (atomic write + backup). */
export async function saveRaw(text: string): Promise<RawResult> {
	const config = await resolveConfig();
	if (!config.kometaConfigPath) return { ok: false, active: false, parseError: null };
	return withConfigLock(config.kometaConfigPath, async () => {
		const doc = loadDoc(text);
		if (doc.errors.length) return { ok: false, active: true, parseError: doc.errors[0].message };
		const { backup } = writeConfigAtomic(config.kometaConfigPath, text, new Date().toISOString());
		await logEvent('info', 'kometa', 'Saved Kometa config.yml (raw editor)', {
			backup: backup !== null
		});
		return { ok: true, active: true, parseError: null, backup: backup !== null };
	});
}

/** Restore a named backup over the current config. */
export async function restoreConfig(name: string): Promise<RawResult> {
	const config = await resolveConfig();
	if (!config.kometaConfigPath) return { ok: false, active: false, parseError: null };
	return withConfigLock(config.kometaConfigPath, async () => {
		try {
			restoreBackup(config.kometaConfigPath, name, new Date().toISOString());
		} catch (e) {
			return { ok: false, active: true, parseError: e instanceof Error ? e.message : String(e) };
		}
		await logEvent('info', 'kometa', 'Restored Kometa config.yml backup', { name });
		return { ok: true, active: true, parseError: null, backup: true };
	});
}

/** List backups for the configured file (for a refresh). */
export async function getBackups(): Promise<BackupInfo[]> {
	const config = await resolveConfig();
	if (!config.kometaConfigPath) return [];
	return listBackups(config.kometaConfigPath);
}
