import {
	test,
	expect,
	gotoHydrated,
	triggerJob,
	expectJobCompleted,
	expectNoHorizontalOverflow
} from '../support/fixtures.mjs';
import { seedPrimaryScenario } from '../support/seed.mjs';
import { t } from '../support/i18n.mjs';

test.describe.serial('first-run bootstrap and durable library jobs', () => {
	test('completes setup through a real Jellyfin login and first sync', async ({
		page,
		runtime
	}) => {
		const languageWrites = [];
		page.on('request', (request) => {
			if (
				new URL(request.url()).pathname === '/api/settings' &&
				request.method() === 'POST' &&
				Object.hasOwn(request.postDataJSON() ?? {}, 'language')
			) {
				languageWrites.push(request);
			}
		});
		await gotoHydrated(page, '/');
		await expect(page).toHaveURL(/\/setup$/);
		await expect(page.getByRole('heading', { level: 1, name: t('setup_title') })).toBeVisible();
		await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
		expect(languageWrites).toHaveLength(0);

		await page.getByRole('button', { name: t('setup_next') }).click();
		await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
		expect(languageWrites).toHaveLength(1);
		await page.getByLabel(t('settings_media_server')).selectOption('jellyfin');
		await page.getByLabel(t('settings_server_url')).fill(runtime.fakeJellyfinUrl);
		await page.getByLabel(t('settings_username')).fill('e2e');
		await page.getByLabel(t('settings_password')).fill('posterpilot');
		const loginResponse = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === '/api/media-server/login' &&
				response.request().method() === 'POST'
		);
		await page.getByRole('button', { name: t('settings_log_in') }).click();
		expect((await loginResponse).ok()).toBe(true);
		await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3');
		await page.getByLabel(t('settings_tmdb_key')).fill('e2e-tmdb-key');
		await page.getByRole('button', { name: t('setup_next') }).click();

		for (const provider of [
			t('settings_provider_mediux'),
			t('settings_provider_tmdb'),
			t('settings_provider_fanart'),
			t('settings_provider_theposterdb')
		]) {
			const checkbox = page.getByRole('checkbox', { name: provider, exact: false });
			if (await checkbox.isChecked()) await checkbox.uncheck();
		}
		await page.getByRole('button', { name: t('setup_next') }).click();

		await expect(page.getByText(t('setup_libraries_connected'))).toBeVisible();
		await expect(page.getByLabel(/Movies A/)).toBeChecked();
		await expect(page.getByLabel(/Shows A/)).toBeChecked();
		await page.getByRole('button', { name: t('setup_next') }).click();

		const jobId = await triggerJob(page, '/api/sync', () =>
			page.getByRole('button', { name: t('setup_sync_start') }).click()
		);
		await expectJobCompleted(page, jobId);
		await expect(page.getByRole('status').filter({ hasText: t('setup_done') })).toBeVisible();
		await page.getByRole('button', { name: t('setup_go_dashboard') }).click();
		await expect(page).toHaveURL(/\/$/);
		await expect(page.getByRole('heading', { level: 1, name: t('dashboard_title') })).toBeVisible();
		await expectNoHorizontalOverflow(page);
	});

	test('runs incremental sync and the explicit full-rescan confirmation flow', async ({ page }) => {
		await gotoHydrated(page, '/');
		const incrementalJobId = await triggerJob(page, '/api/sync', () =>
			page.getByRole('button', { name: t('dashboard_sync') }).click()
		);
		await expectJobCompleted(page, incrementalJobId);

		await page.getByRole('button', { name: t('dashboard_full_rescan') }).click();
		const confirmation = page.getByRole('group', {
			name: t('dashboard_full_rescan_confirm_title')
		});
		await expect(confirmation).toContainText(t('dashboard_full_rescan_confirm_hint'));
		const fullJobId = await triggerJob(page, '/api/sync', () =>
			confirmation.getByRole('button', { name: t('dashboard_full_rescan_confirm') }).click()
		);
		await expectJobCompleted(page, fullJobId);
		await expect(page.getByText(t('dashboard_full_rescan_started'))).toBeVisible();
	});

	test('prepares deterministic candidate and collection evidence in the throwaway database', async () => {
		const scenario = await seedPrimaryScenario();
		expect(scenario.primaryServerId).toBeTruthy();
		expect(Object.keys(scenario.primaryItems)).toHaveLength(4);
	});
});
