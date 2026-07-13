import {
	test,
	expect,
	gotoHydrated,
	triggerJob,
	expectJobCompleted,
	expectNoHorizontalOverflow
} from '../support/fixtures.mjs';
import { t } from '../support/i18n.mjs';

test.describe
	.serial('critical review, apply, FUN, automation, backup, and collection flows', () => {
	test('uses the review inbox, context navigation, and browser-enforced match validation', async ({
		page
	}) => {
		await gotoHydrated(page, '/review');
		await expect(page.getByRole('heading', { level: 1, name: t('review_title') })).toBeVisible();
		const alpha = page.getByRole('article', { name: /Alpha Dawn/ });
		await expect(alpha).toContainText(t('review_state_suggestion_ready'));
		await alpha.getByRole('button', { name: t('review_stage_suggestion') }).click();
		await expect(alpha).toContainText(t('review_state_staged'));
		await alpha.getByRole('link', { name: t('review_open_item') }).click();

		await expect(page.getByRole('heading', { level: 1, name: 'Alpha Dawn' })).toBeVisible();
		await expect(page.getByRole('navigation', { name: t('review_item_navigation') })).toBeVisible();
		await page.getByRole('button', { name: t('manual_match_replace') }).click();
		const year = page.getByLabel(t('manual_match_year'));
		await year.fill('1700');
		expect(await year.evaluate((input) => input.validity.rangeUnderflow)).toBe(true);
		await page.getByRole('button', { name: t('manual_match_search') }).click();
		expect(await year.evaluate((input) => input.validationMessage.length)).toBeGreaterThan(0);
		await page.getByRole('button', { name: t('manual_match_close') }).click();

		await page.getByRole('link', { name: new RegExp(t('review_next_item')) }).click();
		await expect(page.getByRole('heading', { level: 1, name: 'Bravo Night' })).toBeVisible();
		await page.getByRole('link', { name: new RegExp(t('review_previous_item')) }).click();
		await expect(page.getByRole('heading', { level: 1, name: 'Alpha Dawn' })).toBeVisible();
		await expectNoHorizontalOverflow(page);
	});

	test('clears a real manual TMDB pin and records the resolution audit', async ({
		page,
		scenario
	}) => {
		await gotoHydrated(page, `/item/${scenario.primaryItems.delta}`);
		await expect(
			page.getByText(
				t('manual_match_current_manual', {
					type: t('manual_match_type_show'),
					id: '72001'
				})
			)
		).toBeVisible();

		await page.getByRole('button', { name: t('manual_match_replace') }).click();
		await page.getByRole('button', { name: t('manual_match_clear') }).click();
		await page.getByRole('button', { name: t('manual_match_clear_confirm') }).click();
		await expect(
			page.getByRole('status').filter({ hasText: t('manual_match_cleared_eligible') })
		).toBeVisible();

		// Target the summary itself: the enclosing <details> normalizes to the same text
		// until the audit list renders, which made a plain text lookup ambiguous.
		await page
			.locator('summary')
			.filter({ hasText: t('manual_match_history') })
			.click();
		await expect(page.getByText(t('manual_match_audit_cleared'), { exact: true })).toBeVisible();
	});

	test('previews, confirms, verifies, and undoes the exact staged artwork', async ({
		page,
		scenario
	}) => {
		const itemId = scenario.primaryItems.alpha;
		await gotoHydrated(page, `/item/${itemId}?returnTo=%2Freview`);
		await page.getByLabel(t('library_apply_method_label')).selectOption('plex');
		await page.getByRole('button', { name: t('item_apply'), exact: true }).click();
		await expect(page.getByText(/Plan: 2 uploads · 0 Kometa exports · 0 skipped/)).toBeVisible();

		const jobId = await triggerJob(page, `/api/items/${itemId}/apply`, () =>
			page.getByRole('button', { name: t('library_apply_confirm_yes') }).click()
		);
		await expectJobCompleted(page, jobId);
		await expect(page.getByRole('status').filter({ hasText: t('item_msg_applied') })).toBeVisible();

		const undoButton = page.getByRole('button', { name: t('item_undo_item') }).first();
		await expect(undoButton).toBeVisible();
		await undoButton.click();
		const dialog = page.getByRole('alertdialog', { name: t('item_undo_dialog_title') });
		await expect(dialog).toContainText(t('item_undo_preview_label'));
		await expect(dialog.getByRole('button', { name: t('item_undo_cancel') })).toBeFocused();
		await dialog.getByRole('button', { name: t('item_undo_confirm') }).click();
		await expect(page.getByRole('status').filter({ hasText: t('item_undo_success') })).toBeVisible({
			timeout: 30_000
		});
	});

	test('exercises every FUN experiment without applying artwork automatically', async ({
		page
	}) => {
		await gotoHydrated(page, '/fun');
		await expect(
			page.getByRole('heading', { level: 2, name: t('fun_picker_title') })
		).toBeVisible();
		await page.getByLabel(t('fun_choice_count')).selectOption('3');
		await page.getByLabel(t('fun_mode_label')).selectOption('capsule');
		await page.getByRole('button', { name: t('fun_pick_button') }).click();
		await expect(page.getByText(t('fun_result_count', { count: 3 }))).toBeVisible();
		await page
			.getByRole('button', { name: t('fun_open_capsule') })
			.first()
			.click();
		await expect(page.getByRole('link', { name: t('fun_view_item') }).first()).toBeVisible();

		await page.getByRole('link', { name: t('fun_nav_match') }).click();
		await page.getByLabel(t('fun_match_item')).selectOption({ label: 'Alpha Dawn (2020)' });
		await page.getByRole('button', { name: t('fun_match_start') }).click();
		await page
			.getByRole('group', { name: t('fun_match_title') })
			.getByRole('button')
			.first()
			.click();
		await expect(
			page.getByRole('heading', { level: 3, name: t('fun_match_winner') })
		).toBeVisible();
		await page.getByRole('button', { name: t('fun_match_stage') }).click();
		await expect(page.getByRole('status').filter({ hasText: t('fun_match_staged') })).toBeVisible();

		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.getByRole('link', { name: t('fun_nav_gallery') }).click();
		await page.getByRole('button', { name: t('fun_gallery_start') }).click();
		const gallery = page.getByRole('dialog', { name: t('fun_gallery_title') });
		await expect(gallery).toBeVisible();
		await expect(gallery.getByRole('button', { name: t('fun_gallery_play') })).toBeVisible();
		await page.keyboard.press('ArrowRight');
		await gallery.getByRole('button', { name: t('whats_new_close') }).click();
		await expect(gallery).toBeHidden();

		await page.getByRole('link', { name: t('fun_nav_session') }).click();
		await page.getByLabel(t('fun_session_budget')).fill('240');
		await page.getByLabel(t('fun_session_films'), { exact: true }).selectOption('2');
		await page.getByRole('button', { name: t('fun_session_plan') }).click();
		await expect(page.getByText(t('fun_session_ready'))).toBeVisible();
	});

	test('creates a review-only event automation and exposes its one-time webhook token', async ({
		page
	}) => {
		await gotoHydrated(page, '/settings?tab=automation');
		await expect(
			page.getByRole('heading', { level: 2, name: t('automation_title') })
		).toBeVisible();
		await expect(page.getByText(t('automation_review_only_badge')).first()).toBeVisible();
		await page.getByRole('button', { name: t('automation_add') }).click();
		await page.getByLabel(t('automation_name')).fill('E2E review intake');
		await page.getByLabel(t('automation_trigger'), { exact: true }).selectOption('event');
		await page.getByLabel(t('automation_event_type'), { exact: true }).selectOption('new_items');
		await page.getByLabel(t('automation_action'), { exact: true }).selectOption('sync');
		await page.getByRole('button', { name: t('automation_save') }).click();
		await expect(
			page.getByRole('status').filter({ hasText: t('automation_created') })
		).toBeVisible();

		const schedule = page.getByRole('listitem').filter({ hasText: 'E2E review intake' });
		await expect(schedule).toContainText(t('automation_review_only_badge'));
		await schedule.getByRole('button', { name: t('automation_webhook_create') }).click();
		await expect(schedule.getByText(t('automation_webhook_once_title'))).toBeVisible();
		await expect(schedule.getByLabel(t('automation_webhook_token'))).not.toHaveValue('');
		await schedule.getByRole('button', { name: t('automation_disable'), exact: true }).click();
		await expect(
			page.getByRole('status').filter({ hasText: t('automation_toggled') })
		).toBeVisible();
	});

	test('creates, verifies, exports, and safety-previews an application backup', async ({
		page
	}) => {
		await gotoHydrated(page, '/settings?tab=backup');
		const backups = page.getByRole('region', { name: t('backup_title') });
		await backups.getByLabel(t('backup_retention_age')).fill('99');
		await backups.getByRole('button', { name: t('settings_save'), exact: true }).click();
		await expect(
			backups.getByRole('status').filter({ hasText: t('backup_policy_saved') })
		).toBeVisible();

		const clearedPolicyResponse = page.waitForResponse((response) => {
			const url = new URL(response.url());
			return url.pathname === '/api/backups/policy' && response.request().method() === 'PUT';
		});
		await backups.getByLabel(t('backup_retention_age')).fill('');
		await backups.getByRole('button', { name: t('settings_save'), exact: true }).click();
		const clearedPolicy = await clearedPolicyResponse;
		expect(clearedPolicy.ok()).toBeTruthy();
		expect(await clearedPolicy.json()).toMatchObject({ policy: { maxAgeDays: null } });

		await page.getByRole('button', { name: t('backup_create') }).click();
		await expect(page.getByRole('status').filter({ hasText: t('backup_created') })).toBeVisible({
			timeout: 30_000
		});
		const backup = page
			.getByRole('listitem')
			.filter({ hasText: t('backup_trigger_manual') })
			.first();
		await backup.getByRole('button', { name: new RegExp(t('backup_validate')) }).click();
		await expect(page.getByRole('status').filter({ hasText: t('backup_validated') })).toBeVisible();

		await backup.getByRole('button', { name: new RegExp(t('backup_export')) }).click();
		await expect(backup.getByText(t('backup_export_warning'))).toBeVisible();
		const downloadPromise = page.waitForEvent('download');
		await backup.getByRole('button', { name: new RegExp(t('backup_export_confirm')) }).click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toMatch(/^posterpilot-backup-.+\.tar$/);

		await backup.getByRole('button', { name: new RegExp(t('backup_restore_preview')) }).click();
		const preview = page.getByRole('heading', { name: t('backup_restore_preview_title') });
		await expect(preview).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText(t('backup_restore_confirmation_warning'))).toBeVisible();
		await page.getByRole('button', { name: t('review_cancel') }).click();
	});

	test('stages a shared collection family, confirms one coordinated job, and undoes the group', async ({
		page,
		scenario
	}) => {
		await gotoHydrated(page, '/collections');
		await expect(
			page.getByRole('heading', { level: 1, name: t('collections_title') })
		).toBeVisible();
		await page.getByRole('link', { name: /E2E Saga/ }).click();
		await expect(page.getByRole('heading', { level: 1, name: 'E2E Saga' })).toBeVisible();
		await expect(page.getByText(/3 of 3 local members/).first()).toBeVisible();
		await expect(
			page.getByRole('heading', { name: t('collection_unavailable_members') })
		).toBeVisible();
		const unavailable = page.getByRole('listitem').filter({ hasText: 'Unavailable Chapter' });
		await expect(unavailable).toContainText(t('collection_member_unavailable'));
		await page
			.getByRole('button', { name: t('collection_suggestion_stage') })
			.first()
			.click();
		await expect(
			page.getByRole('status').filter({ hasText: /Staged \d+ slots across 3 members/ })
		).toBeVisible();

		await page.getByLabel(t('collection_apply_destination')).selectOption('server');
		await page.getByRole('button', { name: t('collection_apply_preview') }).click();
		await expect(
			page.getByRole('heading', { name: t('collection_apply_preview_title') })
		).toBeVisible();
		const endpoint = `/api/collections/${scenario.primaryCollectionId}/apply`;
		const jobId = await triggerJob(page, endpoint, () =>
			page.getByRole('button', { name: t('collection_apply_confirm') }).click()
		);
		await expectJobCompleted(page, jobId);

		const history = page
			.getByRole('heading', { name: t('collection_history_title') })
			.locator('..');
		await expect(
			page.getByRole('button', { name: t('collection_undo_group') }).first()
		).toBeVisible();
		await page
			.getByRole('button', { name: t('collection_undo_group') })
			.first()
			.click();
		const dialog = page.getByRole('alertdialog', { name: t('item_undo_dialog_title') });
		await dialog.getByRole('button', { name: t('item_undo_confirm') }).click();
		await expect(
			page.getByRole('status').filter({ hasText: /Restored \d+ collection artwork slots/ })
		).toBeVisible({ timeout: 30_000 });
		await expect(history).toBeVisible();
	});
});
