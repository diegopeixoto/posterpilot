import { test as base, expect } from '@playwright/test';
import { readRuntime, readScenario } from './seed.mjs';
import { t } from './i18n.mjs';

export const test = base.extend({
	runtime: [async ({ browserName: _browserName }, use) => use(readRuntime()), { scope: 'worker' }],
	scenario: async ({ browserName: _browserName }, use) => use(readScenario()),
	localArtwork: [
		async ({ page, runtime }, use) => {
			await page.route(
				(url) => url.pathname === '/api/thumb',
				async (route) => {
					const source = new URL(route.request().url()).searchParams.get('url');
					if (!source?.startsWith(`${runtime.fakeJellyfinUrl}/assets/`)) {
						await route.continue();
						return;
					}

					// Production deliberately rejects loopback provider URLs. The browser
					// harness serves the same deterministic PNG bytes without weakening that
					// SSRF boundary just to make the visual FUN flows testable.
					const response = await fetch(source);
					await route.fulfill({
						status: response.status,
						contentType: response.headers.get('content-type') ?? 'image/png',
						body: Buffer.from(await response.arrayBuffer())
					});
				}
			);
			await use(undefined);
		},
		{ auto: true }
	],
	pageExceptions: [
		async ({ page }, use, testInfo) => {
			const exceptions = [];
			page.on('pageerror', (error) => exceptions.push(error.stack ?? error.message));
			await use(exceptions);
			if (exceptions.length > 0) {
				await testInfo.attach('page-exceptions.txt', {
					body: Buffer.from(exceptions.join('\n\n'), 'utf8'),
					contentType: 'text/plain'
				});
			}
			expect.soft(exceptions, 'uncaught browser exceptions').toEqual([]);
		},
		{ auto: true }
	]
});

export { expect };

export async function gotoHydrated(page, url) {
	await page.goto(url);
	await expect(page.locator('[data-app-hydrated="true"]')).toBeAttached();
}

export async function reloadHydrated(page) {
	await page.reload();
	await expect(page.locator('[data-app-hydrated="true"]')).toBeAttached();
}

export async function triggerJob(page, endpoint, action) {
	const responsePromise = page.waitForResponse((response) => {
		const url = new URL(response.url());
		return url.pathname === endpoint && response.request().method() === 'POST';
	});
	await action();
	const response = await responsePromise;
	expect(response.ok(), `job request ${endpoint}`).toBeTruthy();
	const body = await response.json();
	expect(body.jobId).toEqual(expect.any(Number));
	return Number(body.jobId);
}

export async function expectJobCompleted(page, jobId) {
	// The production SSE endpoint closes on a terminal snapshot. Reading it here
	// makes fast dashboard jobs deterministic even when their live card is replaced
	// immediately by the recent-jobs row.
	const stream = await page.request.get(`/api/jobs/${jobId}/stream`, { timeout: 60_000 });
	expect(stream.ok(), `job stream ${jobId}`).toBeTruthy();
	const snapshots = (await stream.text())
		.split('\n')
		.filter((line) => line.startsWith('data: '))
		.map((line) => JSON.parse(line.slice(6)));
	expect(snapshots.length).toBeGreaterThan(0);
	expect(snapshots.at(-1)).toMatchObject({ jobId, status: 'completed' });

	const progress = page.getByRole('progressbar', {
		name: `Job #${jobId} · ${t('jobs_status_completed')}`
	});
	const recentRow = page
		.getByRole('row')
		.filter({ hasText: `#${jobId}` })
		.filter({ hasText: t('jobs_status_completed') });
	await expect
		.poll(
			async () =>
				(await progress
					.first()
					.isVisible()
					.catch(() => false)) ||
				(await recentRow
					.first()
					.isVisible()
					.catch(() => false)),
			{ message: `completed job ${jobId} is visible in progress or recent jobs`, timeout: 15_000 }
		)
		.toBe(true);
}

export async function expectNoHorizontalOverflow(page) {
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(1);
}
