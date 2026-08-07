import {
	test,
	expect,
	gotoHydrated,
	triggerJob,
	expectJobCompleted,
	expectNoHorizontalOverflow
} from '../support/fixtures.mjs';
import { t } from '../support/i18n.mjs';
import { createClient } from '@libsql/client';

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

	test('reuses manual TMDB search with the current title, optional year, and handled failures', async ({
		page,
		scenario
	}) => {
		const searches = [];
		await page.route(
			(url) => url.pathname.endsWith('/tmdb/search'),
			async (route) => {
				const url = new URL(route.request().url());
				const request = {
					query: url.searchParams.get('q'),
					year: url.searchParams.get('year'),
					type: url.searchParams.get('type')
				};
				searches.push(request);

				if (request.query === 'Network Failure') {
					await route.abort('failed');
					return;
				}
				if (request.query === 'No Results') {
					await route.fulfill({ json: { results: [] } });
					return;
				}

				await route.fulfill({
					json: {
						results: [
							{
								tmdbId: String(80000 + searches.length),
								mediaType: request.type === 'tv' ? 'tv' : 'movie',
								title: `${request.query} result`,
								originalTitle: null,
								year: request.year === null ? null : Number(request.year),
								overview: null,
								posterUrl: null
							}
						]
					}
				});
			}
		);

		await gotoHydrated(page, `/item/${scenario.primaryItems.alpha}`);
		await page.getByRole('button', { name: t('manual_match_replace') }).click();
		const title = page.getByLabel(t('manual_match_query'), { exact: true });
		const year = page.getByLabel(t('manual_match_year'), { exact: true });
		const type = page.getByLabel(t('manual_match_media_type'), { exact: true });
		const submit = page.getByRole('button', { name: t('manual_match_search') });

		async function submitSearch(expected) {
			const previousCount = searches.length;
			await submit.click();
			await expect.poll(() => searches.length).toBe(previousCount + 1);
			expect(searches.at(-1)).toEqual(expected);
		}

		await title.fill('Changed Title');
		await year.fill('2024');
		await type.selectOption('tv');
		await submitSearch({ query: 'Changed Title', year: '2024', type: 'tv' });
		await expect(page.getByRole('list', { name: t('manual_match_results') })).toContainText(
			'Changed Title result'
		);

		await title.fill('Alpha Dawn');
		await year.fill('2020');
		await type.selectOption('movie');
		await submitSearch({ query: 'Alpha Dawn', year: '2020', type: 'movie' });
		await year.fill('');
		await submitSearch({ query: 'Alpha Dawn', year: null, type: 'movie' });
		await submitSearch({ query: 'Alpha Dawn', year: null, type: 'movie' });

		await year.fill('1700');
		const requestsBeforeInvalidSearch = searches.length;
		await year.locator('xpath=ancestor::form').dispatchEvent('submit');
		await expect(page.getByRole('alert')).toContainText(t('manual_match_error_invalid'));
		expect(searches).toHaveLength(requestsBeforeInvalidSearch);

		await year.fill('2021');
		await submitSearch({ query: 'Alpha Dawn', year: '2021', type: 'movie' });
		await expect(page.getByRole('alert')).toBeHidden();

		await title.fill('No Results');
		await year.fill('');
		await submitSearch({ query: 'No Results', year: null, type: 'movie' });
		await expect(
			page.getByRole('status').filter({ hasText: t('manual_match_empty') })
		).toBeVisible();

		await title.fill('Network Failure');
		await submitSearch({ query: 'Network Failure', year: null, type: 'movie' });
		await expect(page.getByRole('alert')).toContainText(t('manual_match_error_unavailable'));

		await title.fill('Recovered');
		await year.fill('2022');
		await submitSearch({ query: 'Recovered', year: '2022', type: 'movie' });
		await expect(page.getByRole('list', { name: t('manual_match_results') })).toContainText(
			'Recovered result'
		);
		await expect(
			page.getByText(
				t('manual_match_current_automatic', {
					type: t('manual_match_type_movie'),
					id: '71001'
				})
			)
		).toBeVisible();
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

	test('applies a warning-free exact plan in one click, verifies it, and undoes it', async ({
		page,
		runtime,
		scenario
	}) => {
		const itemId = scenario.primaryItems.alpha;
		const endpoint = `/api/items/${itemId}/apply`;
		const artwork = {
			poster: {
				server: `${runtime.fakeJellyfinUrl}/Items/jf-alpha/Images/Primary`,
				canonical: `${runtime.fakeMediuxUrl}/jf-alpha-poster-primary-original.png`,
				preview: `${runtime.fakeMediuxUrl}/jf-alpha-poster-primary-preview.png`
			},
			background: {
				server: `${runtime.fakeJellyfinUrl}/Items/jf-alpha/Images/Backdrop`,
				canonical: `${runtime.fakeMediuxUrl}/jf-alpha-background-primary-original.png`,
				preview: `${runtime.fakeMediuxUrl}/jf-alpha-background-primary-preview.png`
			}
		};
		const imageBytes = async (url) => {
			const response = await fetch(url);
			expect(response.ok, `image request ${url}`).toBeTruthy();
			return Buffer.from(await response.arrayBuffer()).toString('base64');
		};
		const canonicalUrls = Object.values(artwork)
			.map((slot) => slot.canonical)
			.sort();
		const beforeApply = {
			poster: await imageBytes(artwork.poster.server),
			background: await imageBytes(artwork.background.server)
		};
		const fixtureAssetUrl = (url) =>
			url.replace(`${runtime.fakeMediuxUrl}/`, `${runtime.fakeJellyfinUrl}/assets/`);
		const canonicalBytes = {
			poster: await imageBytes(fixtureAssetUrl(artwork.poster.canonical)),
			background: await imageBytes(fixtureAssetUrl(artwork.background.canonical))
		};
		expect(canonicalBytes.poster).not.toBe(
			await imageBytes(fixtureAssetUrl(artwork.poster.preview))
		);
		expect(canonicalBytes.background).not.toBe(
			await imageBytes(fixtureAssetUrl(artwork.background.preview))
		);
		await gotoHydrated(page, `/item/${itemId}?returnTo=%2Freview`);
		await page.getByLabel(t('library_apply_method_label')).selectOption('plex');
		await expect(
			page.locator('img[src*="jf-alpha-poster-primary-preview.png"]').first()
		).toBeVisible();
		await expect(
			page.locator('img[src*="jf-alpha-background-primary-preview.png"]').first()
		).toBeVisible();
		expect(await page.locator('img[src*="jf-alpha-poster-primary-original.png"]').count()).toBe(0);
		expect(await page.locator('img[src*="jf-alpha-background-primary-original.png"]').count()).toBe(
			0
		);

		const previewResponsePromise = page.waitForResponse((response) => {
			const url = new URL(response.url());
			return (
				url.pathname === endpoint &&
				response.request().method() === 'POST' &&
				response.request().postDataJSON()?.method === 'plex'
			);
		});
		const jobResponsePromise = page.waitForResponse((response) => {
			const url = new URL(response.url());
			const body = response.request().postDataJSON();
			return (
				url.pathname === endpoint &&
				response.request().method() === 'POST' &&
				typeof body?.planId === 'string' &&
				typeof body?.digest === 'string'
			);
		});
		await page.getByRole('button', { name: t('item_apply'), exact: true }).click();
		const previewResponse = await previewResponsePromise;
		expect(previewResponse.ok()).toBeTruthy();
		const preview = await previewResponse.json();
		expect(preview).toMatchObject({
			summary: { destinations: { server: 2, kometa: 0 }, skipCount: 0 }
		});
		const plannedUrls = preview.items
			.flatMap((item) => item.operations)
			.map((operation) => operation.selection.url)
			.sort();
		expect(plannedUrls).toEqual(canonicalUrls);
		expect(plannedUrls.some((url) => url.includes('-preview.png'))).toBe(false);
		const jobResponse = await jobResponsePromise;
		expect(jobResponse.ok()).toBeTruthy();
		const { jobId } = await jobResponse.json();
		expect(jobId).toEqual(expect.any(Number));
		await expectJobCompleted(page, jobId);
		await expect(page.getByRole('status').filter({ hasText: t('item_msg_applied') })).toBeVisible();
		expect(await imageBytes(artwork.poster.server)).toBe(canonicalBytes.poster);
		expect(await imageBytes(artwork.background.server)).toBe(canonicalBytes.background);

		const client = createClient({ url: `file:${runtime.databaseFile}` });
		try {
			const applied = await client.execute({
				sql: `select url from applied_posters
				 where server_instance_id = ? and media_item_id = ? and status = 'success'
				 order by id desc limit 2`,
				args: [scenario.primaryServerId, itemId]
			});
			expect(applied.rows.map((row) => String(row.url)).sort()).toEqual(canonicalUrls);
		} finally {
			client.close();
		}

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
		expect(await imageBytes(artwork.poster.server)).toBe(beforeApply.poster);
		expect(await imageBytes(artwork.background.server)).toBe(beforeApply.background);
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

	test('shows durable TMDB normalization and removes it only when the server-scoped count is zero', async ({
		page,
		runtime,
		scenario
	}) => {
		const client = createClient({ url: `file:${runtime.databaseFile}` });
		const now = Math.floor(Date.now() / 1000);
		let legacyId;
		let alphaLastSynced;
		let priorRepairJobId;
		const seededJobIds = [];
		try {
			const alpha = await client.execute({
				sql: 'select last_synced_at from media_items where id = ? and server_instance_id = ?',
				args: [scenario.primaryItems.alpha, scenario.primaryServerId]
			});
			alphaLastSynced = alpha.rows[0]?.last_synced_at ?? null;
			const inserted = await client.execute({
				sql: `insert into media_items (
				 server_instance_id, rating_key, section_key, type, title, tmdb_id, media_type,
				 resolved, manual_match_pinned, last_synced_at, updated_at
				) values (?, 'e2e-legacy-removed', 'lib-shows-a', 'show',
				 'Legacy Removed Show', '99991', 'movie', 1, 0, ?, ?)
				returning id`,
				args: [scenario.primaryServerId, now, now]
			});
			legacyId = Number(inserted.rows[0].id);
			const priorRepair = await client.execute({
				sql: `insert into jobs (
				 server_instance_id, type, status, payload, result, attempt,
				 processed, total, created_at, finished_at, updated_at
				) values (?, 'tmdb_repair', 'completed', ?, ?, 1, 1, 1, ?, ?, ?)
				returning id`,
				args: [
					scenario.primaryServerId,
					JSON.stringify({ kind: 'tmdb_repair', serverInstanceId: scenario.primaryServerId }),
					JSON.stringify({
						summary: { processed: 1, succeeded: 1, failed: 0 },
						tmdbRepair: { pendingBefore: 1, pendingAfter: 0 }
					}),
					now - 20,
					now - 20,
					now - 20
				]
			});
			priorRepairJobId = Number(priorRepair.rows[0].id);
			seededJobIds.push(priorRepairJobId);
			for (let index = 0; index < 9; index += 1) {
				const newer = await client.execute({
					sql: `insert into jobs (
					 server_instance_id, type, status, payload, result, attempt,
					 processed, total, created_at, finished_at, updated_at
					) values (?, 'sync', 'completed', ?, ?, 1, 1, 1, ?, ?, ?)
					returning id`,
					args: [
						scenario.primaryServerId,
						JSON.stringify({ kind: 'sync', serverInstanceId: scenario.primaryServerId }),
						JSON.stringify({ summary: { processed: 1, succeeded: 1, failed: 0 } }),
						now - 10 + index,
						now - 10 + index,
						now - 10 + index
					]
				});
				seededJobIds.push(Number(newer.rows[0].id));
			}

			await gotoHydrated(page, '/library');
			const banner = page.getByTestId('tmdb-repair-banner');
			await expect(banner).toContainText(t('tmdb_repair_banner_pending', { count: 1 }));
			const jobLink = banner.getByRole('link', {
				name: t('tmdb_repair_banner_job', { id: priorRepairJobId })
			});
			await expect(jobLink).toHaveAttribute(
				'href',
				`/?job=${priorRepairJobId}#job-${priorRepairJobId}`
			);
			await jobLink.click();
			await expect(page).toHaveURL(
				new RegExp(`/\\?job=${priorRepairJobId}#job-${priorRepairJobId}$`, 'u')
			);
			await expect(page.locator(`#job-${priorRepairJobId}`)).toHaveCount(1);
			await expect(page.locator(`#job-row-details-${priorRepairJobId}`)).toBeVisible();

			await gotoHydrated(page, '/library');
			const jobId = await triggerJob(page, '/api/tmdb-repair', () =>
				page
					.getByTestId('tmdb-repair-banner')
					.getByRole('button', { name: t('tmdb_repair_banner_action') })
					.click()
			);
			const stream = await page.request.get(`/api/jobs/${jobId}/stream`, { timeout: 60_000 });
			expect(stream.ok()).toBeTruthy();
			const snapshots = (await stream.text())
				.split('\n')
				.filter((line) => line.startsWith('data: '))
				.map((line) => JSON.parse(line.slice(6)));
			expect(snapshots.at(-1)).toMatchObject({ jobId, type: 'tmdb_repair', status: 'completed' });
			await expect(banner).toBeHidden({ timeout: 15_000 });

			const [legacy, alphaAfter] = await Promise.all([
				client.execute({
					sql: 'select source_removed_at from media_items where id = ?',
					args: [legacyId]
				}),
				client.execute({
					sql: 'select last_synced_at from media_items where id = ?',
					args: [scenario.primaryItems.alpha]
				})
			]);
			expect(legacy.rows[0].source_removed_at).not.toBeNull();
			expect(alphaAfter.rows[0].last_synced_at ?? null).toBe(alphaLastSynced);
		} finally {
			if (seededJobIds.length) {
				await client.execute({
					sql: `delete from jobs where id in (${seededJobIds.map(() => '?').join(', ')})`,
					args: seededJobIds
				});
			}
			if (legacyId) {
				await client.execute({ sql: 'delete from media_items where id = ?', args: [legacyId] });
			}
			client.close();
		}
	});
});
