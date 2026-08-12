/**
 * Appearance settings — internal settings-KV state, deliberately out of
 * AppConfig/ENV_MAP/WRITABLE_KEYS (same pattern as optional auth): these keys
 * need no env override, and `customThemes` is JSON, which the string-only
 * saveSettings path can't represent.
 */

import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';
import { DEFAULT_THEME_ID, type CustomTheme, type TokenKey } from '$lib/theming/schema';
import {
	MAX_CUSTOM_THEMES,
	MAX_THEME_FILE_BYTES,
	sanitizeCustomTheme
} from '$lib/theming/theme-file';

export type NavPlacement = 'top' | 'left';

export interface AppearanceSettings {
	themeId: string;
	themeAccentOverride: string | null;
	themeBackgroundOverride: string | null;
	themeBackgroundImage: string | null;
	themeBackgroundImageDim: number | null;
	themeRadiusOverride: string | null;
	navPlacement: NavPlacement;
}

const KEYS = {
	themeId: 'themeId',
	themeAccentOverride: 'themeAccentOverride',
	themeBackgroundOverride: 'themeBackgroundOverride',
	themeBackgroundImage: 'themeBackgroundImage',
	themeBackgroundImageDim: 'themeBackgroundImageDim',
	themeRadiusOverride: 'themeRadiusOverride',
	navPlacement: 'navPlacement',
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
	KEYS.customThemes
] as const;

async function readAppearanceKv(): Promise<Record<string, string>> {
	const rows = await db.select().from(settings);
	const wanted = new Set<string>(SCALAR_KEYS);
	const out: Record<string, string> = {};
	for (const row of rows) if (wanted.has(row.key)) out[row.key] = row.value;
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

/** Read appearance settings, normalizing anything unexpected to defaults. */
export async function getAppearanceSettings(): Promise<AppearanceSettings> {
	const kv = await readAppearanceKv();
	return {
		themeId: kv[KEYS.themeId] || DEFAULT_THEME_ID,
		themeAccentOverride: kv[KEYS.themeAccentOverride] || null,
		themeBackgroundOverride: kv[KEYS.themeBackgroundOverride] || null,
		themeBackgroundImage: kv[KEYS.themeBackgroundImage] || null,
		themeBackgroundImageDim: parseDim(kv[KEYS.themeBackgroundImageDim]),
		themeRadiusOverride: kv[KEYS.themeRadiusOverride] || null,
		navPlacement: kv[KEYS.navPlacement] === 'left' ? 'left' : 'top'
	};
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
	await Promise.all(writes);
}

/** Read stored custom themes (invalid entries dropped, capped at the max). */
export async function getCustomThemes(): Promise<CustomTheme[]> {
	const kv = await readAppearanceKv();
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

/** Persist the custom theme list, enforcing count and size caps. */
export async function saveCustomThemes(themes: CustomTheme[]): Promise<void> {
	const capped = themes.slice(0, MAX_CUSTOM_THEMES);
	const value = JSON.stringify(capped);
	if (new TextEncoder().encode(value).byteLength > MAX_CUSTOM_THEMES * MAX_THEME_FILE_BYTES) {
		throw new Error('custom themes exceed the storage cap');
	}
	await writeKv(KEYS.customThemes, value);
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
