import { eq, inArray } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';
import { normalizeLocale } from '$lib/i18n/resolve';

export type ApplyMethod = 'plex' | 'kometa' | 'both';

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
}

/** Config keys that are secrets — never returned to the client, redacted in logs. */
export const SECRET_KEYS = [
	'plexToken',
	'jellyfinApiKey',
	'embyApiKey',
	'tmdbKey',
	'fanartKey'
] as const;
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
	eventRetention: 'EVENT_RETENTION'
};

const DEFAULTS = {
	serverType: 'plex' as ServerType,
	kometaAssetsDir: './data/kometa',
	mediuxDelayMs: 2000,
	mediuxConcurrency: 5,
	httpCacheTtlDays: 7,
	defaultApplyMethod: 'both' as ApplyMethod,
	// MediUX + TMDB artwork on by default (no key / key already present); the keyed/
	// scrape providers are opt-in.
	providerMediux: true,
	providerTmdb: true,
	providerFanart: false,
	providerThePosterDb: false,
	logDir: './data/logs',
	eventRetention: 2000
	// `language` has no default: when unset the UI locale resolver falls through
	// to the request's Accept-Language header, then English.
};

/** Persisted-settings keys that the UI is allowed to write. */
export const WRITABLE_KEYS: ConfigKey[] = [
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
	'language'
];

async function loadSettings(): Promise<Record<string, string>> {
	const rows = await db.select().from(settings);
	return Object.fromEntries(rows.map((r) => [r.key, r.value]));
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
		kometaAssetsDir: rawValue('kometaAssetsDir', persisted) ?? DEFAULTS.kometaAssetsDir,
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
		eventRetention: toInt(rawValue('eventRetention', persisted), DEFAULTS.eventRetention)
	};
}

/** True when a key is sourced from the environment (and thus locked from UI editing). */
export function isEnvManaged(key: ConfigKey): boolean {
	const v = env[ENV_MAP[key]];
	return v !== undefined && v !== '';
}

export class MissingConfigError extends Error {
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

/** The credential keys required for a given active server type. */
export function requiredKeysFor(serverType: ServerType): ConfigKey[] {
	switch (serverType) {
		case 'jellyfin':
			return ['jellyfinUrl', 'jellyfinApiKey'];
		case 'emby':
			return ['embyUrl', 'embyApiKey'];
		case 'plex':
		default:
			return ['plexUrl', 'plexToken'];
	}
}

/** Throw MissingConfigError if the active server type's credentials are unset. */
export function requireActiveServer(config: AppConfig): void {
	requireConfig(config, requiredKeysFor(config.serverType));
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

/**
 * Read the last-known media-server library list from the settings KV. This is an
 * internal cache (not a user-editable WRITABLE_KEY) so the Settings page can render
 * the "Libraries to sync" checklist instantly without a network round-trip.
 */
export async function getCachedLibraries(): Promise<CachedLibrary[]> {
	const row = (
		await db.select().from(settings).where(eq(settings.key, CACHED_LIBRARIES_KEY)).limit(1)
	)[0];
	if (!row?.value) return [];
	try {
		const arr = JSON.parse(row.value);
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
export async function setCachedLibraries(libraries: CachedLibrary[]): Promise<void> {
	const value = JSON.stringify(
		libraries.map((l) => ({ key: l.key, title: l.title, type: l.type }))
	);
	await db
		.insert(settings)
		.values({ key: CACHED_LIBRARIES_KEY, value })
		.onConflictDoUpdate({ target: settings.key, set: { value } });
}

/** Persist UI-supplied settings. Empty string clears a key. Ignores non-writable keys. */
export async function saveSettings(values: Partial<Record<ConfigKey, string>>): Promise<void> {
	const entries = Object.entries(values).filter(([k]) => WRITABLE_KEYS.includes(k as ConfigKey));
	for (const [key, value] of entries) {
		if (value === '' || value === undefined) {
			await db.delete(settings).where(eq(settings.key, key));
		} else {
			await db
				.insert(settings)
				.values({ key, value })
				.onConflictDoUpdate({ target: settings.key, set: { value } });
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
	envManaged: Partial<Record<ConfigKey, boolean>>;
}

export async function publicConfig(): Promise<PublicConfig> {
	const c = await resolveConfig();
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
		mediuxDelayMs: c.mediuxDelayMs,
		mediuxConcurrency: c.mediuxConcurrency,
		httpCacheTtlDays: c.httpCacheTtlDays,
		defaultApplyMethod: c.defaultApplyMethod,
		includedSections: c.includedSections,
		providerMediux: c.providerMediux,
		providerTmdb: c.providerTmdb,
		providerFanart: c.providerFanart,
		providerThePosterDb: c.providerThePosterDb,
		fanartKeySet: c.fanartKey !== null,
		language: c.language,
		logDir: c.logDir,
		eventRetention: c.eventRetention,
		envManaged
	};
}

/** Redact known secret values from an arbitrary string (for safe logging). */
export function redact(text: string, config: AppConfig): string {
	let out = text;
	for (const key of SECRET_KEYS) {
		const secret = config[key];
		if (secret && secret.length >= 4) out = out.split(secret).join('***');
	}
	return out;
}
