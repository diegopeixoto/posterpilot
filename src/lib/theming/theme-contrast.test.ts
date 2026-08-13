/**
 * Holds every shipped theme to WCAG AA.
 *
 * `.impeccable.md` promises AA "in every shipped theme (checked when a theme is
 * added)". This is that check: it reads the `[data-theme]` blocks out of
 * `app.css` — the runtime source of truth — so a new theme cannot be added, or
 * an existing token darkened, without the ratios being measured.
 *
 * Scope is text and the accent fill. Borders are deliberately not asserted:
 * they separate regions rather than identify controls (which are identified by
 * fill, label and the shared `:focus-visible` ring), so 1.4.11 does not bind
 * them, and the themes use them as quiet dividers by design.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AA_TEXT, contrastOf } from './contrast';
import { BUILTIN_THEMES } from './presets';

const css = readFileSync(fileURLToPath(new URL('../../app.css', import.meta.url)), 'utf8');

/** Pull one theme's declared tokens out of its `[data-theme]` block. */
function themeTokens(id: string): Record<string, string> {
	const block = css.match(new RegExp(`\\[data-theme='${id}'\\]\\s*\\{([^}]*)\\}`));
	expect(block, `missing [data-theme='${id}'] block`).not.toBeNull();
	const tokens: Record<string, string> = {};
	for (const declaration of block![1].matchAll(/--pp-([a-z0-9-]+):\s*([^;]+);/g)) {
		tokens[declaration[1]] = declaration[2].trim();
	}
	return tokens;
}

const TEXT_TOKENS = [
	'text',
	'text-bright',
	'text-strong',
	'text-secondary',
	'text-muted',
	'text-faint'
] as const;

/** What a theme actually renders with: its parent's block for a palette
 *  variant, with the variant's deltas layered on. */
function effectiveTokens(id: string): Record<string, string> {
	const theme = BUILTIN_THEMES.find((entry) => entry.id === id)!;
	return { ...themeTokens(theme.variantOf ?? theme.id), ...(theme.tokens ?? {}) };
}

describe.each(BUILTIN_THEMES.map((theme) => theme.id))('theme %s', (id) => {
	const tokens = effectiveTokens(id);

	it.each(TEXT_TOKENS)('reads at AA for %s on both backgrounds', (token) => {
		for (const surface of ['background', 'surface'] as const) {
			const ratio = contrastOf(tokens[token], tokens[surface]);
			expect(ratio, `${id}: ${token} on ${surface} is unparseable`).not.toBeNull();
			expect(
				ratio,
				`${id}: --pp-${token} (${tokens[token]}) on --pp-${surface} (${tokens[surface]})`
			).toBeGreaterThanOrEqual(AA_TEXT);
		}
	});

	it('reads at AA for the accent foreground on the accent fill', () => {
		// `--color-accent-600` falls back to the base when a theme sets no stops.
		const fill = tokens['accent-600'] ?? tokens['accent-base'];
		expect(contrastOf(tokens['accent-foreground'], fill)).toBeGreaterThanOrEqual(AA_TEXT);
	});
});
