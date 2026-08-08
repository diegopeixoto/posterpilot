import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
// The real stylesheet, so computed style is the app's, not the browser default.
import '../../app.css';
import { tick } from 'svelte';
import ArtworkPreviewDialog from './ArtworkPreviewDialog.svelte';
import type { PreviewArtwork } from '$lib/posters/preview-navigation';

/**
 * Component tests for the enlarged artwork preview, in a real browser.
 *
 * Every guarantee here is a focus guarantee — trapped at both ends, restored to
 * the exact trigger, moved into the dialog on open — plus the `<img>` error path.
 * Those are precisely what a DOM emulator models least faithfully: `activeElement`
 * after a keyed re-render, real Tab traversal, and a decoder that actually fails.
 */

/** A 1×1 PNG. Loads for real, over no network, in every engine. */
const LOADS =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
/** Well-formed data URL, undecodable payload: a deterministic `error` event. */
const BREAKS = 'data:image/png;base64,QQ==';

function artwork(id: number, overrides: Partial<PreviewArtwork> = {}): PreviewArtwork {
	return {
		id,
		url: `${LOADS}#${id}`,
		provider: 'mediux',
		width: 2000,
		height: 3000,
		language: 'en',
		...overrides
	};
}

/**
 * Two page-level triggers, so "focus returns to the trigger" can only pass by
 * returning to the *exact* one that opened the dialog.
 */
function triggers(): { first: HTMLButtonElement; second: HTMLButtonElement } {
	const host = document.createElement('div');
	host.dataset.testTriggers = '';
	host.innerHTML =
		'<button type="button" id="trigger-a">a</button><button type="button" id="trigger-b">b</button>';
	document.body.append(host);
	return {
		first: host.querySelector('#trigger-a') as HTMLButtonElement,
		second: host.querySelector('#trigger-b') as HTMLButtonElement
	};
}

function mount(
	overrides: { sequence?: PreviewArtwork[]; index?: number; trigger?: HTMLElement | null } = {}
) {
	const props = $state({
		open: false,
		sequence: overrides.sequence ?? [artwork(1), artwork(2), artwork(3)],
		index: overrides.index ?? 0,
		trigger: overrides.trigger ?? null
	});
	render(ArtworkPreviewDialog, props);
	return props;
}

/** Open the dialog the way the page does, and settle the focus microtask. */
async function openFrom(props: { open: boolean }, trigger?: HTMLButtonElement) {
	if (trigger) trigger.focus();
	props.open = true;
	await tick();
	await tick();
}

const dialog = () => document.getElementById('artwork-preview-dialog');
const control = (name: 'close' | 'previous' | 'next') =>
	document.getElementById(`artwork-preview-${name}`) as HTMLButtonElement;
const positionText = () =>
	document.querySelector('[data-preview-position]')?.textContent?.trim() ?? '';

afterEach(() => {
	document.querySelectorAll('[data-test-triggers]').forEach((host) => host.remove());
});

describe('artwork preview dialog', () => {
	it('opens on the requested candidate and moves focus into the dialog', async () => {
		const props = mount({ index: 1 });
		await openFrom(props);

		expect(dialog()).not.toBeNull();
		expect(dialog()?.getAttribute('aria-modal')).toBe('true');
		expect(document.activeElement?.id).toBe('artwork-preview-close');
		// Position, not just an image: "2 of 3" is what the live region announces.
		expect(positionText()).toContain('2');
		expect(positionText()).toContain('3');
	});

	it('shows the canonical asset uncropped rather than filling the frame', async () => {
		const props = mount();
		await openFrom(props);

		const image = document.getElementById('artwork-preview-image') as HTMLImageElement;
		// The canonical `url`, never a grid thumbnail, and never cropped to fit.
		expect(image.getAttribute('src')).toBe(props.sequence[0].url);
		expect(getComputedStyle(image).objectFit).toBe('contain');
	});

	it('traps Tab at the last control and Shift+Tab at the first', async () => {
		const props = mount({ index: 1 });
		await openFrom(props);

		// Real Tab presses, so a missing preventDefault would let focus leave for the
		// page behind the modal rather than wrapping.
		expect(document.activeElement?.id).toBe('artwork-preview-close');
		await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
		await tick();
		expect(document.activeElement?.id).toBe('artwork-preview-next');

		await userEvent.keyboard('{Tab}');
		await tick();
		expect(document.activeElement?.id).toBe('artwork-preview-close');
	});

	it('closes on Escape and returns focus to the exact trigger that opened it', async () => {
		const { first, second } = triggers();
		const props = mount({ trigger: second });
		first.focus();
		await openFrom(props, second);

		await userEvent.keyboard('{Escape}');
		await tick();
		await tick();

		expect(props.open).toBe(false);
		expect(dialog()).toBeNull();
		expect(document.activeElement).toBe(second);
	});

	it('closes on the close control and on the backdrop, restoring focus each time', async () => {
		const { second } = triggers();
		const props = mount({ trigger: second });

		await openFrom(props, second);
		control('close').click();
		await tick();
		await tick();
		expect(props.open).toBe(false);
		expect(document.activeElement).toBe(second);

		await openFrom(props, second);
		const backdrop = dialog()?.parentElement?.querySelector('button') as HTMLButtonElement;
		backdrop.click();
		await tick();
		await tick();
		expect(props.open).toBe(false);
		expect(document.activeElement).toBe(second);
	});

	it('walks the sequence with next and previous, announcing each position', async () => {
		const props = mount();
		await openFrom(props);

		// At the first candidate there is nowhere back to go, and that is stated
		// programmatically rather than by appearance alone.
		expect(control('previous').disabled).toBe(true);
		expect(positionText()).toContain('1');

		control('next').click();
		await tick();
		expect(positionText()).toContain('2');
		expect((document.getElementById('artwork-preview-image') as HTMLImageElement).src).toBe(
			props.sequence[1].url
		);
		expect(control('previous').disabled).toBe(false);

		control('next').click();
		await tick();
		expect(positionText()).toContain('3');
		expect(control('next').disabled).toBe(true);

		control('previous').click();
		await tick();
		expect(positionText()).toContain('2');
	});

	it('hands focus to the sibling when a navigation control reaches its bound', async () => {
		const props = mount({ index: 1 });
		await openFrom(props);

		// Pressing Next into the last position disables Next under the cursor; focus
		// has to survive on a live control rather than fall to <body>.
		control('next').focus();
		control('next').click();
		await tick();
		await tick();
		expect(control('next').disabled).toBe(true);
		expect(document.activeElement?.id).toBe('artwork-preview-previous');

		control('previous').focus();
		control('previous').click();
		await tick();
		await tick();
		control('previous').click();
		await tick();
		await tick();
		expect(control('previous').disabled).toBe(true);
		expect(document.activeElement?.id).toBe('artwork-preview-next');
	});

	it('walks only the sequence it was given, and never rewrites it', async () => {
		const props = mount();
		const original = props.sequence.map((entry) => entry.id);
		await openFrom(props);

		control('next').click();
		await tick();
		control('next').click();
		await tick();
		// Clamped at the end: a wraparound would contradict the announced "3 of 3".
		control('next').click();
		await tick();
		expect(positionText()).toContain('3');

		control('close').click();
		await tick();
		// Preview is not staging: the dialog exposes no selection and mutates nothing
		// the page handed it.
		expect(props.sequence.map((entry) => entry.id)).toEqual(original);
		expect(props.index).toBe(0);
	});

	it('follows the candidate on screen when the page refilters underneath it', async () => {
		const props = mount();
		await openFrom(props);
		control('next').click();
		await tick();
		expect(positionText()).toContain('2');

		// The first candidate is filtered away while the dialog is open: same
		// artwork, new ordinal.
		props.sequence = [props.sequence[1], props.sequence[2]];
		await tick();
		await tick();
		expect(positionText()).toContain('1');
		expect((document.getElementById('artwork-preview-image') as HTMLImageElement).src).toBe(
			props.sequence[0].url
		);
	});

	it('presents a localized error state when the full-size image fails to load', async () => {
		const props = mount({ sequence: [artwork(1, { url: BREAKS })] });
		await openFrom(props);

		const alert = await vi.waitFor(() => {
			const found = document.querySelector('[role="alert"]');
			expect(found).not.toBeNull();
			return found as HTMLElement;
		});

		expect(alert.textContent?.trim()).not.toBe('');
		expect(document.getElementById('artwork-preview-image')).toBeNull();
		// Still a usable dialog: the close control did not go with the image.
		expect(control('close')).not.toBeNull();
	});

	it('declares no entrance motion, so reduced-motion users are already served', async () => {
		const props = mount();
		await openFrom(props);

		const backdrop = dialog()?.parentElement?.querySelector('button') as HTMLElement;
		expect(getComputedStyle(backdrop).animationName).toBe('none');
		expect(getComputedStyle(dialog() as HTMLElement).animationName).toBe('none');
	});

	it('gives every control a 44px touch target', async () => {
		const props = mount({ index: 1 });
		await openFrom(props);

		for (const name of ['close', 'previous', 'next'] as const) {
			const box = control(name).getBoundingClientRect();
			expect(box.height).toBeGreaterThanOrEqual(44);
			expect(box.width).toBeGreaterThanOrEqual(44);
		}
	});
});
