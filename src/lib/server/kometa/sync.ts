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
	loadDoc,
	redactSecrets,
	serialize,
	topLevelKeys,
	type ApplyResult,
	type ChangeEntry,
	type ConfigPlan,
	type KometaSnapshot
} from './config';
import type { KometaConfigMode } from '$lib/server/config';
import { readConfig, withConfigLock, writeConfigAtomic } from './config-io';
import { DEFAULT_FILENAME } from './yaml';
import { DEFAULT_COLLECTION_GROUPS, knownDefaults, type DefaultGroup } from './defaults-catalog';
import { MANAGED_SETTINGS, type ManagedSettingDef } from './managed-settings';
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
	backup?: boolean;
	scaffolded?: boolean;
}

/** Kometa-visible path to PosterPilot's metadata file, as written into config.yml. */
function metadataFilePath(config: AppConfig): string {
	const base = config.kometaMetadataPath || config.kometaAssetsDir;
	return posix.join(base, DEFAULT_FILENAME);
}

/** Build the desired-state plan from the user's selections + resolved config. */
async function planFromSelections(config: AppConfig, sel: SyncSelectionInput): Promise<ConfigPlan> {
	const cached = await getCachedLibraries();
	const titleByKey = new Map(cached.map((l) => [l.key, l.title]));
	const libraries = sel.libraries
		.map((key) => ({
			name: titleByKey.get(key) ?? '',
			defaults: knownDefaults(sel.defaults[key] ?? []),
			metadata: true
		}))
		.filter((l) => l.name !== '');
	const settings = MANAGED_SETTINGS.flatMap((def) => {
		const value = sel.settings[def.id];
		return value ? [{ section: def.section, key: def.key, value }] : [];
	});
	return buildPlan({
		creds: { plexUrl: config.plexUrl, plexToken: config.plexToken, tmdbKey: config.tmdbKey },
		metadataFile: metadataFilePath(config),
		libraries,
		settings
	});
}

/** Load everything the Kometa tab needs to render. */
export async function loadKometaState(): Promise<KometaTabState> {
	const config = await resolveConfig();
	const active = Boolean(config.kometaConfigPath);
	let exists = false;
	let parseError: string | null = null;
	if (active) {
		const raw = readConfig(config.kometaConfigPath);
		exists = raw !== null;
		if (raw !== null) {
			const doc = loadDoc(raw);
			if (doc.errors.length) parseError = doc.errors[0].message;
		}
	}
	return {
		active,
		mode: config.kometaConfigMode,
		configPath: config.kometaConfigPath,
		resolvedConfigPath: active ? resolve(config.kometaConfigPath) : '',
		configPathRelative: active && !config.kometaConfigPath.startsWith('/'),
		metadataFile: metadataFilePath(config),
		exists,
		parseError,
		managedLibraries: await getKometaManagedLibraries(),
		defaultCollections: await getKometaDefaultCollections(),
		managedSettings: await getKometaManagedSettings(),
		catalog: DEFAULT_COLLECTION_GROUPS,
		managedSettingDefs: MANAGED_SETTINGS
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
		dropped: []
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
		dropped: []
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
		dropped: out.dropped
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
			dropped: out.dropped
		};
	});
}
