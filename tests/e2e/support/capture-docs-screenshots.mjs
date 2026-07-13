/**
 * Capture the documentation screenshots from a running PosterPilot instance.
 *
 * Docs images are hand-captured, which makes them drift as the UI changes. This
 * script pins the framing (1280x800, dark, English, 2x for retina) and the exact
 * routes, so a refresh is one command instead of a manual pass.
 *
 * It never starts or seeds an instance: point it at one you already trust. Run it
 * against a throwaway copy of a database rather than a live install, since the
 * capture navigates the real UI.
 *
 * Usage:
 *   node tests/e2e/support/capture-docs-screenshots.mjs --base-url http://127.0.0.1:14200
 *   node tests/e2e/support/capture-docs-screenshots.mjs --only fun-picker,settings-servers
 *
 * Output lands in docs/public/screenshots/ as .webp (quality 90). Requires `cwebp`
 * (`brew install webp`) because Playwright only encodes PNG/JPEG.
 */

import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const outputDirectory = `${repositoryRoot}docs/public/screenshots`;

function flag(name, fallback) {
	const index = process.argv.indexOf(`--${name}`);
	return index === -1 ? fallback : process.argv[index + 1];
}

const baseURL = flag('base-url', 'http://127.0.0.1:14200');
const only = flag('only', '')
	.split(',')
	.map((value) => value.trim())
	.filter(Boolean);

/**
 * Each shot names the docs page it serves. `viewport` overrides exist because a
 * settings panel is taller than the fold and reads better captured whole.
 */
const shots = [
	{
		name: 'settings-servers',
		path: '/settings?tab=server',
		docs: 'multi-server-migration',
		viewport: { width: 1280, height: 800 }
	},
	{
		name: 'settings-automation',
		path: '/settings?tab=automation',
		docs: 'automation-recovery',
		viewport: { width: 1280, height: 840 }
	},
	{
		name: 'settings-backup',
		path: '/settings?tab=backup',
		docs: 'automation-recovery',
		viewport: { width: 1280, height: 620 }
	},
	{
		name: 'fun-picker',
		path: '/fun',
		docs: 'fun-collections',
		viewport: { width: 1280, height: 800 }
	},
	{
		name: 'review-inbox',
		path: '/review',
		docs: 'safety',
		viewport: { width: 1280, height: 900 }
	},
	{
		name: 'apply-exact-plan',
		path: '/item/{{itemId}}',
		docs: 'safety',
		viewport: { width: 1280, height: 900 },
		// Needs an item with staged artwork. `Apply` only opens the confirmation bar
		// carrying the frozen plan — the capture never confirms, so nothing is written.
		requiresItemId: true,
		async prepare(page) {
			await page.getByRole('button', { name: 'Apply', exact: true }).first().click();
			await page.waitForTimeout(1500);
		}
	},
	{
		name: 'item-artwork-history',
		path: '/item/{{itemId}}',
		docs: 'safety',
		viewport: { width: 1280, height: 900 },
		// Needs an item whose artwork was applied, so the timeline and undo are visible.
		requiresItemId: true,
		async prepare(page) {
			await page.getByRole('link', { name: 'Artwork history' }).click();
			await page.waitForSelector('[data-app-hydrated="true"]');
			await page.waitForTimeout(2000);
		}
	}
];

// The history shot is item-scoped; the operator supplies the id from the instance
// they are capturing against (`--item-id 42`).
const itemId = flag('item-id', '');

const selected = (only.length ? shots.filter((shot) => only.includes(shot.name)) : shots).filter(
	(shot) => {
		if (!shot.requiresItemId || itemId) return true;
		console.warn(`• skipping ${shot.name}: needs --item-id`);
		return false;
	}
);
if (!selected.length) {
	console.error(`No shots matched --only. Known: ${shots.map((s) => s.name).join(', ')}`);
	process.exit(1);
}

mkdirSync(outputDirectory, { recursive: true });

const browser = await chromium.launch();
// English + dark + UTC keeps captures reproducible regardless of the operator's
// machine; deviceScaleFactor 2 matches the existing retina screenshots.
const context = await browser.newContext({
	colorScheme: 'dark',
	locale: 'en-US',
	timezoneId: 'UTC',
	deviceScaleFactor: 2,
	reducedMotion: 'reduce'
});

let failures = 0;
for (const shot of selected) {
	const page = await context.newPage();
	await page.setViewportSize(shot.viewport);
	try {
		const path = shot.path.replace('{{itemId}}', itemId);
		await page.goto(`${baseURL}${path}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
		// The app hydrates before it renders live state; the marker is set by the root
		// layout, and the extra settle lets images and transitions finish.
		await page.waitForSelector('[data-app-hydrated="true"]', { timeout: 20_000 });
		await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
		await page.waitForTimeout(600);
		// `prepare` only opens panels and confirmation prompts; it never confirms one.
		if (shot.prepare) await shot.prepare(page);
		const pngPath = `${outputDirectory}/${shot.name}.png`;
		await page.screenshot({ path: pngPath });
		// Playwright encodes PNG/JPEG only, and the docs ship webp.
		execFileSync('cwebp', [
			'-q',
			'90',
			'-quiet',
			pngPath,
			'-o',
			`${outputDirectory}/${shot.name}.webp`
		]);
		rmSync(pngPath, { force: true });
		console.log(`✔ ${shot.name}.webp  (${shot.docs})`);
	} catch (error) {
		failures += 1;
		console.error(`✖ ${shot.name}: ${error.message.split('\n')[0]}`);
	} finally {
		await page.close();
	}
}

await browser.close();
process.exit(failures ? 1 : 0);
