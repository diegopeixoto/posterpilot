import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
// The real stylesheet, so computed style is the app's, not the browser default.
import '../../app.css';
import CoverageBadge from './CoverageBadge.svelte';
import { COVERAGE_STATUSES, type CoverageStatus } from '$lib/artwork-coverage';

/**
 * Component tests for the coverage badge, in a real browser.
 *
 * The claim under test is the one the requirement makes: a badge is never conveyed
 * by colour alone. That is a statement about computed style and about the text an
 * assistive technology would read, so it is checked here with the real stylesheet
 * loaded rather than by asserting class names — a tone renamed out from under the
 * component would still pass a class-name assertion.
 */

/** Render every status once; `cleanup` runs between tests, not within one. */
function renderAll(): HTMLElement[] {
	for (const status of COVERAGE_STATUSES) render(CoverageBadge, { status });
	return [...document.querySelectorAll<HTMLElement>('[data-coverage-badge]')];
}

function badgeFor(status: CoverageStatus): HTMLElement {
	render(CoverageBadge, { status });
	return document.querySelector<HTMLElement>(`[data-coverage-status="${status}"]`)!;
}

/** What a screen reader would announce: everything except the decorative glyph. */
function accessibleText(badge: HTMLElement): string {
	const clone = badge.cloneNode(true) as HTMLElement;
	for (const hidden of clone.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
	return clone.textContent?.trim() ?? '';
}

describe('coverage badge', () => {
	it('gives every status readable text, not just a colour', () => {
		const badges = renderAll();
		expect(badges).toHaveLength(COVERAGE_STATUSES.length);
		for (const badge of badges) {
			expect(accessibleText(badge)).not.toBe('');
		}
	});

	it('keeps the label distinct for every status even where the tone repeats', () => {
		const badges = renderAll();
		const labels = badges.map(accessibleText);
		const colors = badges.map((badge) => getComputedStyle(badge).color);

		// The rule, stated as an assertion: text is always distinct, colour need not
		// be. Someone who cannot separate two of these tones still reads six answers.
		expect(new Set(labels).size).toBe(COVERAGE_STATUSES.length);
		expect(colors.every((color) => color !== '')).toBe(true);
	});

	it('hides the glyph from assistive technology and keeps the label exposed', () => {
		const badge = badgeFor('applied_on_server');
		const glyph = badge.querySelector('[aria-hidden="true"]');
		const label = badge.querySelector('[data-coverage-label]');

		expect(glyph?.textContent?.trim()).not.toBe('');
		expect(label?.getAttribute('aria-hidden')).toBeNull();
		expect(label?.textContent?.trim()).toBe(accessibleText(badge));
	});

	it('draws a Kometa export differently from a verified server write, in text and in tone', () => {
		const applied = badgeFor('applied_on_server');
		const exported = badgeFor('exported_to_kometa');

		expect(accessibleText(exported)).not.toBe(accessibleText(applied));
		// The load-bearing one: an export must not borrow the colour that says the
		// artwork is live on a server. Compared as computed style, so a tone that was
		// quietly repointed at the applied palette fails here.
		expect(getComputedStyle(exported).backgroundColor).not.toBe(
			getComputedStyle(applied).backgroundColor
		);
		expect(exported.dataset.coverageTone).not.toBe('covered');
	});

	it('never lets an external change read as absence', () => {
		const changed = badgeFor('externally_changed');
		const missing = badgeFor('missing');

		expect(accessibleText(changed)).not.toBe(accessibleText(missing));
		expect(getComputedStyle(changed).color).not.toBe(getComputedStyle(missing).color);
	});

	it('renders through the shared badge shape from the app stylesheet', () => {
		const badge = badgeFor('unknown');
		// Proves app.css is actually applied, which is what makes the colour
		// comparisons above mean anything.
		expect(getComputedStyle(badge).display).toBe('inline-flex');
		expect(getComputedStyle(badge).borderStyle).toBe('dashed');
	});
});
