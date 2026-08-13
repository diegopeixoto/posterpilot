/**
 * Theme-kit engine — color math. Pure and dependency-free: parses the color
 * grammars the theme file format accepts (hex, `rgb()`, `hsl()`) and computes
 * WCAG relative luminance and contrast ratios.
 *
 * Two callers: the resolver, which derives a readable `accent-foreground` for a
 * user-chosen accent (the picker would otherwise happily paint white text on a
 * yellow button), and `theme-contrast.test.ts`, which holds every built-in
 * theme's text tokens to AA.
 */

export type Rgb = [number, number, number];

/** WCAG AA threshold for normal text. */
export const AA_TEXT = 4.5;

const HEX_RE = /^#([0-9a-f]{3,8})$/i;
const RGB_RE = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,[^)]*)?\)$/i;
const HSL_RE = /^hsla?\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\s*(?:,[^)]*)?\)$/i;

function hslToRgb(h: number, s: number, l: number): Rgb {
	const sat = s / 100;
	const light = l / 100;
	const c = (1 - Math.abs(2 * light - 1)) * sat;
	const hp = (((h % 360) + 360) % 360) / 60;
	const x = c * (1 - Math.abs((hp % 2) - 1));
	const [r, g, b] =
		hp < 1
			? [c, x, 0]
			: hp < 2
				? [x, c, 0]
				: hp < 3
					? [0, c, x]
					: hp < 4
						? [0, x, c]
						: hp < 5
							? [x, 0, c]
							: [c, 0, x];
	const m = light - c / 2;
	return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** Parse a color literal to 8-bit RGB. Alpha is accepted but ignored — contrast
 *  against an unknown backdrop is not something we can compute. */
export function parseColor(value: string): Rgb | null {
	const input = value.trim();

	const hex = HEX_RE.exec(input);
	if (hex) {
		const digits = hex[1];
		// #rgb / #rgba → expand each nibble; #rrggbb / #rrggbbaa → take pairs.
		if (digits.length === 3 || digits.length === 4) {
			return [0, 1, 2].map((i) => parseInt(digits[i] + digits[i], 16)) as Rgb;
		}
		if (digits.length === 6 || digits.length === 8) {
			return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as Rgb;
		}
		return null;
	}

	const rgb = RGB_RE.exec(input);
	if (rgb) {
		const channels = [rgb[1], rgb[2], rgb[3]].map(Number);
		return channels.some((c) => c > 255) ? null : (channels as Rgb);
	}

	const hsl = HSL_RE.exec(input);
	if (hsl) {
		const [h, s, l] = [hsl[1], hsl[2], hsl[3]].map(Number);
		return s > 100 || l > 100 ? null : hslToRgb(h, s, l);
	}

	return null;
}

/** WCAG 2.x relative luminance. */
function relativeLuminance([r, g, b]: Rgb): number {
	const [lr, lg, lb] = [r, g, b].map((channel) => {
		const c = channel / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/** WCAG contrast ratio between two colors, 1–21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
	const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
	return (light + 0.05) / (dark + 0.05);
}

/** Contrast ratio between two color literals; null when either is unparseable. */
export function contrastOf(a: string, b: string): number | null {
	const [ca, cb] = [parseColor(a), parseColor(b)];
	return ca && cb ? contrastRatio(ca, cb) : null;
}

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

/**
 * Pick black or white — whichever reads better on `color`. Used for
 * `--pp-accent-foreground` whenever the accent changes underneath a theme's
 * own paired foreground. Returns null for an unparseable color, so the caller
 * keeps the theme's value rather than guessing.
 */
export function readableForeground(color: string): string | null {
	const rgb = parseColor(color);
	if (!rgb) return null;
	return contrastRatio(rgb, BLACK) >= contrastRatio(rgb, WHITE) ? '#000000' : '#ffffff';
}
