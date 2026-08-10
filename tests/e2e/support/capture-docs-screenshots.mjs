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
 *
 * The `readme-*` shots are the exception: they write JPEG straight into
 * artwork/screenshots/ and need no external encoder. Refresh them with
 *
 *   node tests/e2e/support/capture-docs-screenshots.mjs \
 *     --base-url http://127.0.0.1:14200 --item-id 42 \
 *     --only readme-library,readme-item-detail,readme-item-coverage,readme-artwork-preview
 *
 * They want a populated library — a near-empty one makes the poster wall and the
 * artwork grids look broken rather than clean.
 *
 * Two shots need an id from the instance being captured: `--item-id` (the item
 * detail, coverage and preview shots) and `--collection-id`.
 *
 * `setup-wizard` needs an instance whose database is empty, since the wizard only
 * exists before setup. Point the script at a throwaway instance started with a
 * fresh DATABASE_URL and capture it on its own:
 *
 *   node tests/e2e/support/capture-docs-screenshots.mjs \
 *     --base-url http://127.0.0.1:14201 --only setup-wizard
 */

import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const outputDirectory = `${repositoryRoot}docs/public/screenshots`;
// README images live with the other repository artwork and ship as JPEG, because
// GitHub renders README markdown without the docs site's asset pipeline.
const readmeDirectory = `${repositoryRoot}artwork/screenshots`;

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
		name: 'dashboard',
		path: '/',
		docs: 'usage',
		viewport: { width: 1280, height: 800 }
	},
	{
		name: 'library',
		path: '/library',
		docs: 'usage',
		viewport: { width: 1280, height: 900 }
	},
	{
		name: 'item-detail',
		path: '/item/{{itemId}}',
		docs: 'usage',
		viewport: { width: 1280, height: 900 },
		// Framed on the candidate grids, which is what the caption promises and what
		// distinguishes this from `item-coverage` — both open the same route, and
		// without this they came out byte-identical.
		requiresItemId: true,
		async prepare(page) {
			// Frame the candidate grids. They sit below the fold and the first provider
			// group is the only one expanded, so scroll rather than expand: the shot
			// should show the page as it opens, just further down.
			const grid = page.locator('[data-artwork-select]').first();
			await grid.waitFor({ state: 'attached', timeout: 20_000 }).catch(() => undefined);
			await page.evaluate(() => {
				document.querySelector('[data-artwork-select]')?.scrollIntoView({ block: 'center' });
			});
			await page.waitForTimeout(1200);
		}
	},
	{
		name: 'collection-discover',
		path: '/collections/{{collectionId}}',
		docs: 'fun-collections',
		viewport: { width: 1280, height: 900 },
		requiresCollectionId: true,
		async prepare(page) {
			await page.waitForTimeout(900);
		}
	},
	{
		name: 'settings-providers',
		path: '/settings?tab=providers',
		docs: 'configuration',
		viewport: { width: 1280, height: 900 }
	},
	{
		name: 'settings-security',
		path: '/settings?tab=security',
		docs: 'safety',
		viewport: { width: 1280, height: 620 }
	},
	{
		name: 'kometa-manager',
		path: '/kometa',
		docs: 'kometa-config-sync',
		viewport: { width: 1280, height: 900 }
	},
	{
		name: 'setup-wizard',
		path: '/setup',
		docs: 'installation',
		viewport: { width: 1280, height: 900 }
	},
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
		name: 'item-coverage',
		path: '/item/{{itemId}}',
		docs: 'usage',
		viewport: { width: 1280, height: 900 },
		// The coverage panels: one per destination, never merged. Needs an item that
		// has been reconciled at least once, so open it and let the read settle.
		requiresItemId: true,
		async prepare(page) {
			await page.waitForTimeout(1200);
		}
	},
	{
		name: 'artwork-preview',
		path: '/item/{{itemId}}',
		docs: 'usage',
		viewport: { width: 1280, height: 900 },
		// The enlarged preview. Opening it stages nothing — that is the guarantee the
		// dialog is built around, and the capture relies on it.
		requiresItemId: true,
		async prepare(page) {
			const trigger = page.locator('[data-artwork-preview]').first();
			await trigger.scrollIntoViewIfNeeded();
			await trigger.click();
			await page.waitForSelector('#artwork-preview-image', { timeout: 15_000 });
			await page.waitForTimeout(1500);
		}
	},
	{
		name: 'library-coverage-filter',
		path: '/library?coverage=needs_artwork',
		docs: 'usage',
		viewport: { width: 1280, height: 900 }
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
	},
	// --- README shots -------------------------------------------------------
	// Separate entries rather than reusing the docs shots above: the README has four
	// images to carry the whole product, so each is framed to show a feature working
	// on a populated library, where the docs shots favour a clean, minimal frame.
	{
		name: 'readme-library',
		path: '/library',
		readme: 'library',
		viewport: { width: 1280, height: 800 }
	},
	{
		name: 'readme-item-detail',
		path: '/item/{{itemId}}',
		readme: 'item-detail',
		viewport: { width: 1280, height: 800 },
		requiresItemId: true,
		// Framed just above the TMDB group, which puts the widest run of discovered
		// covers in shot. MediUX contributes many single-poster author sets, so aiming
		// at "the first grid" reliably lands on a sparse one.
		async prepare(page) {
			await expandArtworkGroups(page);
			await page.evaluate(() => {
				const header = [...document.querySelectorAll('button, h2, h3')].find((element) =>
					/TMDB\s*·/i.test(element.textContent ?? '')
				);
				if (!header) return;
				const top = header.getBoundingClientRect().top + window.scrollY;
				window.scrollTo({ top: Math.max(0, top - 560), behavior: 'instant' });
			});
			await page.waitForTimeout(2500);
		}
	},
	{
		name: 'readme-item-coverage',
		path: '/item/{{itemId}}',
		readme: 'item-coverage',
		viewport: { width: 1280, height: 800 },
		requiresItemId: true,
		// Nudged down so both coverage cards clear the sticky apply bar; the hero stays
		// in shot, which is what identifies the title the coverage belongs to.
		async prepare(page) {
			await page.waitForTimeout(1200);
			await page.evaluate(() => window.scrollBy({ top: 70, behavior: 'instant' }));
			await page.waitForTimeout(600);
		}
	},
	{
		name: 'readme-artwork-preview',
		path: '/item/{{itemId}}',
		readme: 'artwork-preview',
		viewport: { width: 1280, height: 800 },
		requiresItemId: true,
		// Opened from the largest group rather than the first tile: single-poster sets
		// render "1 of 1", which hides what previous/next is for. A couple of tiles in
		// from the group's start, so neither arrow is disabled in the shot.
		async prepare(page) {
			await expandArtworkGroups(page);
			const index = await page.evaluate(() => {
				const tiles = [...document.querySelectorAll('[data-artwork-preview]')];
				const counts = new Map();
				for (const tile of tiles) {
					const group = tile.closest('li, section, div[class*="rounded"]')?.parentElement;
					if (group) counts.set(group, (counts.get(group) ?? 0) + 1);
				}
				let largest = null;
				for (const [group, count] of counts) {
					if (!largest || count > largest[1]) largest = [group, count];
				}
				const target = largest?.[0]?.querySelector('[data-artwork-preview]') ?? tiles[0];
				target?.scrollIntoView({ block: 'center' });
				return tiles.indexOf(target);
			});
			await page.waitForTimeout(500);
			await page
				.locator('[data-artwork-preview]')
				.nth(Math.max(0, index + 2))
				.click();
			await page.waitForSelector('#artwork-preview-image', { timeout: 20_000 });
			await page.waitForTimeout(2000);
		}
	}
];

/**
 * Reveal every collapsed artwork group, so a shot can be framed on what discovery
 * actually returned rather than on the collapsed headers.
 *
 * Clicks are best effort: a group that refuses to open is one fewer grid in frame,
 * which is not worth failing a capture over.
 */
async function expandArtworkGroups(page) {
	for (const toggle of await page.locator('button[aria-expanded="false"]').all()) {
		await toggle.click().catch(() => undefined);
		await page.waitForTimeout(60);
	}
	await page.waitForTimeout(1200);
}

// The history shot is item-scoped; the operator supplies the id from the instance
// they are capturing against (`--item-id 42`).
const itemId = flag('item-id', '');
const collectionId = flag('collection-id', '');

const selected = (only.length ? shots.filter((shot) => only.includes(shot.name)) : shots).filter(
	(shot) => {
		if (shot.requiresItemId && !itemId) {
			console.warn(`• skipping ${shot.name}: needs --item-id`);
			return false;
		}
		if (shot.requiresCollectionId && !collectionId) {
			console.warn(`• skipping ${shot.name}: needs --collection-id`);
			return false;
		}
		return true;
	}
);
if (!selected.length) {
	console.error(`No shots matched --only. Known: ${shots.map((s) => s.name).join(', ')}`);
	process.exit(1);
}

mkdirSync(outputDirectory, { recursive: true });
if (selected.some((shot) => shot.readme)) mkdirSync(readmeDirectory, { recursive: true });

const browser = await chromium.launch();
// English + dark + UTC keeps captures reproducible regardless of the operator's
// machine.
const environment = {
	colorScheme: 'dark',
	locale: 'en-US',
	timezoneId: 'UTC',
	reducedMotion: 'reduce'
};
// deviceScaleFactor 2 matches the existing retina docs screenshots. README images
// are 1x: GitHub serves them at their intrinsic size to every visitor, so a retina
// capture would quadruple the bytes of the first thing anyone loads.
const context = await browser.newContext({ ...environment, deviceScaleFactor: 2 });
const readmeContext = await browser.newContext({ ...environment, deviceScaleFactor: 1 });

let failures = 0;
for (const shot of selected) {
	const page = await (shot.readme ? readmeContext : context).newPage();
	await page.setViewportSize(shot.viewport);
	try {
		const path = shot.path.replace('{{itemId}}', itemId).replace('{{collectionId}}', collectionId);
		await page.goto(`${baseURL}${path}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
		// The app hydrates before it renders live state; the marker is set by the root
		// layout, and the extra settle lets images and transitions finish.
		await page.waitForSelector('[data-app-hydrated="true"]', { timeout: 20_000 });
		await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
		await page.waitForTimeout(600);
		// `prepare` only opens panels and confirmation prompts; it never confirms one.
		if (shot.prepare) await shot.prepare(page);
		if (shot.readme) {
			// Encoded by Playwright directly: JPEG needs no external tool, which keeps
			// a README refresh runnable without installing anything.
			await page.screenshot({
				path: `${readmeDirectory}/${shot.readme}.jpg`,
				type: 'jpeg',
				quality: 82
			});
			console.log(`✔ ${shot.readme}.jpg  (README)`);
			continue;
		}
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

await readmeContext.close();
await browser.close();
process.exit(failures ? 1 : 0);
