import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getAppearanceState,
	getCustomThemes,
	saveAppearanceSettings,
	validateCustomCss,
	type AppearanceSettings
} from '$lib/server/appearance';
import { findBuiltinTheme } from '$lib/theming/presets';
import { isValidColorValue, isValidRadiusValue } from '$lib/theming/theme-file';

export const GET: RequestHandler = async () => {
	return json(await getAppearanceState());
};

function badRequest(code: string) {
	return json({ error: { code } }, { status: 400 });
}

/** Persist appearance settings. Unknown/invalid values are rejected, never coerced. */
export const POST: RequestHandler = async ({ request }) => {
	let body: Partial<AppearanceSettings>;
	try {
		body = await request.json();
	} catch {
		return badRequest('invalid_request');
	}

	const patch: Partial<AppearanceSettings> = {};

	if (body.themeId !== undefined) {
		if (typeof body.themeId !== 'string') return badRequest('invalid_theme');
		const customThemes = await getCustomThemes();
		if (!findBuiltinTheme(body.themeId) && !customThemes.some((t) => t.id === body.themeId)) {
			return badRequest('invalid_theme');
		}
		patch.themeId = body.themeId;
	}
	if (body.themeAccentOverride !== undefined) {
		if (body.themeAccentOverride !== null && !isValidColorValue(body.themeAccentOverride)) {
			return badRequest('invalid_accent');
		}
		patch.themeAccentOverride = body.themeAccentOverride;
	}
	if (body.themeBackgroundOverride !== undefined) {
		if (body.themeBackgroundOverride !== null && !isValidColorValue(body.themeBackgroundOverride)) {
			return badRequest('invalid_background');
		}
		patch.themeBackgroundOverride = body.themeBackgroundOverride;
	}
	if (body.themeBackgroundImage !== undefined) {
		if (
			body.themeBackgroundImage !== null &&
			(typeof body.themeBackgroundImage !== 'string' ||
				!/^https?:\/\/[^\s"']+$/i.test(body.themeBackgroundImage) ||
				body.themeBackgroundImage.length > 500)
		) {
			return badRequest('invalid_background_image');
		}
		patch.themeBackgroundImage = body.themeBackgroundImage;
	}
	if (body.themeBackgroundImageDim !== undefined) {
		if (
			body.themeBackgroundImageDim !== null &&
			(typeof body.themeBackgroundImageDim !== 'number' ||
				!Number.isFinite(body.themeBackgroundImageDim) ||
				body.themeBackgroundImageDim < 0 ||
				body.themeBackgroundImageDim > 1)
		) {
			return badRequest('invalid_dim');
		}
		patch.themeBackgroundImageDim = body.themeBackgroundImageDim;
	}
	if (body.themeRadiusOverride !== undefined) {
		if (body.themeRadiusOverride !== null && !isValidRadiusValue(body.themeRadiusOverride)) {
			return badRequest('invalid_radius');
		}
		patch.themeRadiusOverride = body.themeRadiusOverride;
	}
	if (body.navPlacement !== undefined) {
		if (body.navPlacement !== 'top' && body.navPlacement !== 'left') {
			return badRequest('invalid_nav_placement');
		}
		patch.navPlacement = body.navPlacement;
	}
	if (body.customCss !== undefined) {
		if (body.customCss !== null && !validateCustomCss(body.customCss)) {
			return badRequest('invalid_custom_css');
		}
		patch.customCss = body.customCss;
	}

	await saveAppearanceSettings(patch);
	return json(await getAppearanceState());
};
