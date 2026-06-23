import { eq, inArray } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';

export type ApplyMethod = 'plex' | 'kometa' | 'both';

/** Effective runtime configuration. Secrets are null when unset. */
export interface AppConfig {
	plexUrl: string | null;
	plexToken: string | null;
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
}

/** Config keys that are secrets — never returned to the client, redacted in logs. */
export const SECRET_KEYS = ['plexToken', 'tmdbKey', 'fanartKey'] as const;
type ConfigKey = keyof AppConfig;

/** Settings key -> environment variable name. Env always overrides persisted settings. */
const ENV_MAP: Record<ConfigKey, string> = {
	plexUrl: 'PLEX_URL',
	plexToken: 'PLEX_TOKEN',
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
	fanartKey: 'FANART_KEY'
};

const DEFAULTS = {
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
	providerThePosterDb: false
};

/** Persisted-settings keys that the UI is allowed to write. */
export const WRITABLE_KEYS: ConfigKey[] = [
	'plexUrl',
	'plexToken',
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
	'fanartKey'
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

/** Resolve the effective configuration (env over persisted settings). Server-only. */
export async function resolveConfig(): Promise<AppConfig> {
	const persisted = await loadSettings();
	const method = rawValue('defaultApplyMethod', persisted) as ApplyMethod | undefined;
	return {
		plexUrl: rawValue('plexUrl', persisted) ?? null,
		plexToken: rawValue('plexToken', persisted) ?? null,
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
		fanartKey: rawValue('fanartKey', persisted) ?? null
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
	plexUrl: string | null;
	plexTokenSet: boolean;
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
	envManaged: Partial<Record<ConfigKey, boolean>>;
}

export async function publicConfig(): Promise<PublicConfig> {
	const c = await resolveConfig();
	const envManaged: Partial<Record<ConfigKey, boolean>> = {};
	for (const k of WRITABLE_KEYS) envManaged[k] = isEnvManaged(k);
	return {
		plexUrl: c.plexUrl,
		plexTokenSet: c.plexToken !== null,
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
