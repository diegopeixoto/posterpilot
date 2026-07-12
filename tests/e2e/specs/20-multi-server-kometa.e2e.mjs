import { readFileSync } from 'node:fs';
import {
	test,
	expect,
	gotoHydrated,
	triggerJob,
	expectJobCompleted,
	expectNoHorizontalOverflow
} from '../support/fixtures.mjs';
import { recordSecondaryServer } from '../support/seed.mjs';
import { t } from '../support/i18n.mjs';

test.describe.serial('multi-server isolation and Kometa exact writes', () => {
	let secondaryServerId;

	test('connects a second named server through Settings and switches the active scope', async ({
		page,
		runtime
	}) => {
		await gotoHydrated(page, '/settings?tab=server');
		const manager = page.getByRole('region', { name: t('server_manager_title') });
		await manager.getByRole('button', { name: t('server_manager_add') }).click();
		const addForm = manager.locator('#server-manager-add-form');
		await addForm.getByLabel(t('server_manager_name')).fill('Cinema B');
		await addForm.getByLabel(t('server_manager_type'), { exact: true }).selectOption('plex');
		await addForm.getByLabel(t('server_manager_url')).fill(runtime.fakePlexUrl);
		await addForm.getByLabel(t('server_manager_credential')).fill('plex-e2e-token');
		await addForm.getByRole('button', { name: t('server_manager_test') }).click();
		await expect(manager.getByRole('status')).toContainText('Cinema B');

		const responsePromise = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === '/api/servers' &&
				response.request().method() === 'POST'
		);
		await addForm.getByRole('button', { name: t('server_manager_add_action') }).click();
		const response = await responsePromise;
		expect(response.status()).toBe(201);
		const result = await response.json();
		secondaryServerId = result.server.id;
		expect(secondaryServerId).toEqual(expect.any(String));
		recordSecondaryServer(secondaryServerId, 'Cinema B');
		await expect(
			manager.getByRole('status').filter({ hasText: t('server_manager_added') })
		).toBeVisible();

		const switcher = page.getByLabel(t('server_switcher_label'));
		const activation = page.waitForResponse((candidate) =>
			new URL(candidate.url()).pathname.endsWith(`/${secondaryServerId}/activate`)
		);
		await switcher.selectOption(secondaryServerId);
		await activation;
		await expect(switcher).toHaveValue(secondaryServerId);
	});

	test('syncs only the selected server and proves both library directions stay isolated', async ({
		page,
		scenario
	}) => {
		await gotoHydrated(page, '/');
		const jobId = await triggerJob(page, '/api/sync', () =>
			page.getByRole('button', { name: t('dashboard_sync') }).click()
		);
		await expectJobCompleted(page, jobId);

		await gotoHydrated(page, '/library');
		await expect(page.getByText('Aurora Archive')).toBeVisible();
		await expect(page.getByText('Alpha Dawn')).toHaveCount(0);

		const switcher = page.getByLabel(t('server_switcher_label'));
		const activation = page.waitForResponse((candidate) =>
			new URL(candidate.url()).pathname.endsWith(`/${scenario.primaryServerId}/activate`)
		);
		await switcher.selectOption(scenario.primaryServerId);
		await activation;
		await gotoHydrated(page, '/library');
		await expect(page.getByText('Alpha Dawn').first()).toBeVisible();
		await expect(page.getByText('Aurora Archive')).toHaveCount(0);

		await gotoHydrated(page, `/review?server=${encodeURIComponent(secondaryServerId)}`);
		await expect(page.getByText('Aurora Archive')).toBeVisible();
		await expect(page.getByText('Alpha Dawn')).toHaveCount(0);
		await expectNoHorizontalOverflow(page);
	});

	test('binds Kometa to the exact Plex instance, then previews and confirms structured and raw writes', async ({
		page,
		runtime
	}) => {
		const settings = await page.request.post('/api/settings', {
			data: {
				kometaServerInstanceId: secondaryServerId,
				kometaConfigPath: runtime.kometaConfigPath,
				kometaConfigMode: 'merge',
				kometaAssetsDir: runtime.kometaAssetsDirectory
			}
		});
		expect(settings.ok()).toBeTruthy();

		await gotoHydrated(page, '/kometa');
		await expect(
			page.getByRole('heading', { level: 1, name: t('kometa_manager_title') })
		).toBeVisible();
		await expect(page.getByText(t('kometa_bound_server', { name: 'Cinema B' }))).toBeVisible();
		await page.getByRole('button', { name: t('kometa_section_libraries') }).click();
		const movies = page.getByLabel(/Movies B/).first();
		if (!(await movies.isChecked())) await movies.check();
		await page.getByRole('button', { name: t('kometa_preview') }).click();
		await expect(page.getByRole('button', { name: t('kometa_confirm_sync') })).toBeEnabled();
		await expect(page.getByText(/libraries\.Movies B/).first()).toBeVisible();
		await page.getByRole('button', { name: t('kometa_confirm_sync') }).click();
		await expect(
			page
				.getByRole('status')
				.filter({ hasText: new RegExp(`${t('kometa_created')}|${t('kometa_synced')}`) })
		).toBeVisible();

		await page.getByRole('button', { name: t('kometa_section_raw') }).click();
		const editor = page.getByLabel(t('kometa_raw_editor_label'));
		await expect(editor).toHaveValue(/Movies B/, { timeout: 15_000 });
		const raw = await editor.inputValue();
		await editor.fill(`${raw.trimEnd()}\n\n# confirmed by browser E2E\n`);
		await page.getByRole('button', { name: t('kometa_raw_preview') }).click();
		await expect(page.getByRole('button', { name: t('kometa_raw_confirm') })).toBeVisible();
		await page.getByRole('button', { name: t('kometa_raw_confirm') }).click();
		await expect(page.getByText(t('kometa_raw_saved'))).toBeVisible();

		const written = readFileSync(runtime.kometaConfigPath, 'utf8');
		expect(written).toContain('Movies B');
		expect(written).not.toContain('Movies A');
		expect(written).toContain('# confirmed by browser E2E');
		await page.getByRole('button', { name: t('kometa_section_backups') }).click();
		await expect(
			page.getByRole('button', { name: t('kometa_restore_preview') }).first()
		).toBeVisible();
	});
});
