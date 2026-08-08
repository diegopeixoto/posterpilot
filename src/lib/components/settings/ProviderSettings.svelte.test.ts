import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
// The real stylesheet, so computed style is the app's, not the browser default.
import '../../../app.css';
import { tick } from 'svelte';
import ProviderSettings from './ProviderSettings.svelte';
import { RANKING_PROVIDERS, type RankingProvider } from '$lib/settings/provider-order';

/**
 * Component tests for the canonical provider-order control, in a real browser.
 *
 * Everything asserted here is about focus, live-region text, and DOM order after
 * a keyed re-insertion — behavior a DOM emulator reproduces only approximately,
 * and the reason a keyboard reorder that dropped focus to `<body>` survived the
 * unit suite and had to be caught end-to-end.
 */

function mount(overrides: { providerPriority?: RankingProvider[]; enabled?: boolean } = {}) {
	const props = $state({
		tmdbKey: '',
		tmdbKeySet: true,
		providerMediux: overrides.enabled ?? true,
		providerTmdb: true,
		providerFanart: true,
		providerThePosterDb: true,
		providerPriority: overrides.providerPriority ?? [...RANKING_PROVIDERS],
		tmdbArtworkLanguage: 'any',
		fanartKey: '',
		fanartKeySet: true,
		thePosterDbUsername: '',
		thePosterDbPassword: '',
		thePosterDbPasswordSet: false,
		thePosterDbPasswordClear: false,
		env: {}
	});
	render(ProviderSettings, props);
	return props;
}

/** The rendered order, read from the button ids rather than localized labels. */
function renderedOrder(): string[] {
	return [...document.querySelectorAll<HTMLElement>('[data-provider-row]')].map((row) =>
		row
			.querySelector<HTMLElement>('[id^="provider-order-down-"]')!
			.id.replace('provider-order-down-', '')
	);
}

function button(direction: 'up' | 'down', provider: string): HTMLButtonElement {
	return document.getElementById(`provider-order-${direction}-${provider}`) as HTMLButtonElement;
}

function liveRegion(): string {
	return document.querySelector('p[aria-live="polite"]')?.textContent?.trim() ?? '';
}

describe('provider order control', () => {
	it('moves a provider down and keeps focus on the control that moved it', async () => {
		mount();
		const [first, second] = renderedOrder();

		button('down', first).click();
		await tick();
		await tick();

		expect(renderedOrder().slice(0, 2)).toEqual([second, first]);
		// The regression that shipped: the keyed `{#each}` re-inserts the moved row,
		// and focusing before that lands on a node the re-insertion discards.
		expect(document.activeElement?.id).toBe(`provider-order-down-${first}`);
	});

	it('moves a provider up and announces its new position politely', async () => {
		mount();
		const order = renderedOrder();
		const mover = order[1];

		button('up', mover).click();
		await tick();
		await tick();

		expect(renderedOrder()[0]).toBe(mover);
		expect(liveRegion()).not.toBe('');
		expect(liveRegion()).toContain('1');
	});

	it('hands focus to the sibling control when the pressed one reaches a bound', async () => {
		mount();
		const order = renderedOrder();
		const mover = order[1];

		// Moving to the very top disables the up button that was just pressed, so
		// focus has to survive on the same provider rather than vanish.
		button('up', mover).click();
		await tick();
		await tick();

		expect(button('up', mover).disabled).toBe(true);
		expect(document.activeElement?.id).toBe(`provider-order-down-${mover}`);
	});

	it('offers a reset only once the order differs from the default', async () => {
		const props = mount();
		const resetName = /reset|restablecer|restaurar|rétablir|恢复|既定/i;
		const findReset = () =>
			[...document.querySelectorAll('button')].find((element) =>
				resetName.test(element.textContent ?? '')
			);

		expect(findReset()).toBeUndefined();

		button('down', renderedOrder()[0]).click();
		await tick();
		await tick();
		expect(renderedOrder()).not.toEqual([...RANKING_PROVIDERS]);

		const reset = findReset();
		expect(reset).toBeDefined();
		reset!.click();
		await tick();
		await tick();

		expect(renderedOrder()).toEqual([...RANKING_PROVIDERS]);
		// Staged, not saved: the parent's value changed, and the page-wide Save is
		// still what persists it.
		expect(props.providerPriority).toEqual([...RANKING_PROVIDERS]);
		expect(findReset()).toBeUndefined();
	});

	it('keeps a disabled provider in place so re-enabling restores its position', async () => {
		mount({ enabled: false });

		const rows = [...document.querySelectorAll<HTMLElement>('[data-provider-row]')];
		expect(renderedOrder()).toEqual([...RANKING_PROVIDERS]);
		// Position is carried by text, not by colour alone.
		expect(rows[0].textContent).toMatch(/\S/);
		expect(button('down', RANKING_PROVIDERS[0])).toBeTruthy();
	});

	it('confines touch-action to the drag handle so the page still scrolls', async () => {
		mount();

		const handles = [
			...document.querySelectorAll<HTMLElement>('[data-provider-row] button')
		].filter((element) => getComputedStyle(element).touchAction === 'none');
		expect(handles).toHaveLength(RANKING_PROVIDERS.length);

		for (const row of document.querySelectorAll<HTMLElement>('[data-provider-row]')) {
			expect(getComputedStyle(row).touchAction).not.toBe('none');
			expect(row.getAttribute('draggable')).toBeNull();
		}
	});
});
