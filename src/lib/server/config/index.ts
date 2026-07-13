import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';
import { normalizeLocale } from '$lib/i18n/resolve';
import { parseLibrarySort, type LibrarySort } from '$lib/library-sort';
import { getEncryptionKey } from '$lib/server/secrets/key';
import { decryptSecret, encryptSecret } from '$lib/server/secrets/crypto';
import type { KometaSnapshot } from '$lib/server/kometa/config';
import { LEGACY_SERVER_INSTANCE_ID } from '$lib/server/server-instances/legacy';

export type { KometaSnapshot };

export type ApplyMethod = 'plex' | 'kometa' | 'both';

/**
 * How PosterPilot relates to Kometa's `config.yml`:
 * - `merge`: surgically update only the sections it owns, preserving everything else.
 * - `own`: regenerate the whole file from PosterPilot's settings (unmanaged keys dropped).
 */
export type KometaConfigMode = 'merge' | 'own';

/** The active media-server backend. */
export type ServerType = 'plex' | 'jellyfin' | 'emby';

/** Effective runtime configuration. Secrets are null when unset. */
export interface AppConfig {
	/** Which media-server backend is active. */
	serverType: ServerType;
	plexUrl: string | null;
	plexToken: string | null;
	/** Stable per-install identifier sent to plex.tv (PIN login / discovery). */
	plexClientId: string | null;
	jellyfinUrl: string | null;
	jellyfinApiKey: string | null;
	embyUrl: string | null;
	embyApiKey: string | null;
	tmdbKey: string | null;
	kometaAssetsDir: string;
	/**
	 * Path to Kometa's own `config.yml` that PosterPilot surgically syncs (distinct
	 * from the assets dir, which is where `posterpilot.yml` is written). Empty string
	 * means the config-sync feature is off.
	 */
	kometaConfigPath: string;
	/** Whether PosterPilot surgically merges (`merge`) or fully owns (`own`) config.yml. */
	kometaConfigMode: KometaConfigMode;
	/** Named Plex instance explicitly bound to the Kometa target. */
	kometaServerInstanceId: string | null;
	mediuxDelayMs: number;
	mediuxConcurrency: number;
	httpCacheTtlDays: number;
	defaultApplyMethod: ApplyMethod;
	/** Plex section keys to sync; empty = all movie/show sections. */
	includedSections: string[];
	/** Artwork provider enable flags. */
	providerMediux: boolean;
	providerTmdb: boolean;
	providerFanart: boolean;
	providerThePosterDb: boolean;
	/** Fanart.tv API key (the only keyed provider); null when unset. */
	fanartKey: string | null;
	/**
	 * Preferred UI locale (one of the supported locales) or null when unset.
	 * Highest-precedence input to UI locale resolution; null falls back to the
	 * request's Accept-Language, then English.
	 */
	language: string | null;
	/** Folder for the rotating log file; defaults under the existing /data volume. */
	logDir: string;
	/** Max number of activity-log rows kept; older rows are pruned past this cap. */
	eventRetention: number;
	/** How many items a bulk apply processes at once. */
	applyConcurrency: number;
	/** Whether the UI pre-selects the top-scored candidate as a suggestion. */
	suggestPreselect: boolean;
	/** Whether library sync skips unchanged items by default. */
	incrementalSync: boolean;
	/** Days a cached thumbnail stays fresh before it is re-fetched. */
	thumbCacheTtlDays: number;
	/** Max on-disk size (MB) of the thumbnail cache before older entries are evicted. */
	thumbCacheMaxMb: number;
	/** Whether the experimental "Fun" section is shown (off by default). */
	funEnabled: boolean;
	/** Sort the library grid opens with when the URL specifies none. */
	libraryDefaultSort: LibrarySort;
}

/** Config keys that are secrets — never returned to the client, redacted in logs. */
const SECRET_KEYS = ['plexToken', 'jellyfinApiKey', 'embyApiKey', 'tmdbKey', 'fanartKey'] as const;
type ConfigKey = keyof AppConfig;

/** Settings key -> environment variable name. Env always overrides persisted settings. */
const ENV_MAP: Record<ConfigKey, string> = {
	serverType: 'SERVER_TYPE',
	plexUrl: 'PLEX_URL',
	plexToken: 'PLEX_TOKEN',
	plexClientId: 'PLEX_CLIENT_ID',
	jellyfinUrl: 'JELLYFIN_URL',
	jellyfinApiKey: 'JELLYFIN_API_KEY',
	embyUrl: 'EMBY_URL',
	embyApiKey: 'EMBY_API_KEY',
	tmdbKey: 'TMDB_KEY',
	kometaAssetsDir: 'KOMETA_ASSETS_DIR',
	kometaConfigPath: 'KOMETA_CONFIG_PATH',
	kometaConfigMode: 'KOMETA_CONFIG_MODE',
	kometaServerInstanceId: 'KOMETA_SERVER_INSTANCE_ID',
	mediuxDelayMs: 'MEDIUX_REQUEST_DELAY_MS',
	mediuxConcurrency: 'MEDIUX_CONCURRENCY',
	httpCacheTtlDays: 'HTTP_CACHE_TTL_DAYS',
	defaultApplyMethod: 'DEFAULT_APPLY_METHOD',
	includedSections: 'INCLUDED_SECTIONS',
	providerMediux: 'PROVIDER_MEDIUX',
	providerTmdb: 'PROVIDER_TMDB',
	providerFanart: 'PROVIDER_FANART',
	providerThePosterDb: 'PROVIDER_THEPOSTERDB',
	fanartKey: 'FANART_KEY',
	// APP_LANGUAGE, not LANGUAGE: the bare `LANGUAGE` var is a standard POSIX locale
	// setting commonly present on Linux/Docker hosts, which would silently lock the
	// UI language. Namespacing it avoids that collision.
	language: 'APP_LANGUAGE',
	logDir: 'LOG_DIR',
	eventRetention: 'EVENT_RETENTION',
	applyConcurrency: 'APPLY_CONCURRENCY',
	suggestPreselect: 'SUGGEST_PRESELECT',
	incrementalSync: 'INCREMENTAL_SYNC',
	thumbCacheTtlDays: 'THUMB_CACHE_TTL_DAYS',
	thumbCacheMaxMb: 'THUMB_CACHE_MAX_MB',
	funEnabled: 'FUN_ENABLED',
	libraryDefaultSort: 'LIBRARY_DEFAULT_SORT'
};

const DEFAULTS = {
	serverType: 'plex' as ServerType,
	kometaAssetsDir: './data/kometa',
	mediuxDelayMs: 2000,
	mediuxConcurrency: 5,
	httpCacheTtlDays: 7,
	defaultApplyMethod: 'both' as ApplyMethod,
	kometaConfigMode: 'merge' as KometaConfigMode,
	// Existing single-server installations materialize to this protected id.
	kometaServerInstanceId: 'legacy-default',
	// MediUX + TMDB artwork on by default (no key / key already present); the keyed/
	// scrape providers are opt-in.
	providerMediux: true,
	providerTmdb: true,
	providerFanart: false,
	providerThePosterDb: false,
	logDir: './data/logs',
	eventRetention: 2000,
	applyConcurrency: 4,
	suggestPreselect: true,
	incrementalSync: true,
	thumbCacheTtlDays: 30,
	thumbCacheMaxMb: 512,
	funEnabled: false,
	libraryDefaultSort: 'title' as LibrarySort
	// `language` has no default: when unset the UI locale resolver falls through
	// to the request's Accept-Language header, then English.
};

/** Persisted-settings keys that the UI is allowed to write. */
const WRITABLE_KEYS: ConfigKey[] = [
	'serverType',
	'plexUrl',
	'plexToken',
	'plexClientId',
	'jellyfinUrl',
	'jellyfinApiKey',
	'embyUrl',
	'embyApiKey',
	'tmdbKey',
	'kometaAssetsDir',
	'kometaConfigPath',
	'kometaConfigMode',
	'kometaServerInstanceId',
	'mediuxDelayMs',
	'mediuxConcurrency',
	'httpCacheTtlDays',
	'defaultApplyMethod',
	'includedSections',
	'providerMediux',
	'providerTmdb',
	'providerFanart',
	'providerThePosterDb',
	'fanartKey',
	'language',
	'applyConcurrency',
	'suggestPreselect',
	'incrementalSync',
	'thumbCacheTtlDays',
	'thumbCacheMaxMb',
	'funEnabled',
	'libraryDefaultSort'
];

/** True when a settings key holds a secret value (encrypted at rest). */
function isSecretKey(key: string): key is (typeof SECRET_KEYS)[number] {
	return (SECRET_KEYS as readonly string[]).includes(key);
}

async function loadSettings(): Promise<Record<string, string>> {
	const rows = await db.select().from(settings);
	const key = getEncryptionKey();
	const out: Record<string, string> = {};
	for (const row of rows) {
		if (isSecretKey(row.key)) {
			try {
				out[row.key] = decryptSecret(row.value, key);
			} catch {
				// Undecryptable (key lost/changed) → treat the secret as unset, never crash.
				continue;
			}
		} else {
			out[row.key] = row.value;
		}
	}
	return out;
}

/** Read a single raw value: env wins, else persisted setting, else undefined. */
function rawValue(key: ConfigKey, persisted: Record<string, string>): string | undefined {
	const fromEnv = env[ENV_MAP[key]];
	if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
	const fromDb = persisted[key];
	if (fromDb !== undefined && fromDb !== '') return fromDb;
	return undefined;
}

function toInt(value: string | undefined, fallback: number): number {
	const n = value === undefined ? NaN : Number.parseInt(value, 10);
	return Number.isFinite(n) ? n : fallback;
}

/** Parse a boolean flag ('1'/'true'/'on' = true), falling back when unset. */
function toBool(value: string | undefined, fallback: boolean): boolean {
	if (value === undefined) return fallback;
	return ['1', 'true', 'on', 'yes'].includes(value.trim().toLowerCase());
}

/** Parse section keys from a JSON array (persisted) or comma-separated list (env). */
function parseSections(value: string | undefined): string[] {
	if (!value) return [];
	const trimmed = value.trim();
	if (trimmed.startsWith('[')) {
		try {
			const arr = JSON.parse(trimmed);
			return Array.isArray(arr) ? arr.map(String) : [];
		} catch {
			return [];
		}
	}
	return trimmed
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

/** Parse the active server type, defaulting to `plex` for unknown/empty values. */
function parseServerType(value: string | undefined): ServerType {
	const t = value?.trim().toLowerCase();
	return t === 'jellyfin' || t === 'emby' ? t : DEFAULTS.serverType;
}

/** Resolve the effective configuration (env over persisted settings). Server-only. */
export async function resolveConfig(): Promise<AppConfig> {
	const persisted = await loadSettings();
	const method = rawValue('defaultApplyMethod', persisted) as ApplyMethod | undefined;
	const kometaAssetsDir = rawValue('kometaAssetsDir', persisted) ?? DEFAULTS.kometaAssetsDir;
	return {
		serverType: parseServerType(rawValue('serverType', persisted)),
		plexUrl: rawValue('plexUrl', persisted) ?? null,
		plexToken: rawValue('plexToken', persisted) ?? null,
		plexClientId: rawValue('plexClientId', persisted) ?? null,
		jellyfinUrl: rawValue('jellyfinUrl', persisted) ?? null,
		jellyfinApiKey: rawValue('jellyfinApiKey', persisted) ?? null,
		embyUrl: rawValue('embyUrl', persisted) ?? null,
		embyApiKey: rawValue('embyApiKey', persisted) ?? null,
		tmdbKey: rawValue('tmdbKey', persisted) ?? null,
		kometaAssetsDir,
		kometaConfigPath: rawValue('kometaConfigPath', persisted) ?? '',
		kometaConfigMode: rawValue('kometaConfigMode', persisted) === 'own' ? 'own' : 'merge',
		kometaServerInstanceId:
			rawValue('kometaServerInstanceId', persisted) ?? DEFAULTS.kometaServerInstanceId,
		mediuxDelayMs: toInt(rawValue('mediuxDelayMs', persisted), DEFAULTS.mediuxDelayMs),
		mediuxConcurrency: toInt(rawValue('mediuxConcurrency', persisted), DEFAULTS.mediuxConcurrency),
		httpCacheTtlDays: toInt(rawValue('httpCacheTtlDays', persisted), DEFAULTS.httpCacheTtlDays),
		defaultApplyMethod:
			method === 'plex' || method === 'kometa' || method === 'both'
				? method
				: DEFAULTS.defaultApplyMethod,
		includedSections: parseSections(rawValue('includedSections', persisted)),
		providerMediux: toBool(rawValue('providerMediux', persisted), DEFAULTS.providerMediux),
		providerTmdb: toBool(rawValue('providerTmdb', persisted), DEFAULTS.providerTmdb),
		providerFanart: toBool(rawValue('providerFanart', persisted), DEFAULTS.providerFanart),
		providerThePosterDb: toBool(
			rawValue('providerThePosterDb', persisted),
			DEFAULTS.providerThePosterDb
		),
		fanartKey: rawValue('fanartKey', persisted) ?? null,
		// Validate against the supported locales; an absent/unsupported value is
		// treated as unset (null) so resolution falls through to Accept-Language.
		language: normalizeLocale(rawValue('language', persisted)),
		logDir: rawValue('logDir', persisted) ?? DEFAULTS.logDir,
		eventRetention: toInt(rawValue('eventRetention', persisted), DEFAULTS.eventRetention),
		applyConcurrency: toInt(rawValue('applyConcurrency', persisted), DEFAULTS.applyConcurrency),
		suggestPreselect: toBool(rawValue('suggestPreselect', persisted), DEFAULTS.suggestPreselect),
		incrementalSync: toBool(rawValue('incrementalSync', persisted), DEFAULTS.incrementalSync),
		thumbCacheTtlDays: toInt(rawValue('thumbCacheTtlDays', persisted), DEFAULTS.thumbCacheTtlDays),
		thumbCacheMaxMb: toInt(rawValue('thumbCacheMaxMb', persisted), DEFAULTS.thumbCacheMaxMb),
		funEnabled: toBool(rawValue('funEnabled', persisted), DEFAULTS.funEnabled),
		libraryDefaultSort:
			parseLibrarySort(rawValue('libraryDefaultSort', persisted)) ?? DEFAULTS.libraryDefaultSort
	};
}

/** True when a key is sourced from the environment (and thus locked from UI editing). */
function isEnvManaged(key: ConfigKey): boolean {
	const v = env[ENV_MAP[key]];
	return v !== undefined && v !== '';
}

class MissingConfigError extends Error {
	constructor(public readonly missing: ConfigKey[]) {
		super(`Missing required configuration: ${missing.join(', ')}`);
		this.name = 'MissingConfigError';
	}
}

/** Throw MissingConfigError if any required key is unset. */
export function requireConfig(config: AppConfig, keys: ConfigKey[]): void {
	const missing = keys.filter(
		(k) => config[k] === null || config[k] === undefined || config[k] === ''
	);
	if (missing.length) throw new MissingConfigError(missing);
}

/**
 * Return the stable plex.tv client identifier, generating and persisting one on
 * first use. Sent as `X-Plex-Client-Identifier` for PIN login and discovery so
 * plex.tv treats this install as a single consistent client.
 */
export async function ensurePlexClientId(): Promise<string> {
	const config = await resolveConfig();
	if (config.plexClientId) return config.plexClientId;
	const id = crypto.randomUUID();
	await saveSettings({ plexClientId: id });
	return id;
}

/** A cached media-server library entry (persisted so Settings renders instantly). */
export interface CachedLibrary {
	key: string;
	title: string;
	type: string;
}

/** Internal settings key holding the cached library list (not a WRITABLE_KEY). */
const CACHED_LIBRARIES_KEY = 'cachedLibraries';
const INCLUDED_SECTIONS_KEY = 'includedSections';

function scopedSettingsKey(base: string, serverInstanceId: string): string {
	const id = serverInstanceId.trim();
	if (!id || id !== serverInstanceId) throw new TypeError('server instance id is required');
	return `${base}:${id}`;
}

/**
 * Read the last-known media-server library list from the settings KV. This is an
 * internal cache (not a user-editable WRITABLE_KEY) so the Settings page can render
 * the "Libraries to sync" checklist instantly without a network round-trip.
 */
export async function getCachedLibraries(
	serverInstanceId: string = LEGACY_SERVER_INSTANCE_ID
): Promise<CachedLibrary[]> {
	const scoped = await readKv(scopedSettingsKey(CACHED_LIBRARIES_KEY, serverInstanceId));
	// Preserve the existing one-server installation cache until it is refreshed once
	// under the new scoped key. Never expose that fallback to a different instance.
	const value =
		scoped ??
		(serverInstanceId === LEGACY_SERVER_INSTANCE_ID ? await readKv(CACHED_LIBRARIES_KEY) : null);
	if (!value) return [];
	try {
		const arr = JSON.parse(value);
		if (!Array.isArray(arr)) return [];
		return arr
			.filter((e) => e && typeof e.key === 'string')
			.map((e) => ({
				key: String(e.key),
				title: String(e.title ?? ''),
				type: String(e.type ?? '')
			}));
	} catch {
		return [];
	}
}

/** Persist the media-server library list to the settings KV (internal cache). */
export async function setCachedLibraries(
	libraries: CachedLibrary[],
	serverInstanceId: string = LEGACY_SERVER_INSTANCE_ID
): Promise<void> {
	const value = JSON.stringify(
		libraries.map((l) => ({ key: l.key, title: l.title, type: l.type }))
	);
	await writeKv(scopedSettingsKey(CACHED_LIBRARIES_KEY, serverInstanceId), value);
}

/** Resolve a server's library selection without borrowing another server's keys. */
export async function getIncludedSectionsForServer(serverInstanceId: string): Promise<string[]> {
	const fromEnv = env[ENV_MAP.includedSections];
	if (fromEnv !== undefined && fromEnv !== '') return parseSections(fromEnv);
	const scoped = await readKv(scopedSettingsKey(INCLUDED_SECTIONS_KEY, serverInstanceId));
	if (scoped !== null) return parseSections(scoped);
	if (serverInstanceId !== LEGACY_SERVER_INSTANCE_ID) return [];
	return parseSections((await readKv(INCLUDED_SECTIONS_KEY)) ?? undefined);
}

/** Persist a normalized library selection for exactly one named server. */
export async function setIncludedSectionsForServer(
	serverInstanceId: string,
	sectionKeys: readonly string[]
): Promise<void> {
	const normalized = [
		...new Set(sectionKeys.map((key) => key.trim()).filter((key) => key.length > 0))
	];
	await writeKv(
		scopedSettingsKey(INCLUDED_SECTIONS_KEY, serverInstanceId),
		JSON.stringify(normalized)
	);
}

// ── Kometa config-sync selections (internal KV, not WRITABLE_KEYS) ─────────────
//
// These ride the same settings KV table as `cachedLibraries` but are internal,
// non-env, non-string state — so they deliberately bypass AppConfig/ENV_MAP/
// WRITABLE_KEYS. `ENV_MAP` is exhaustive over AppConfig, so adding these there
// would force spurious env vars; `kometaDefaultCollections` is a map, which the
// string-only saveSettings path can't represent.

const KOMETA_MANAGED_LIBRARIES_KEY = 'kometaManagedLibraries';
const KOMETA_DEFAULT_COLLECTIONS_KEY = 'kometaDefaultCollections';
const KOMETA_MANAGED_SETTINGS_KEY = 'kometaManagedSettings';
const KOMETA_LAST_APPLIED_KEY = 'kometaLastApplied';

async function readKv(key: string): Promise<string | null> {
	const row = (await db.select().from(settings).where(eq(settings.key, key)).limit(1))[0];
	return row?.value ?? null;
}

async function writeKv(key: string, value: string): Promise<void> {
	await db
		.insert(settings)
		.values({ key, value })
		.onConflictDoUpdate({ target: settings.key, set: { value } });
}

function parseStringArray(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const arr = JSON.parse(raw);
		return Array.isArray(arr) ? arr.map(String) : [];
	} catch {
		return [];
	}
}

/** Section keys the user has marked as managed in Kometa's config. */
export async function getKometaManagedLibraries(): Promise<string[]> {
	return parseStringArray(await readKv(KOMETA_MANAGED_LIBRARIES_KEY));
}

export async function setKometaManagedLibraries(sectionKeys: string[]): Promise<void> {
	await writeKv(KOMETA_MANAGED_LIBRARIES_KEY, JSON.stringify(sectionKeys.map(String)));
}

/** Enabled Kometa default collection sets per section key (sectionKey → names). */
export async function getKometaDefaultCollections(): Promise<Record<string, string[]>> {
	const raw = await readKv(KOMETA_DEFAULT_COLLECTIONS_KEY);
	if (!raw) return {};
	try {
		const obj = JSON.parse(raw);
		if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
		const out: Record<string, string[]> = {};
		for (const [k, v] of Object.entries(obj)) if (Array.isArray(v)) out[k] = v.map(String);
		return out;
	} catch {
		return {};
	}
}

export async function setKometaDefaultCollections(map: Record<string, string[]>): Promise<void> {
	await writeKv(KOMETA_DEFAULT_COLLECTIONS_KEY, JSON.stringify(map));
}

/** Bounded global settings/webhooks values the user manages (id → value). */
export async function getKometaManagedSettings(): Promise<Record<string, string>> {
	const raw = await readKv(KOMETA_MANAGED_SETTINGS_KEY);
	if (!raw) return {};
	try {
		const obj = JSON.parse(raw);
		if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
		const out: Record<string, string> = {};
		for (const [k, v] of Object.entries(obj)) if (typeof v === 'string') out[k] = v;
		return out;
	} catch {
		return {};
	}
}

export async function setKometaManagedSettings(values: Record<string, string>): Promise<void> {
	await writeKv(KOMETA_MANAGED_SETTINGS_KEY, JSON.stringify(values));
}

/** The last-applied snapshot used to compute removals on the next sync. */
export async function getKometaLastApplied(): Promise<KometaSnapshot | null> {
	const raw = await readKv(KOMETA_LAST_APPLIED_KEY);
	if (!raw) return null;
	try {
		const obj = JSON.parse(raw);
		if (!obj || typeof obj !== 'object') return null;
		return obj as KometaSnapshot;
	} catch {
		return null;
	}
}

export async function setKometaLastApplied(snapshot: KometaSnapshot): Promise<void> {
	await writeKv(KOMETA_LAST_APPLIED_KEY, JSON.stringify(snapshot));
}

// ── Optional authentication (internal KV, not WRITABLE_KEYS) ───────────────────
//
// Auth state rides the same settings KV as `cachedLibraries`/`kometa*`, kept out of
// AppConfig/ENV_MAP/WRITABLE_KEYS so it never leaks through publicConfig()/saveSettings
// and forces no spurious env vars. The one env input is AUTH_MODE, which overrides the
// persisted mode (anti-lockout) and locks the UI control. The password hash is stored
// verbatim (a hash is not recoverable material — it is deliberately not AES-encrypted,
// so login never depends on `.app-key`).

/** Optional-auth mode: off, on, or on-except-local-addresses. */
export type AuthMode = 'disabled' | 'enabled' | 'local';

const AUTH_MODE_KEY = 'authMode';
const AUTH_USERNAME_KEY = 'authUsername';
const AUTH_PASSWORD_HASH_KEY = 'authPasswordHash';
const AUTH_SESSION_VERSION_KEY = 'authSessionVersion';

function parseAuthMode(value: string | null | undefined): AuthMode | null {
	const t = value?.trim().toLowerCase();
	return t === 'disabled' || t === 'enabled' || t === 'local' ? t : null;
}

/** True when `AUTH_MODE` is set in the environment (overrides persisted; locks the UI). */
export function isAuthModeEnvManaged(): boolean {
	return parseAuthMode(env.AUTH_MODE) !== null;
}

/** Resolved auth state: effective mode (env override + fail-open), plus stored details. */
export interface AuthState {
	/** Effective mode after the env override and the fail-open guard. */
	mode: AuthMode;
	/** Mode as persisted (before env override), for the Security UI. */
	storedMode: AuthMode;
	/** Whether `AUTH_MODE` env locks the mode. */
	envManaged: boolean;
	username: string | null;
	passwordHash: string | null;
	/** Bumped on credential change to invalidate all outstanding sessions. */
	sessionVersion: number;
}

/**
 * Read the full auth state. Applies the `AUTH_MODE` env override and a fail-open guard:
 * if the effective mode is not `disabled` but credentials are missing, it drops to
 * `disabled` (the pre-feature state) rather than lock everyone out.
 */
export async function getAuthState(): Promise<AuthState> {
	const [rawMode, username, passwordHash, rawVersion] = await Promise.all([
		readKv(AUTH_MODE_KEY),
		readKv(AUTH_USERNAME_KEY),
		readKv(AUTH_PASSWORD_HASH_KEY),
		readKv(AUTH_SESSION_VERSION_KEY)
	]);
	const storedMode = parseAuthMode(rawMode) ?? 'disabled';
	const envMode = parseAuthMode(env.AUTH_MODE);
	const user = username && username !== '' ? username : null;
	const hash = passwordHash && passwordHash !== '' ? passwordHash : null;
	let mode = envMode ?? storedMode;
	if (mode !== 'disabled' && (!user || !hash)) mode = 'disabled'; // fail-open guard
	return {
		mode,
		storedMode,
		envManaged: envMode !== null,
		username: user,
		passwordHash: hash,
		sessionVersion: toInt(rawVersion ?? undefined, 0)
	};
}

/** Persist the auth mode (ignored while `AUTH_MODE` env is set). */
export async function setStoredAuthMode(mode: AuthMode): Promise<void> {
	await writeKv(AUTH_MODE_KEY, mode);
}

/** Persist credentials (username + already-hashed password). */
export async function setAuthCredentials(username: string, passwordHash: string): Promise<void> {
	await writeKv(AUTH_USERNAME_KEY, username);
	await writeKv(AUTH_PASSWORD_HASH_KEY, passwordHash);
}

/** Bump the session version, invalidating every outstanding session. Returns the new value. */
export async function bumpAuthSessionVersion(): Promise<number> {
	const next = toInt((await readKv(AUTH_SESSION_VERSION_KEY)) ?? undefined, 0) + 1;
	await writeKv(AUTH_SESSION_VERSION_KEY, String(next));
	return next;
}

// Poster-scoring weights live in `$lib/server/posters/score-weights` (an $env-free
// module so service.ts can import them without pulling in $env); re-exported here for
// callers that already depend on config (e.g. the settings route).
export {
	getArtworkRankingSettings,
	setArtworkRankingSettings
} from '$lib/server/posters/score-weights';

/** Persist UI-supplied settings. Empty string clears a key. Ignores non-writable keys. */
export async function saveSettings(values: Partial<Record<ConfigKey, string>>): Promise<void> {
	const entries = Object.entries(values).filter(([k]) => WRITABLE_KEYS.includes(k as ConfigKey));
	const encKey = getEncryptionKey();
	for (const [key, value] of entries) {
		if (value === '' || value === undefined) {
			await db.delete(settings).where(eq(settings.key, key));
		} else {
			// Secrets are encrypted at rest; everything else is stored verbatim.
			const stored = isSecretKey(key) ? encryptSecret(value, encKey) : value;
			await db
				.insert(settings)
				.values({ key, value: stored })
				.onConflictDoUpdate({ target: settings.key, set: { value: stored } });
		}
	}
}

/**
 * Client-safe view of configuration: secrets become a boolean "set" flag, and each
 * key reports whether it is environment-managed (read-only in the UI).
 */
export interface PublicConfig {
	serverType: ServerType;
	plexUrl: string | null;
	plexTokenSet: boolean;
	jellyfinUrl: string | null;
	jellyfinApiKeySet: boolean;
	embyUrl: string | null;
	embyApiKeySet: boolean;
	tmdbKeySet: boolean;
	kometaAssetsDir: string;
	kometaConfigPath: string;
	kometaConfigMode: KometaConfigMode;
	kometaServerInstanceId: string | null;
	mediuxDelayMs: number;
	mediuxConcurrency: number;
	httpCacheTtlDays: number;
	defaultApplyMethod: ApplyMethod;
	includedSections: string[];
	providerMediux: boolean;
	providerTmdb: boolean;
	providerFanart: boolean;
	providerThePosterDb: boolean;
	fanartKeySet: boolean;
	/** Preferred UI locale (one of the supported locales) or null when unset. */
	language: string | null;
	/** Folder for the rotating log file (read-only; env/default). */
	logDir: string;
	/** Activity-log row cap used when pruning (read-only; env/default). */
	eventRetention: number;
	/** How many items a bulk apply processes at once. */
	applyConcurrency: number;
	/** Whether the UI pre-selects the top-scored candidate as a suggestion. */
	suggestPreselect: boolean;
	/** Whether library sync skips unchanged items by default. */
	incrementalSync: boolean;
	/** Days a cached thumbnail stays fresh before it is re-fetched. */
	thumbCacheTtlDays: number;
	/** Max on-disk size (MB) of the thumbnail cache before older entries are evicted. */
	thumbCacheMaxMb: number;
	/** Whether the experimental "Fun" section is shown. */
	funEnabled: boolean;
	/** Sort the library grid opens with when the URL specifies none. */
	libraryDefaultSort: LibrarySort;
	envManaged: Partial<Record<ConfigKey, boolean>>;
}

export async function publicConfig(serverInstanceId?: string): Promise<PublicConfig> {
	const c = await resolveConfig();
	const includedSections = serverInstanceId
		? await getIncludedSectionsForServer(serverInstanceId)
		: c.includedSections;
	const envManaged: Partial<Record<ConfigKey, boolean>> = {};
	for (const k of WRITABLE_KEYS) envManaged[k] = isEnvManaged(k);
	return {
		serverType: c.serverType,
		plexUrl: c.plexUrl,
		plexTokenSet: c.plexToken !== null,
		jellyfinUrl: c.jellyfinUrl,
		jellyfinApiKeySet: c.jellyfinApiKey !== null,
		embyUrl: c.embyUrl,
		embyApiKeySet: c.embyApiKey !== null,
		tmdbKeySet: c.tmdbKey !== null,
		kometaAssetsDir: c.kometaAssetsDir,
		kometaConfigPath: c.kometaConfigPath,
		kometaConfigMode: c.kometaConfigMode,
		kometaServerInstanceId: c.kometaServerInstanceId,
		mediuxDelayMs: c.mediuxDelayMs,
		mediuxConcurrency: c.mediuxConcurrency,
		httpCacheTtlDays: c.httpCacheTtlDays,
		defaultApplyMethod: c.defaultApplyMethod,
		includedSections,
		providerMediux: c.providerMediux,
		providerTmdb: c.providerTmdb,
		providerFanart: c.providerFanart,
		providerThePosterDb: c.providerThePosterDb,
		fanartKeySet: c.fanartKey !== null,
		language: c.language,
		logDir: c.logDir,
		eventRetention: c.eventRetention,
		applyConcurrency: c.applyConcurrency,
		suggestPreselect: c.suggestPreselect,
		incrementalSync: c.incrementalSync,
		thumbCacheTtlDays: c.thumbCacheTtlDays,
		thumbCacheMaxMb: c.thumbCacheMaxMb,
		funEnabled: c.funEnabled,
		libraryDefaultSort: c.libraryDefaultSort,
		envManaged
	};
}
