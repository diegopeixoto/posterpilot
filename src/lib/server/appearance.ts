/**
 * Appearance settings — internal settings-KV state, deliberately out of
 * AppConfig/ENV_MAP/WRITABLE_KEYS (same pattern as optional auth): these keys
 * need no env override, and `customThemes` is JSON, which the string-only
 * saveSettings path can't represent.
 */

import { eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';
import { resolveStoredAppearance, type ResolvedAppearance } from '$lib/theming/resolve';
import { DEFAULT_THEME_ID, type CustomTheme, type TokenKey } from '$lib/theming/schema';
import {
	isValidCss,
	MAX_CUSTOM_THEMES,
	MAX_THEME_FILE_BYTES,
	sanitizeCustomTheme
} from '$lib/theming/theme-file';

export type NavPlacement = 'top' | 'left';

/** Everything a page request needs to render the active theme, read in one go. */
export interface AppearanceState {
	settings: AppearanceSettings;
	customThemes: CustomTheme[];
	resolved: ResolvedAppearance;
}

export interface AppearanceSettings {
	themeId: string;
	themeAccentOverride: string | null;
	themeBackgroundOverride: string | null;
	themeBackgroundImage: string | null;
	themeBackgroundImageDim: number | null;
	themeRadiusOverride: string | null;
	navPlacement: NavPlacement;
	/** Free-form CSS escape hatch (self-hosted, single-user; deliberately not
	 *  part of the shareable theme-file format). Capped; `</style` rejected. */
	customCss: string | null;
}

const KEYS = {
	themeId: 'themeId',
	themeAccentOverride: 'themeAccentOverride',
	themeBackgroundOverride: 'themeBackgroundOverride',
	themeBackgroundImage: 'themeBackgroundImage',
	themeBackgroundImageDim: 'themeBackgroundImageDim',
	themeRadiusOverride: 'themeRadiusOverride',
	navPlacement: 'navPlacement',
	customCss: 'customCss',
	customThemes: 'customThemes'
} as const;

const SCALAR_KEYS = [
	KEYS.themeId,
	KEYS.themeAccentOverride,
	KEYS.themeBackgroundOverride,
	KEYS.themeBackgroundImage,
	KEYS.themeBackgroundImageDim,
	KEYS.themeRadiusOverride,
	KEYS.navPlacement,
	KEYS.customCss,
	KEYS.customThemes
] as const;

async function readAppearanceKv(): Promise<Record<string, string>> {
	// Keyed lookup, not a full scan: appearance is read on every page request
	// (the SSR theme hook) and the settings table holds every app setting.
	const rows = await db
		.select()
		.from(settings)
		.where(inArray(settings.key, [...SCALAR_KEYS]));
	const out: Record<string, string> = {};
	for (const row of rows) out[row.key] = row.value;
	return out;
}

async function writeKv(key: string, value: string): Promise<void> {
	await db
		.insert(settings)
		.values({ key, value })
		.onConflictDoUpdate({ target: settings.key, set: { value } });
}

async function deleteKv(key: string): Promise<void> {
	await db.delete(settings).where(eq(settings.key, key));
}

function parseDim(raw: string | undefined): number | null {
	if (raw === undefined) return null;
	const n = Number.parseFloat(raw);
	return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
}

/** Map the raw KV rows to settings, normalizing anything unexpected to defaults. */
function mapAppearanceSettings(kv: Record<string, string>): AppearanceSettings {
	return {
		themeId: kv[KEYS.themeId] || DEFAULT_THEME_ID,
		themeAccentOverride: kv[KEYS.themeAccentOverride] || null,
		themeBackgroundOverride: kv[KEYS.themeBackgroundOverride] || null,
		themeBackgroundImage: kv[KEYS.themeBackgroundImage] || null,
		themeBackgroundImageDim: parseDim(kv[KEYS.themeBackgroundImageDim]),
		themeRadiusOverride: kv[KEYS.themeRadiusOverride] || null,
		navPlacement: kv[KEYS.navPlacement] === 'left' ? 'left' : 'top',
		customCss: kv[KEYS.customCss] || null
	};
}

/** Read appearance settings, normalizing anything unexpected to defaults. */
export async function getAppearanceSettings(): Promise<AppearanceSettings> {
	return mapAppearanceSettings(await readAppearanceKv());
}

/** Persist a partial update; `null` clears an override. */
export async function saveAppearanceSettings(patch: Partial<AppearanceSettings>): Promise<void> {
	const writes: Promise<void>[] = [];
	const put = (key: string, value: string | null | undefined) => {
		if (value === undefined) return;
		writes.push(value === null || value === '' ? deleteKv(key) : writeKv(key, value));
	};
	if (patch.themeId !== undefined) put(KEYS.themeId, patch.themeId);
	if (patch.themeAccentOverride !== undefined)
		put(KEYS.themeAccentOverride, patch.themeAccentOverride);
	if (patch.themeBackgroundOverride !== undefined)
		put(KEYS.themeBackgroundOverride, patch.themeBackgroundOverride);
	if (patch.themeBackgroundImage !== undefined)
		put(KEYS.themeBackgroundImage, patch.themeBackgroundImage);
	if (patch.themeBackgroundImageDim !== undefined)
		put(
			KEYS.themeBackgroundImageDim,
			patch.themeBackgroundImageDim === null ? null : String(patch.themeBackgroundImageDim)
		);
	if (patch.themeRadiusOverride !== undefined)
		put(KEYS.themeRadiusOverride, patch.themeRadiusOverride);
	if (patch.navPlacement !== undefined)
		put(KEYS.navPlacement, patch.navPlacement === 'left' ? 'left' : 'top');
	if (patch.customCss !== undefined) put(KEYS.customCss, patch.customCss);
	await Promise.all(writes);
}

/** Map the raw KV rows to custom themes (invalid entries dropped, capped at the max). */
function mapCustomThemes(kv: Record<string, string>): CustomTheme[] {
	const raw = kv[KEYS.customThemes];
	if (!raw) return [];
	try {
		const arr = JSON.parse(raw);
		if (!Array.isArray(arr)) return [];
		const out: CustomTheme[] = [];
		for (const entry of arr) {
			const clean = sanitizeCustomTheme(entry);
			if (!clean) continue;
			const rawId = (entry as Record<string, unknown>).id;
			const slug =
				typeof rawId === 'string' && rawId.startsWith('custom:')
					? rawId.slice('custom:'.length)
					: slugifyThemeName(clean.name);
			out.push({ id: `custom:${slug}`, ...clean });
			if (out.length >= MAX_CUSTOM_THEMES) break;
		}
		return out;
	} catch {
		return [];
	}
}

/** Read stored custom themes (invalid entries dropped, capped at the max). */
export async function getCustomThemes(): Promise<CustomTheme[]> {
	return mapCustomThemes(await readAppearanceKv());
}

/** Settings, custom themes and the resolved appearance from a *single* read.
 *  The theme hook stashes this on `event.locals` so the root layout load —
 *  which needs the same three things — does not query settings again. */
export async function getAppearanceState(): Promise<AppearanceState> {
	const kv = await readAppearanceKv();
	const settings = mapAppearanceSettings(kv);
	const customThemes = mapCustomThemes(kv);
	return { settings, customThemes, resolved: resolveStoredAppearance(settings, customThemes) };
}

/** Persist the custom theme list, enforcing count and size caps. */
export async function saveCustomThemes(themes: CustomTheme[]): Promise<void> {
	const capped = themes.slice(0, MAX_CUSTOM_THEMES);
	const value = JSON.stringify(capped);
	if (new TextEncoder().encode(value).byteLength > MAX_CUSTOM_THEMES * MAX_THEME_FILE_BYTES) {
		throw new Error('custom themes exceed the storage cap');
	}
	await writeKv(KEYS.customThemes, value);
}

/** Validate custom CSS: size-capped, and the one real breakout (`</style>`)
 *  rejected. Everything else is the user's own business (self-hosted escape
 *  hatch, single-user instance). */
export function validateCustomCss(value: unknown): value is string {
	return typeof value === 'string' && isValidCss(value);
}

/** Slug for a custom theme id: lowercase, hyphenated, collision-safe suffix added by caller. */
export function slugifyThemeName(name: string): string {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40);
	return slug || 'theme';
}

export type { CustomTheme, TokenKey };
