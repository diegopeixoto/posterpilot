import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getAppearanceSettings,
	getCustomThemes,
	saveAppearanceSettings,
	saveCustomThemes,
	slugifyThemeName
} from '$lib/server/appearance';
import { MAX_CUSTOM_THEMES, parseThemeFile, sanitizeCustomTheme } from '$lib/theming/theme-file';
import type { CustomTheme } from '$lib/theming/schema';

function badRequest(code: string) {
	return json({ error: { code } }, { status: 400 });
}

function uniqueThemeId(name: string, existing: CustomTheme[], keepId?: string): string {
	const base = slugifyThemeName(name);
	let candidate = `custom:${base}`;
	for (let i = 2; existing.some((t) => t.id === candidate && t.id !== keepId); i++) {
		candidate = `custom:${base}-${i}`;
	}
	return candidate;
}

/** Create or update a custom theme (update when `id` names an existing theme). */
export const PUT: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return badRequest('invalid_request');
	}

	const clean = sanitizeCustomTheme(body);
	if (!clean) return badRequest('invalid_theme');

	const themes = await getCustomThemes();
	const requestedId = (body as Record<string, unknown>).id;
	const editing =
		typeof requestedId === 'string' ? themes.find((t) => t.id === requestedId) : undefined;
	if (requestedId !== undefined && !editing) return badRequest('invalid_theme');
	if (!editing && themes.length >= MAX_CUSTOM_THEMES) return badRequest('too_many_themes');

	const id = editing?.id ?? uniqueThemeId(clean.name, themes);
	const theme: CustomTheme = { id, ...clean };
	const next = editing ? themes.map((t) => (t.id === id ? theme : t)) : [...themes, theme];
	await saveCustomThemes(next);
	return json({ themes: next, theme });
};

/** Delete a custom theme; deleting the active one falls back to its base. */
export const DELETE: RequestHandler = async ({ url }) => {
	const id = url.searchParams.get('id');
	if (!id) return badRequest('invalid_request');

	const themes = await getCustomThemes();
	const target = themes.find((t) => t.id === id);
	if (!target) return badRequest('invalid_theme');

	await saveCustomThemes(themes.filter((t) => t.id !== id));
	const appearance = await getAppearanceSettings();
	if (appearance.themeId === id) {
		await saveAppearanceSettings({ themeId: target.base });
	}
	return json({ themes: await getCustomThemes() });
};

/** Import a `.posterpilot-theme.json` file: validate, register, return the new theme. */
export const POST: RequestHandler = async ({ request }) => {
	let body: { file?: unknown };
	try {
		body = await request.json();
	} catch {
		return badRequest('invalid_request');
	}
	if (typeof body.file !== 'string') return badRequest('invalid_request');

	const parsed = parseThemeFile(body.file);
	if (!parsed.ok) return badRequest(parsed.error);

	const themes = await getCustomThemes();
	if (themes.length >= MAX_CUSTOM_THEMES) return badRequest('too_many_themes');

	const theme: CustomTheme = {
		id: uniqueThemeId(parsed.theme.name, themes),
		...parsed.theme
	};
	await saveCustomThemes([...themes, theme]);
	return json({ themes: await getCustomThemes(), theme });
};
