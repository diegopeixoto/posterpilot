import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { parse } from 'yaml';
import {
	test,
	expect,
	gotoHydrated,
	reloadHydrated,
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

	test('reveals large migration previews in bounded batches', async ({ page, runtime }) => {
		const client = createClient({ url: `file:${runtime.databaseFile}` });
		try {
			await client.execute({
				sql: `insert into settings(key, value) values (?, ?)
				 on conflict(key) do update set value = excluded.value`,
				args: [
					`cachedLibraries:${secondaryServerId}`,
					JSON.stringify([{ key: 'plex-movies-b', title: 'Movies B', type: 'movie' }])
				]
			});
		} finally {
			client.close();
		}

		mkdirSync(runtime.kometaDirectory, { recursive: true });
		const legacyPath = join(runtime.kometaDirectory, 'posterpilot.yml');
		const moviePath = join(runtime.kometaDirectory, 'posterpilot-movies.yml');
		const showPath = join(runtime.kometaDirectory, 'posterpilot-shows.yml');
		const ambiguousKeys = Array.from({ length: 31 }, (_, index) => String(930_001 + index));
		const legacyMetadata = `metadata:\n${ambiguousKeys
			.map((key) => `  ${key}:\n    url_poster: https://assets.invalid/disclosure-${key}.jpg\n`)
			.join('')}`;
		const legacyConfig = `libraries:
  Movies B:
    metadata_files:
      - file: config/posterpilot.yml
`;
		rmSync(moviePath, { force: true });
		rmSync(showPath, { force: true });
		writeFileSync(legacyPath, legacyMetadata, { mode: 0o600 });
		writeFileSync(runtime.kometaConfigPath, legacyConfig, { mode: 0o600 });

		const settings = await page.request.post('/api/settings', {
			data: {
				kometaServerInstanceId: secondaryServerId,
				kometaConfigPath: runtime.kometaConfigPath,
				kometaConfigMode: 'own',
				kometaAssetsDir: runtime.kometaAssetsDirectory,
				kometaMetadataPathPrefix: 'config'
			}
		});
		expect(settings.ok()).toBeTruthy();

		try {
			await gotoHydrated(page, '/kometa');
			const prefixInput = page.getByLabel(t('kometa_metadata_path'));
			const header = page.locator('.surface').filter({ has: prefixInput }).first();
			const saveHeaderButton = header.getByRole('button', {
				name: t('settings_save'),
				exact: true
			});
			await prefixInput.fill('config-e2e');
			await page.route(
				'**/api/settings',
				(route) =>
					route.fulfill({
						status: 500,
						contentType: 'application/json',
						body: JSON.stringify({ error: { code: 'e2e_settings_failure' } })
					}),
				{ times: 1 }
			);
			await expect(
				page.getByRole('status').filter({ hasText: t('kometa_save_header_first') })
			).toHaveCount(1);
			await saveHeaderButton.click();
			await expect(header.getByRole('alert')).toContainText(t('settings_save_failed'));
			await prefixInput.fill('/config');
			await expect(prefixInput).toHaveAttribute('aria-invalid', 'true');
			await expect(page.locator('#metadataPathPrefixFeedback')).toContainText(
				t('kometa_metadata_path_error_absolute')
			);
			await expect(header.getByText(t('settings_save_failed'), { exact: true })).toHaveCount(0);
			await expect(header.getByRole('alert')).toHaveCount(1);
			await expect(saveHeaderButton).toBeDisabled();
			await prefixInput.fill('config');
			await expect(prefixInput).toHaveAttribute('aria-invalid', 'false');
			await expect(header.getByRole('alert')).toHaveCount(0);
			await expect(page.locator('#metadataPathPrefixFeedback')).toContainText(
				'config/posterpilot-movies.yml'
			);

			const migration = page.getByTestId('kometa-migration-panel');
			const previewResponsePromise = page.waitForResponse(
				(response) =>
					new URL(response.url()).pathname === '/api/kometa/migration/preview' &&
					response.request().method() === 'POST'
			);
			await migration.getByRole('button', { name: t('kometa_migration_preview_action') }).click();
			const previewResponse = await previewResponsePromise;
			expect(previewResponse.ok()).toBeTruthy();
			const preview = await previewResponse.json();
			expect(preview.display.classified).toHaveLength(0);
			expect(preview.display.ambiguous).toHaveLength(31);

			const ambiguousRows = migration.locator('#kometa-migration-ambiguous-list > li');
			await expect(ambiguousRows).toHaveCount(30);
			await expect(migration).toContainText(
				t('kometa_migration_disclosure_count', { shown: 30, total: 31, remaining: 1 })
			);
			const loadMore = migration.getByRole('button', {
				name: t('kometa_migration_load_more', { count: 1, remaining: 1 })
			});
			await loadMore.click();
			await expect(ambiguousRows).toHaveCount(31);
			await expect(migration).toContainText(
				t('kometa_migration_disclosure_announcement', { shown: 31, total: 31 })
			);
			const allShown = migration.getByRole('button', {
				name: t('kometa_migration_all_entries_shown', { total: 31 })
			});
			await expect(allShown).toBeDisabled();

			await migration.getByRole('button', { name: t('kometa_migration_cancel_preview') }).click();
			await expect(migration.getByText(t('kometa_migration_preview_title'))).toHaveCount(0);
			await expect(
				migration.getByText(t('kometa_migration_cancelled_notice'), { exact: true })
			).toHaveCount(1);
		} finally {
			rmSync(moviePath, { force: true });
			rmSync(showPath, { force: true });
		}
	});

	test('keeps operator config untouched during manual migration and requires acknowledgment', async ({
		page,
		runtime
	}) => {
		const client = createClient({ url: `file:${runtime.databaseFile}` });
		try {
			await client.execute({
				sql: `update media_items set
				 tmdb_id = '71001', tvdb_id = null, imdb_id = 'tt071001',
				 type = 'movie', media_type = 'movie', resolved = 1, source_removed_at = null
				 where rating_key = 'plex-aurora' and server_instance_id = ?`,
				args: [secondaryServerId]
			});
			await client.execute({
				sql: `insert into settings(key, value) values (?, ?)
				 on conflict(key) do update set value = excluded.value`,
				args: [
					`cachedLibraries:${secondaryServerId}`,
					JSON.stringify([{ key: 'plex-movies-b', title: 'Movies B', type: 'movie' }])
				]
			});
		} finally {
			client.close();
		}

		mkdirSync(runtime.kometaDirectory, { recursive: true });
		const legacyPath = join(runtime.kometaDirectory, 'posterpilot.yml');
		const moviePath = join(runtime.kometaDirectory, 'posterpilot-movies.yml');
		const showPath = join(runtime.kometaDirectory, 'posterpilot-shows.yml');
		const legacyMetadata = `metadata:\n  71001:\n    url_poster: https://assets.invalid/manual-movie.jpg\n`;
		const operatorConfig = `# operator-owned config must stay byte-identical
settings:
  cache: true
libraries:
  Movies B:
    metadata_files:
      - file: config/posterpilot.yml
      - file: config/operator-movies.yml
  Archive:
    metadata_files:
      - file: config/archive.yml
`;
		const manuallyWiredConfig = operatorConfig.replace(
			'file: config/posterpilot.yml',
			'file: config/posterpilot-movies.yml'
		);
		rmSync(moviePath, { force: true });
		rmSync(showPath, { force: true });
		writeFileSync(legacyPath, legacyMetadata, { mode: 0o600 });
		writeFileSync(runtime.kometaConfigPath, operatorConfig, { mode: 0o600 });

		const settings = await page.request.post('/api/settings', {
			data: {
				kometaServerInstanceId: secondaryServerId,
				kometaConfigPath: runtime.kometaConfigPath,
				kometaConfigMode: 'merge',
				kometaAssetsDir: runtime.kometaAssetsDirectory,
				kometaMetadataPathPrefix: 'config'
			}
		});
		expect(settings.ok()).toBeTruthy();

		try {
			await gotoHydrated(page, '/kometa');
			const migration = page.getByTestId('kometa-migration-panel');
			const previewResponsePromise = page.waitForResponse(
				(response) =>
					new URL(response.url()).pathname === '/api/kometa/migration/preview' &&
					response.request().method() === 'POST'
			);
			await migration.getByRole('button', { name: t('kometa_migration_preview_action') }).click();
			const previewResponse = await previewResponsePromise;
			expect(previewResponse.ok()).toBeTruthy();
			const preview = await previewResponse.json();
			expect(preview).toMatchObject({
				activation: 'manual',
				manualSnippetFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/)
			});
			expect(preview.manualSnippet).toContain('Movies B');
			expect(preview.manualSnippet).toContain('file: config/posterpilot-movies.yml');
			expect(preview.manualSnippet).not.toContain('operator-movies.yml');
			expect(preview.manualSnippet).not.toContain('Archive');
			await expect(migration).toContainText(t('kometa_migration_manual_preview_title'));
			await expect(migration).toContainText(t('kometa_migration_manual_preview_hint'));
			await expect(migration).toContainText('file: config/posterpilot-movies.yml');

			const confirmationResponsePromise = page.waitForResponse(
				(response) =>
					new URL(response.url()).pathname === '/api/kometa/migration/confirm' &&
					response.request().method() === 'POST'
			);
			await migration.getByRole('button', { name: t('kometa_migration_confirm_action') }).click();
			const confirmationResponse = await confirmationResponsePromise;
			expect(confirmationResponse.ok()).toBeTruthy();
			expect(await confirmationResponse.json()).toMatchObject({
				status: 'awaiting_manual_wiring',
				activation: 'manual',
				requiresAcknowledgment: true,
				canRollback: false
			});
			expect(readFileSync(runtime.kometaConfigPath, 'utf8')).toBe(operatorConfig);
			expect(readFileSync(legacyPath, 'utf8')).toBe(legacyMetadata);
			expect(readFileSync(moviePath, 'utf8')).toContain('https://assets.invalid/manual-movie.jpg');
			expect(readFileSync(showPath, 'utf8')).toBe('metadata: {}\n');

			await reloadHydrated(page);
			const durableMigration = page.getByTestId('kometa-migration-panel');
			await expect(durableMigration).toContainText(t('kometa_migration_status_awaiting_manual'));
			await expect(durableMigration).toContainText(t('kometa_migration_manual_hint'));
			await expect(durableMigration).toContainText(t('kometa_migration_manual_not_verified'));
			const acknowledgeButton = durableMigration.getByRole('button', {
				name: t('kometa_migration_acknowledge_action')
			});
			await expect(acknowledgeButton).toBeDisabled();

			writeFileSync(runtime.kometaConfigPath, manuallyWiredConfig, { mode: 0o600 });
			await durableMigration.getByLabel(t('kometa_migration_manual_acknowledge')).check();
			await expect(acknowledgeButton).toBeEnabled();
			const acknowledgmentResponsePromise = page.waitForResponse(
				(response) =>
					new URL(response.url()).pathname === '/api/kometa/migration/acknowledge' &&
					response.request().method() === 'POST'
			);
			await acknowledgeButton.click();
			const acknowledgmentResponse = await acknowledgmentResponsePromise;
			expect(acknowledgmentResponse.ok()).toBeTruthy();
			expect(await acknowledgmentResponse.json()).toMatchObject({
				status: 'completed',
				activation: 'manual',
				requiresAcknowledgment: false
			});
			await expect(durableMigration).toContainText(t('kometa_migration_status_completed'));
			expect(readFileSync(runtime.kometaConfigPath, 'utf8')).toBe(manuallyWiredConfig);
			expect(readFileSync(runtime.kometaConfigPath, 'utf8')).toContain(
				'file: config/operator-movies.yml'
			);
			expect(readFileSync(runtime.kometaConfigPath, 'utf8')).toContain('file: config/archive.yml');
			expect(readFileSync(legacyPath, 'utf8')).toBe(legacyMetadata);
		} finally {
			const cleanupClient = createClient({ url: `file:${runtime.databaseFile}` });
			try {
				// This serial file exercises a different config ownership mode next. Remove only
				// this scenario's durable journal from the throwaway database so its frozen scope
				// cannot leak into the independent managed-activation scenario.
				await cleanupClient.execute({
					sql: 'delete from settings where key = ?',
					args: [`kometaMigrationJournal:${secondaryServerId}`]
				});
			} finally {
				cleanupClient.close();
			}
			rmSync(moviePath, { force: true });
			rmSync(showPath, { force: true });
		}
	});

	test('previews, confirms, and rolls back the recoverable Kometa split migration', async ({
		page,
		runtime,
		scenario
	}) => {
		const client = createClient({ url: `file:${runtime.databaseFile}` });
		try {
			// Give the bound Plex instance deterministic movie/show mappings so this fixture
			// proves both direct movie classification and show TMDB -> TVDB re-keying. The
			// fake server exposes one library, so its persisted library cache is expanded
			// externally for this throwaway database. An opposite-type mapping on the other
			// server makes an accidental cross-server evidence query fail as ambiguous.
			await client.execute({
				sql: `update media_items set
				 tmdb_id = '71001', tvdb_id = null, imdb_id = 'tt071001',
				 type = 'movie', media_type = 'movie', resolved = 1, source_removed_at = null
				 where rating_key = 'plex-aurora' and server_instance_id = ?`,
				args: [secondaryServerId]
			});
			await client.execute({
				sql: `update media_items set
				 tmdb_id = '72001', tvdb_id = '82001', imdb_id = 'tt072001',
				 type = 'show', media_type = 'tv', resolved = 1, source_removed_at = null
				 where rating_key = 'plex-borealis' and server_instance_id = ?`,
				args: [secondaryServerId]
			});
			await client.execute({
				sql: `update media_items set
				 tmdb_id = '71001', tvdb_id = '91001', imdb_id = null,
				 type = 'show', media_type = 'tv', resolved = 1, source_removed_at = null
				 where id = ? and server_instance_id = ?`,
				args: [scenario.primaryItems.delta, scenario.primaryServerId]
			});
			await client.execute({
				sql: `insert into settings(key, value) values (?, ?)
				 on conflict(key) do update set value = excluded.value`,
				args: [
					`cachedLibraries:${secondaryServerId}`,
					JSON.stringify([
						{ key: 'plex-movies-b', title: 'Movies B', type: 'movie' },
						{ key: 'plex-shows-b', title: 'Shows B', type: 'show' }
					])
				]
			});
		} finally {
			client.close();
		}

		mkdirSync(runtime.kometaDirectory, { recursive: true });
		const legacyPath = join(runtime.kometaDirectory, 'posterpilot.yml');
		const moviePath = join(runtime.kometaDirectory, 'posterpilot-movies.yml');
		const showPath = join(runtime.kometaDirectory, 'posterpilot-shows.yml');
		const moviePosterUrl = 'https://assets.invalid/movie-poster.jpg';
		const movieBackgroundUrl = 'https://assets.invalid/movie-background.jpg';
		const showPosterUrl = 'https://assets.invalid/show-poster.jpg';
		const ambiguousPosterUrl = 'https://assets.invalid/ambiguous-poster.jpg';
		const legacyMetadata = `# preserved legacy metadata\nmetadata:\n  71001:\n    sort_title: Alpha custom order\n    url_poster: ${moviePosterUrl}\n    url_background: ${movieBackgroundUrl}\n  72001:\n    url_poster: ${showPosterUrl}\n  999999:\n    url_poster: ${ambiguousPosterUrl}\n`;
		const legacyConfig = `# keep this operator note\nsettings:\n  cache: true\nlibraries:\n  Movies B:\n    metadata_files:\n      - file: config/posterpilot.yml\n      - file: config/user-movies.yml\n  Shows B:\n    metadata_files:\n      - file: config/posterpilot.yml\n      - file: config/user-shows.yml\n`;
		writeFileSync(legacyPath, legacyMetadata, { mode: 0o600 });
		writeFileSync(runtime.kometaConfigPath, legacyConfig, { mode: 0o600 });

		const settings = await page.request.post('/api/settings', {
			data: {
				kometaServerInstanceId: secondaryServerId,
				kometaConfigPath: runtime.kometaConfigPath,
				kometaConfigMode: 'own',
				kometaAssetsDir: runtime.kometaAssetsDirectory,
				kometaMetadataPathPrefix: 'config'
			}
		});
		expect(settings.ok()).toBeTruthy();

		await gotoHydrated(page, '/kometa');
		const migration = page.getByTestId('kometa-migration-panel');
		await expect(migration).toContainText(t('kometa_migration_required_title'));
		const previewButton = migration.getByRole('button', {
			name: t('kometa_migration_preview_action')
		});
		const firstPreviewResponse = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === '/api/kometa/migration/preview' &&
				response.request().method() === 'POST'
		);
		await previewButton.click();
		const previewResponse = await firstPreviewResponse;
		expect(previewResponse.ok()).toBeTruthy();
		const preview = await previewResponse.json();
		expect(preview.activation).toBe('managed');
		expect(preview.display.classified).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					legacyKey: '71001',
					evidence: 'mapping',
					destination: expect.objectContaining({
						mediaKind: 'movie',
						namespace: 'tmdb',
						mappingId: '71001',
						filename: 'posterpilot-movies.yml'
					})
				}),
				expect.objectContaining({
					legacyKey: '72001',
					evidence: 'mapping',
					destination: expect.objectContaining({
						mediaKind: 'show',
						namespace: 'tvdb',
						mappingId: '82001',
						filename: 'posterpilot-shows.yml'
					})
				})
			])
		);
		expect(preview.display.ambiguous).toEqual([
			expect.objectContaining({ legacyKey: '999999', reason: 'no_authoritative_mapping' })
		]);
		expect(preview.display.libraries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					library: 'Movies B',
					mediaKind: 'movie',
					after: 'config/posterpilot-movies.yml'
				}),
				expect.objectContaining({
					library: 'Shows B',
					mediaKind: 'show',
					after: 'config/posterpilot-shows.yml'
				})
			])
		);
		expect(preview.display.files.movie).toMatchObject({
			filename: 'posterpilot-movies.yml',
			configReference: 'config/posterpilot-movies.yml',
			added: 1,
			unchanged: 0
		});
		expect(preview.display.files.movie.changes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ operation: 'add', targetMappingId: '71001' })
			])
		);
		expect(preview.display.files.show).toMatchObject({
			filename: 'posterpilot-shows.yml',
			configReference: 'config/posterpilot-shows.yml',
			added: 1,
			unchanged: 0
		});
		expect(preview.display.files.show.changes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ operation: 'add', targetMappingId: '82001' })
			])
		);
		expect(preview.display.diffTruncated).toBe(false);
		expect(preview.display.classified).toHaveLength(2);
		expect(preview.display.ambiguous).toHaveLength(1);
		expect(preview.display.libraries).toHaveLength(2);
		for (const fingerprint of Object.values(preview.fingerprints)) {
			expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
		}
		for (const sourceUrl of [
			moviePosterUrl,
			movieBackgroundUrl,
			showPosterUrl,
			ambiguousPosterUrl
		]) {
			expect(JSON.stringify(preview)).not.toContain(sourceUrl);
		}
		await expect(migration.getByText(t('kometa_migration_preview_title'))).toBeVisible();
		await expect(migration).toContainText(t('kometa_migration_ambiguous_title', { count: 1 }));
		await expect(migration).toContainText(t('kometa_migration_ambiguous_hint'));
		await expect(migration).toContainText('71001');
		await expect(migration).toContainText(/TVDB\s*82001/);
		const confirmButton = migration.getByRole('button', {
			name: t('kometa_migration_confirm_action')
		});
		await expect(confirmButton).toBeDisabled();
		await expect(migration).not.toContainText(ambiguousPosterUrl);
		await migration.getByLabel(t('kometa_migration_accept_ambiguous')).check();
		const expiryClient = createClient({ url: `file:${runtime.databaseFile}` });
		try {
			const expired = await expiryClient.execute({
				sql: 'update operation_plans set expires_at = 0 where id = ?',
				args: [preview.planId]
			});
			expect(expired.rowsAffected).toBe(1);
		} finally {
			expiryClient.close();
		}
		const expiredConfirmationResponsePromise = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === '/api/kometa/migration/confirm' &&
				response.request().method() === 'POST'
		);
		await confirmButton.click();
		const expiredConfirmationResponse = await expiredConfirmationResponsePromise;
		expect(expiredConfirmationResponse.status()).toBe(410);
		expect(await expiredConfirmationResponse.json()).toMatchObject({
			error: { code: 'plan_expired' }
		});
		await expect(migration.getByRole('alert')).toContainText(t('kometa_migration_error_stale'));
		await expect(migration.getByText(t('kometa_migration_preview_title'))).toHaveCount(0);
		await expect(previewButton).toBeFocused();

		const renewedAfterExpiryResponsePromise = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === '/api/kometa/migration/preview' &&
				response.request().method() === 'POST'
		);
		await previewButton.click();
		const renewedAfterExpiryResponse = await renewedAfterExpiryResponsePromise;
		expect(renewedAfterExpiryResponse.ok()).toBeTruthy();
		const renewedAfterExpiry = await renewedAfterExpiryResponse.json();
		expect(renewedAfterExpiry.planId).not.toBe(preview.planId);
		await expect(migration.getByText(t('kometa_migration_preview_title'))).toBeVisible();
		await migration.getByLabel(t('kometa_migration_accept_ambiguous')).check();
		writeFileSync(legacyPath, `${legacyMetadata}\n# changed after preview\n`, { mode: 0o600 });
		const staleConfirmationResponsePromise = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === '/api/kometa/migration/confirm' &&
				response.request().method() === 'POST'
		);
		try {
			await confirmButton.click();
			const staleConfirmationResponse = await staleConfirmationResponsePromise;
			expect(staleConfirmationResponse.status()).toBe(409);
			expect(await staleConfirmationResponse.json()).toMatchObject({
				error: { code: 'plan_stale' }
			});
		} finally {
			writeFileSync(legacyPath, legacyMetadata, { mode: 0o600 });
		}
		await expect(migration.getByRole('alert')).toContainText(t('kometa_migration_error_stale'));
		await expect(migration.getByText(t('kometa_migration_preview_title'))).toHaveCount(0);
		await expect(previewButton).toBeFocused();

		const renewedAfterStaleResponsePromise = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === '/api/kometa/migration/preview' &&
				response.request().method() === 'POST'
		);
		await previewButton.click();
		const renewedAfterStaleResponse = await renewedAfterStaleResponsePromise;
		expect(renewedAfterStaleResponse.ok()).toBeTruthy();
		const renewedAfterStale = await renewedAfterStaleResponse.json();
		expect(renewedAfterStale.planId).not.toBe(renewedAfterExpiry.planId);
		await expect(migration.getByText(t('kometa_migration_preview_title'))).toBeVisible();
		await migration.getByRole('button', { name: t('kometa_migration_cancel_preview') }).click();
		await expect(migration.getByText(t('kometa_migration_preview_title'))).toHaveCount(0);
		await expect(previewButton).toBeFocused();
		const cancelledReplay = await page.request.post('/api/kometa/migration/confirm', {
			data: {
				planId: renewedAfterStale.planId,
				digest: renewedAfterStale.digest,
				acceptAmbiguous: true
			}
		});
		expect(cancelledReplay.status()).toBe(409);
		expect(await cancelledReplay.json()).toMatchObject({ error: { code: 'plan_consumed' } });
		expect(readFileSync(legacyPath, 'utf8')).toBe(legacyMetadata);
		expect(readFileSync(runtime.kometaConfigPath, 'utf8')).toBe(legacyConfig);
		expect(existsSync(moviePath)).toBe(false);
		expect(existsSync(showPath)).toBe(false);
		expect(
			readdirSync(runtime.kometaDirectory).filter((name) =>
				name.includes('.posterpilot-migration-bak-')
			)
		).toEqual([]);

		const renewedAfterCancelResponsePromise = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === '/api/kometa/migration/preview' &&
				response.request().method() === 'POST'
		);
		await previewButton.click();
		const renewedAfterCancelResponse = await renewedAfterCancelResponsePromise;
		expect(renewedAfterCancelResponse.ok()).toBeTruthy();
		const renewedAfterCancel = await renewedAfterCancelResponse.json();
		expect(renewedAfterCancel.planId).not.toBe(renewedAfterStale.planId);
		await expect(migration.getByText(t('kometa_migration_preview_title'))).toBeVisible();
		await migration.getByLabel(t('kometa_migration_accept_ambiguous')).check();
		await expect(confirmButton).toBeEnabled();
		const failedConfirmationResponse = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === '/api/kometa/migration/confirm' &&
				response.request().method() === 'POST'
		);
		const kometaDirectoryMode = statSync(runtime.kometaDirectory).mode & 0o777;
		try {
			// Reads and the DB-backed consume/journal remain available, but the first
			// atomic split-file write fails after the durable checkpoint is installed.
			chmodSync(runtime.kometaDirectory, 0o500);
			await confirmButton.click();
			const failedResponse = await failedConfirmationResponse;
			expect(failedResponse.status()).toBe(500);
			expect(await failedResponse.json()).toMatchObject({
				error: { code: 'migration_write_failed' }
			});
		} finally {
			chmodSync(runtime.kometaDirectory, kometaDirectoryMode);
		}
		await expect(migration.getByText(t('kometa_migration_preview_title'))).toHaveCount(0);
		await expect(migration).toContainText(t('kometa_migration_status_failed'));
		await expect(migration.getByRole('alert')).toHaveCount(1);
		await expect(migration.getByRole('alert')).toContainText(t('kometa_migration_error_generic'));
		const resumeButton = migration.getByRole('button', {
			name: t('kometa_migration_resume_action')
		});
		await expect(resumeButton).toBeVisible();
		expect(readFileSync(legacyPath, 'utf8')).toBe(legacyMetadata);
		expect(readFileSync(runtime.kometaConfigPath, 'utf8')).toBe(legacyConfig);

		await reloadHydrated(page);
		await expect(migration.getByText(t('kometa_migration_preview_title'))).toHaveCount(0);
		await expect(migration).toContainText(t('kometa_migration_status_failed'));
		await expect(migration.getByRole('alert')).toHaveCount(1);
		await expect(resumeButton).toBeVisible();
		const resumeResponsePromise = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === '/api/kometa/migration/resume' &&
				response.request().method() === 'POST'
		);
		await resumeButton.click();
		const resumeResponse = await resumeResponsePromise;
		expect(resumeResponse.ok()).toBeTruthy();
		const completed = await resumeResponse.json();
		expect(completed).toMatchObject({
			status: 'completed',
			activation: 'managed',
			classifiedCount: 2,
			ambiguousCount: 1,
			canResume: false,
			requiresAcknowledgment: false,
			canRollback: true,
			configBackup: {
				name: expect.any(String),
				fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/)
			}
		});
		await expect(migration).toContainText(t('kometa_migration_status_completed'));
		await expect(migration).toContainText(t('kometa_migration_ambiguous_hint'));

		expect(readFileSync(legacyPath, 'utf8')).toBe(legacyMetadata);
		expect(existsSync(moviePath)).toBe(true);
		expect(existsSync(showPath)).toBe(true);
		const movieMetadata = readFileSync(moviePath, 'utf8');
		const showMetadata = readFileSync(showPath, 'utf8');
		const movieDocument = parse(movieMetadata);
		const showDocument = parse(showMetadata);
		expect(movieDocument.metadata['71001']).toMatchObject({
			sort_title: 'Alpha custom order',
			url_poster: moviePosterUrl,
			url_background: movieBackgroundUrl
		});
		expect(showDocument.metadata['82001']).toMatchObject({ url_poster: showPosterUrl });
		expect(movieDocument.metadata['72001']).toBeUndefined();
		expect(showDocument.metadata['72001']).toBeUndefined();
		expect(movieDocument.metadata['999999']).toBeUndefined();
		expect(showDocument.metadata['999999']).toBeUndefined();
		const migratedConfig = readFileSync(runtime.kometaConfigPath, 'utf8');
		const migratedDocument = parse(migratedConfig);
		expect(migratedDocument.settings).toEqual({ cache: true });
		expect(migratedDocument.libraries['Movies B'].metadata_files).toEqual([
			{ file: 'config/posterpilot-movies.yml' },
			{ file: 'config/user-movies.yml' }
		]);
		expect(migratedDocument.libraries['Shows B'].metadata_files).toEqual([
			{ file: 'config/posterpilot-shows.yml' },
			{ file: 'config/user-shows.yml' }
		]);
		expect(migratedConfig).toContain('# keep this operator note');
		expect(migratedConfig).not.toContain('file: config/posterpilot.yml');
		const configBackupPath = join(runtime.kometaDirectory, completed.configBackup.name);
		expect(readFileSync(configBackupPath, 'utf8')).toBe(legacyConfig);

		await reloadHydrated(page);
		const durableMigration = page.getByTestId('kometa-migration-panel');
		await expect(durableMigration).toContainText(t('kometa_migration_status_completed'));

		const rollbackPreviewResponse = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === '/api/kometa/migration/rollback/preview' &&
				response.request().method() === 'POST'
		);
		await durableMigration
			.getByRole('button', { name: t('kometa_migration_rollback_preview_action') })
			.click();
		const rollbackPreviewHttpResponse = await rollbackPreviewResponse;
		expect(rollbackPreviewHttpResponse.ok()).toBeTruthy();
		const rollbackPreview = await rollbackPreviewHttpResponse.json();
		expect(rollbackPreview.changes.length).toBeGreaterThan(0);
		expect(JSON.stringify(rollbackPreview.changes)).toContain('posterpilot.yml');
		expect(JSON.stringify(rollbackPreview.changes)).toContain('posterpilot-movies.yml');
		expect(JSON.stringify(rollbackPreview)).not.toContain('https://assets.invalid/');
		await expect(durableMigration.getByText(t('kometa_migration_rollback_title'))).toBeVisible();
		await expect(durableMigration).toContainText(t('kometa_migration_rollback_preserves_title'));
		await durableMigration.getByLabel(t('kometa_migration_rollback_confirm_check')).check();
		const rollbackConfirmationResponse = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === '/api/kometa/migration/rollback/confirm' &&
				response.request().method() === 'POST'
		);
		await durableMigration
			.getByRole('button', { name: t('kometa_migration_rollback_confirm_action') })
			.click();
		const rolledBackResponse = await rollbackConfirmationResponse;
		expect(rolledBackResponse.ok()).toBeTruthy();
		expect(await rolledBackResponse.json()).toMatchObject({
			status: 'rolled_back',
			canResume: false,
			requiresAcknowledgment: false,
			canRollback: false
		});
		await expect(durableMigration).toContainText(t('kometa_migration_status_rolled_back'));

		expect(readFileSync(runtime.kometaConfigPath, 'utf8')).toBe(legacyConfig);
		expect(readFileSync(legacyPath, 'utf8')).toBe(legacyMetadata);
		expect(readFileSync(moviePath, 'utf8')).toBe(movieMetadata);
		expect(readFileSync(showPath, 'utf8')).toBe(showMetadata);
		expect(readFileSync(configBackupPath, 'utf8')).toBe(legacyConfig);
		await reloadHydrated(page);
		await expect(page.getByTestId('kometa-migration-panel')).toContainText(
			t('kometa_migration_status_rolled_back')
		);

		// Leave the shared serial fixture on a known non-legacy config for the exact-write test below.
		writeFileSync(runtime.kometaConfigPath, 'libraries: {}\n', { mode: 0o600 });
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
				kometaAssetsDir: runtime.kometaAssetsDirectory,
				kometaMetadataPathPrefix: 'config'
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
