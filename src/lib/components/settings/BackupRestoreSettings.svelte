<script lang="ts">
	import { tick } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { readLocaleNeutralApiError } from '$lib/i18n/api-errors';

	type BackupItem = {
		id: string;
		bundleName: string;
		status: 'creating' | 'completed' | 'failed' | 'invalid' | 'deleted';
		trigger: 'manual' | 'scheduled' | 'pre_restore';
		createdAt: string;
		completedAt: string | null;
		validatedAt: string | null;
		appVersion: string | null;
		schemaVersion: string | null;
		sizeBytes: number | null;
		validationStatus: 'unknown' | 'valid' | 'warning' | 'invalid';
		errorCode: string | null;
		protected: boolean;
		isManual: boolean;
		isSafety: boolean;
		canExport: boolean;
	};

	type RestoreHistory = {
		id: string;
		backupId: string;
		safetyBackupId: string | null;
		status: string;
		report: Record<string, unknown> | null;
		errorCode: string | null;
		createdAt: string;
		completedAt: string | null;
	};

	type RestartRequired = {
		restoreId: string;
		backupId: string;
		safetyBackupId: string;
	};

	type Preflight = {
		report: {
			restorable: boolean;
			blocking: string[];
			warnings: Array<{ code: string; externalPathKind?: string }>;
			bundle: {
				appVersion: string | null;
				schemaVersion: string | null;
				createdAt: string | null;
			};
			replacement: {
				database: boolean;
				applicationKey: boolean;
				configurationFiles: number;
			};
			key: { mode: string | null; encryptedSecretCount: number };
			schema: {
				status: string;
				requiredMigrations: Array<{ id: string; createdAt: number }>;
			} | null;
			storage: { requiredBytes: number; spaceStatus: string } | null;
		};
		confirmation: {
			restoreId: string;
			planId: string;
			digest: string;
			expiresAt: string;
			previewChecksum: string;
		} | null;
	};

	let {
		initialBackups,
		initialPolicy,
		initialHistory,
		locale
	}: {
		initialBackups: BackupItem[];
		initialPolicy: { maxCount: number | null; maxAgeDays: number | null };
		initialHistory: RestoreHistory[];
		locale: string;
	} = $props();

	// svelte-ignore state_referenced_locally
	let backups = $state<BackupItem[]>([...initialBackups]);
	// svelte-ignore state_referenced_locally
	let history = $state<RestoreHistory[]>([...initialHistory]);
	// svelte-ignore state_referenced_locally
	let maxCount = $state(initialPolicy.maxCount === null ? '' : String(initialPolicy.maxCount));
	// svelte-ignore state_referenced_locally
	let maxAgeDays = $state(
		initialPolicy.maxAgeDays === null ? '' : String(initialPolicy.maxAgeDays)
	);
	let busy = $state<string | null>(null);
	let errorCode = $state<string | null>(null);
	let errorReference = $state<string | null>(null);
	let notice = $state<string | null>(null);
	let confirmExportId = $state<string | null>(null);
	let confirmDeleteId = $state<string | null>(null);
	let restoreBackupId = $state<string | null>(null);
	let restorePreview = $state<Preflight | null>(null);
	let restoreAcknowledged = $state(false);
	let restartRequired = $state<RestartRequired | null>(null);
	let restorePreviewElement: HTMLElement | null = $state(null);
	let restoreTriggerElement: HTMLElement | null = null;

	function formatDate(value: string | null): string {
		return value ? new Date(value).toLocaleString(locale) : '—';
	}

	function formatBytes(value: number | null): string {
		if (value === null) return '—';
		return new Intl.NumberFormat(locale, {
			style: 'unit',
			unit: value >= 1024 * 1024 ? 'megabyte' : 'kilobyte',
			maximumFractionDigits: 1
		}).format(value / (value >= 1024 * 1024 ? 1024 * 1024 : 1024));
	}

	function triggerLabel(trigger: BackupItem['trigger']): string {
		return trigger === 'pre_restore'
			? m.backup_trigger_safety()
			: trigger === 'scheduled'
				? m.backup_trigger_scheduled()
				: m.backup_trigger_manual();
	}

	function validationLabel(status: BackupItem['validationStatus']): string {
		return status === 'valid'
			? m.backup_validation_valid()
			: status === 'warning'
				? m.backup_validation_warning()
				: status === 'invalid'
					? m.backup_validation_invalid()
					: m.backup_validation_unknown();
	}

	function restoreStatus(status: string): string {
		switch (status) {
			case 'previewed':
				return m.backup_restore_status_previewed();
			case 'pending_restart':
				return m.backup_restore_status_pending_restart();
			case 'restoring':
				return m.backup_restore_status_restoring();
			case 'completed':
				return m.backup_restore_status_completed();
			case 'rolled_back':
				return m.backup_restore_status_rolled_back();
			default:
				return m.backup_restore_status_failed();
		}
	}

	function failureMessage(code: string | null): string | null {
		if (!code) return null;
		if (code.startsWith('retention_')) return m.backup_error_retention();
		if (code.startsWith('restore_')) return m.backup_error_restore();
		if (code.includes('export')) return m.backup_error_export();
		if (code.includes('delete')) return m.backup_error_delete();
		if (code.includes('validation')) return m.backup_error_validation();
		if (code.includes('creation')) return m.backup_error_create();
		return m.api_error_generic();
	}

	function blockingLabel(code: string): string {
		switch (code) {
			case 'bundle_invalid':
				return m.backup_restore_block_bundle();
			case 'database_unreadable':
			case 'database_integrity_failed':
				return m.backup_restore_block_database();
			case 'schema_metadata_missing':
			case 'schema_manifest_mismatch':
			case 'schema_incompatible':
				return m.backup_restore_block_schema();
			case 'schema_newer_than_application':
				return m.backup_restore_block_newer();
			case 'key_missing':
			case 'key_mismatch':
			case 'key_mode_incompatible':
				return m.backup_restore_block_key();
			case 'restore_path_unwritable':
				return m.backup_restore_block_path();
			default:
				return m.backup_restore_block_space();
		}
	}

	function warningLabel(warning: Preflight['report']['warnings'][number]): string {
		return warning.code === 'bundle_permissions'
			? m.backup_restore_warning_permissions()
			: m.backup_restore_warning_external({
					component: externalComponentLabel(warning.externalPathKind)
				});
	}

	function externalComponentLabel(kind: string | undefined): string {
		switch (kind) {
			case 'kometa_assets':
				return m.diagnostics_component_kometa_assets();
			case 'thumbnail_cache':
				return m.diagnostics_component_data_path();
			case 'backup_storage':
				return m.diagnostics_component_backup_path();
			default:
				return m.backup_external_component();
		}
	}

	function resetFeedback() {
		errorCode = null;
		errorReference = null;
		notice = null;
	}

	async function jsonApi(
		path: string,
		init: Parameters<typeof fetch>[1] = undefined
	): Promise<Record<string, unknown>> {
		const response = await fetch(path, init);
		const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
		if (!response.ok) {
			const parsed = readLocaleNeutralApiError(body);
			errorCode = parsed.code;
			errorReference = parsed.correlationId;
			throw new Error('backup_request_failed');
		}
		return body;
	}

	async function refreshBackups() {
		if (busy) return;
		resetFeedback();
		busy = 'refresh';
		try {
			const body = await jsonApi('/api/backups');
			backups = body.backups as BackupItem[];
		} catch {
			// Structured error is already captured.
		} finally {
			busy = null;
		}
	}

	async function createBackup() {
		if (busy) return;
		resetFeedback();
		busy = 'create';
		try {
			const body = await jsonApi('/api/backups', { method: 'POST' });
			backups = [
				body.backup as BackupItem,
				...backups.filter((item) => item.id !== (body.backup as BackupItem).id)
			];
			notice = m.backup_created();
		} catch {
			// Structured error is already captured.
		} finally {
			busy = null;
		}
	}

	async function validateBackup(item: BackupItem) {
		if (busy) return;
		resetFeedback();
		busy = `validate:${item.id}`;
		try {
			const body = await jsonApi(`/api/backups/${encodeURIComponent(item.id)}/validate`, {
				method: 'POST'
			});
			backups = backups.map((entry) => (entry.id === item.id ? (body.item as BackupItem) : entry));
			notice = m.backup_validated();
		} catch {
			// Structured error is already captured.
		} finally {
			busy = null;
		}
	}

	async function savePolicy() {
		if (busy) return;
		resetFeedback();
		// Numeric bindings start from our server string, become numbers after input,
		// and yield `null` when cleared. Normalize all three states before validating.
		const countText = maxCount == null ? '' : String(maxCount).trim();
		const ageText = maxAgeDays == null ? '' : String(maxAgeDays).trim();
		const count = countText === '' ? null : Number(countText);
		const age = ageText === '' ? null : Number(ageText);
		if (
			(count !== null && (!Number.isSafeInteger(count) || count < 0)) ||
			(age !== null && (!Number.isSafeInteger(age) || age < 1))
		) {
			errorCode = 'retention_policy_invalid';
			return;
		}
		busy = 'policy';
		try {
			await jsonApi('/api/backups/policy', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ maxCount: count, maxAgeDays: age })
			});
			notice = m.backup_policy_saved();
		} catch {
			// Structured error is already captured.
		} finally {
			busy = null;
		}
	}

	async function exportBackup(item: BackupItem) {
		if (confirmExportId !== item.id) {
			confirmExportId = item.id;
			confirmDeleteId = null;
			return;
		}
		if (busy) return;
		resetFeedback();
		busy = `export:${item.id}`;
		try {
			const response = await fetch(`/api/backups/${encodeURIComponent(item.id)}/export`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ confirmSecretBearing: true })
			});
			if (!response.ok) {
				const parsed = readLocaleNeutralApiError(await response.json().catch(() => ({})));
				errorCode = parsed.code;
				errorReference = parsed.correlationId;
				return;
			}
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = `posterpilot-backup-${item.id}.tar`;
			anchor.click();
			URL.revokeObjectURL(url);
			confirmExportId = null;
			notice = m.backup_export_ready();
		} catch {
			errorCode = 'backup_export_failed';
		} finally {
			busy = null;
		}
	}

	async function deleteBackup(item: BackupItem) {
		if (confirmDeleteId !== item.id) {
			confirmDeleteId = item.id;
			confirmExportId = null;
			return;
		}
		if (busy) return;
		resetFeedback();
		busy = `delete:${item.id}`;
		try {
			await jsonApi(`/api/backups/${encodeURIComponent(item.id)}`, {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ confirm: true, confirmProtected: item.protected })
			});
			backups = backups.filter((entry) => entry.id !== item.id);
			confirmDeleteId = null;
			notice = m.backup_deleted();
		} catch {
			// Structured error is already captured.
		} finally {
			busy = null;
		}
	}

	async function previewRestore(item: BackupItem) {
		if (busy) return;
		restoreTriggerElement =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
		resetFeedback();
		busy = `restore-preview:${item.id}`;
		restoreBackupId = item.id;
		restorePreview = null;
		restoreAcknowledged = false;
		try {
			restorePreview = (await jsonApi(
				`/api/backups/${encodeURIComponent(item.id)}/restore/preview`,
				{ method: 'POST' }
			)) as unknown as Preflight;
			await tick();
			restorePreviewElement?.focus();
		} catch {
			// Structured error is already captured.
		} finally {
			busy = null;
		}
	}

	async function closeRestorePreview() {
		restoreBackupId = null;
		restorePreview = null;
		restoreAcknowledged = false;
		await tick();
		restoreTriggerElement?.focus();
		restoreTriggerElement = null;
	}

	async function confirmRestore() {
		if (
			busy ||
			!restoreAcknowledged ||
			!restoreBackupId ||
			!restorePreview?.confirmation ||
			!restorePreview.report.restorable
		) {
			return;
		}
		resetFeedback();
		busy = `restore-confirm:${restoreBackupId}`;
		try {
			const body = await jsonApi(
				`/api/backups/${encodeURIComponent(restoreBackupId)}/restore/confirm`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						planId: restorePreview.confirmation.planId,
						digest: restorePreview.confirmation.digest
					})
				}
			);
			restartRequired = body as RestartRequired;
			notice = m.backup_restore_prepared();
			await closeRestorePreview();
		} catch {
			// Structured error is already captured.
		} finally {
			busy = null;
		}
	}
</script>

<section class="space-y-5" aria-labelledby="backup-title" aria-busy={busy !== null}>
	<div class="surface p-4">
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div>
				<h2 id="backup-title" class="text-base font-semibold">{m.backup_title()}</h2>
				<p class="mt-1 max-w-2xl text-xs text-neutral-400">{m.backup_intro()}</p>
			</div>
			<button type="button" class="btn btn-accent" disabled={busy !== null} onclick={createBackup}>
				{busy === 'create' ? m.backup_creating() : m.backup_create()}
			</button>
		</div>

		{#if notice}<p class="mt-3 text-sm text-emerald-300" role="status">{notice}</p>{/if}
		{#if failureMessage(errorCode)}
			<div class="mt-3 text-sm text-red-300" role="alert">
				<p>{failureMessage(errorCode)}</p>
				{#if errorReference}<p class="mt-1 font-mono text-xs">
						{m.api_error_reference({ id: errorReference })}
					</p>{/if}
			</div>
		{/if}
	</div>

	{#if restartRequired}
		<div class="surface border-amber-800 bg-amber-950/30 p-4" role="status">
			<h3 class="font-semibold text-amber-200">{m.backup_restart_title()}</h3>
			<p class="mt-1 text-sm text-amber-100">{m.backup_restart_hint()}</p>
			<p class="mt-2 text-xs text-amber-300">
				{m.backup_safety_id({ id: restartRequired.safetyBackupId })}
			</p>
		</div>
	{/if}

	<div class="surface p-4">
		<h3 class="text-sm font-semibold">{m.backup_retention_title()}</h3>
		<p class="mt-1 text-xs text-neutral-400">{m.backup_retention_hint()}</p>
		<div class="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
			<label class="text-sm text-neutral-300">
				{m.backup_retention_count()}
				<input bind:value={maxCount} type="number" min="0" class="input mt-1 w-full" />
			</label>
			<label class="text-sm text-neutral-300">
				{m.backup_retention_age()}
				<input bind:value={maxAgeDays} type="number" min="1" class="input mt-1 w-full" />
			</label>
			<button type="button" class="btn btn-subtle" disabled={busy !== null} onclick={savePolicy}>
				{busy === 'policy' ? m.settings_saving() : m.settings_save()}
			</button>
		</div>
	</div>

	<div>
		<div class="flex items-center justify-between gap-3">
			<h3 class="text-sm font-semibold">{m.backup_inventory_title()}</h3>
			<button
				type="button"
				class="btn btn-ghost px-2 py-1 text-xs"
				disabled={busy !== null}
				onclick={refreshBackups}
			>
				{m.backup_refresh()}
			</button>
		</div>
		{#if backups.length === 0}
			<p class="surface mt-3 p-4 text-sm text-neutral-400">{m.backup_empty()}</p>
		{:else}
			<ul class="mt-3 space-y-3">
				{#each backups as item (item.id)}
					<li class="surface p-4">
						<div class="flex flex-wrap items-start justify-between gap-3">
							<div>
								<div class="flex flex-wrap items-center gap-2">
									<span class="font-medium">{formatDate(item.createdAt)}</span>
									<span class="badge badge-info">{triggerLabel(item.trigger)}</span>
									<span
										class="badge {item.validationStatus === 'valid'
											? 'badge-success'
											: item.validationStatus === 'invalid'
												? 'badge-error'
												: 'badge-warn'}"
									>
										{validationLabel(item.validationStatus)}
									</span>
									{#if item.protected}<span class="badge badge-muted">{m.backup_protected()}</span
										>{/if}
								</div>
								<p class="mt-1 text-xs text-neutral-400">
									{m.backup_metadata({
										version: item.appVersion ?? '—',
										schema: item.schemaVersion ?? '—',
										size: formatBytes(item.sizeBytes)
									})}
								</p>
							</div>
							<div class="flex flex-wrap justify-end gap-2">
								<button
									type="button"
									class="btn btn-subtle px-2.5 py-1.5 text-xs"
									disabled={busy !== null}
									onclick={() => validateBackup(item)}
								>
									<span class="sr-only">{formatDate(item.createdAt)}: </span>
									{busy === `validate:${item.id}` ? m.backup_validating() : m.backup_validate()}
								</button>
								<button
									type="button"
									class="btn btn-ghost px-2.5 py-1.5 text-xs"
									disabled={busy !== null || !item.canExport}
									aria-describedby={confirmExportId === item.id
										? `backup-export-warning-${item.id}`
										: undefined}
									onclick={() => exportBackup(item)}
								>
									<span class="sr-only">{formatDate(item.createdAt)}: </span>
									{confirmExportId === item.id ? m.backup_export_confirm() : m.backup_export()}
								</button>
								<button
									type="button"
									class="btn btn-ghost px-2.5 py-1.5 text-xs"
									disabled={busy !== null || item.validationStatus === 'invalid'}
									aria-expanded={restoreBackupId === item.id && restorePreview !== null}
									aria-controls="backup-restore-preview"
									onclick={() => previewRestore(item)}
								>
									<span class="sr-only">{formatDate(item.createdAt)}: </span>
									{busy === `restore-preview:${item.id}`
										? m.backup_restore_checking()
										: m.backup_restore_preview()}
								</button>
								<button
									type="button"
									class="btn px-2.5 py-1.5 text-xs {confirmDeleteId === item.id
										? 'bg-red-900/60 text-red-200'
										: 'btn-ghost'}"
									disabled={busy !== null}
									aria-describedby={confirmDeleteId === item.id
										? `backup-delete-warning-${item.id}`
										: undefined}
									onclick={() => deleteBackup(item)}
								>
									<span class="sr-only">{formatDate(item.createdAt)}: </span>
									{confirmDeleteId === item.id ? m.backup_delete_confirm() : m.backup_delete()}
								</button>
							</div>
						</div>
						{#if confirmExportId === item.id}
							<p
								id={`backup-export-warning-${item.id}`}
								class="mt-3 text-xs text-amber-300"
								role="alert"
							>
								{m.backup_export_warning()}
							</p>
						{/if}
						{#if confirmDeleteId === item.id}
							<p
								id={`backup-delete-warning-${item.id}`}
								class="mt-3 text-xs text-red-200"
								role="alert"
							>
								{item.protected ? m.backup_delete_protected_warning() : m.backup_delete_warning()}
							</p>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	{#if restoreBackupId && restorePreview}
		<div
			bind:this={restorePreviewElement}
			id="backup-restore-preview"
			tabindex="-1"
			class="surface border-accent-900 p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-400"
			aria-labelledby="restore-preview-title"
		>
			<div class="flex items-start justify-between gap-3">
				<div>
					<h3 id="restore-preview-title" class="text-sm font-semibold">
						{m.backup_restore_preview_title()}
					</h3>
					<p class="mt-1 text-xs text-neutral-400">{m.backup_restore_preview_hint()}</p>
				</div>
				<span class="badge {restorePreview.report.restorable ? 'badge-success' : 'badge-error'}">
					{restorePreview.report.restorable ? m.backup_restore_ready() : m.backup_restore_blocked()}
				</span>
			</div>

			<div class="mt-3 grid gap-3 text-xs sm:grid-cols-2">
				<p>
					{m.backup_restore_scope({
						key: restorePreview.report.replacement.applicationKey
							? m.backup_restore_scope_db_key()
							: m.backup_restore_scope_db()
					})}
				</p>
				<p>
					{m.backup_restore_schema({ version: restorePreview.report.bundle.schemaVersion ?? '—' })}
				</p>
				<p>{m.backup_restore_key_mode({ mode: restorePreview.report.key.mode ?? '—' })}</p>
				<p>
					{m.backup_restore_space({
						size: formatBytes(restorePreview.report.storage?.requiredBytes ?? null)
					})}
				</p>
			</div>

			{#if restorePreview.report.schema?.requiredMigrations.length}
				<p class="mt-3 text-xs text-neutral-300">
					{m.backup_restore_migrations({
						count: restorePreview.report.schema.requiredMigrations.length
					})}
				</p>
			{/if}
			{#if restorePreview.report.blocking.length}
				<ul class="mt-3 space-y-1 text-xs text-red-300">
					{#each restorePreview.report.blocking as code (code)}<li>
							• {blockingLabel(code)}
						</li>{/each}
				</ul>
			{/if}
			{#if restorePreview.report.warnings.length}
				<ul class="mt-3 space-y-1 text-xs text-amber-300">
					{#each restorePreview.report.warnings as warning, index (`${warning.code}:${index}`)}<li>
							• {warningLabel(warning)}
						</li>{/each}
				</ul>
			{/if}

			{#if restorePreview.report.restorable && restorePreview.confirmation}
				<label
					class="mt-4 flex items-start gap-2 rounded-lg border border-amber-900/60 bg-amber-950/25 p-3 text-xs text-amber-100"
				>
					<input type="checkbox" bind:checked={restoreAcknowledged} />
					<span>{m.backup_restore_confirmation_warning()}</span>
				</label>
			{/if}
			<div class="mt-3 flex gap-2">
				{#if restorePreview.report.restorable && restorePreview.confirmation}
					<button
						type="button"
						class="btn btn-accent"
						disabled={!restoreAcknowledged || busy !== null}
						onclick={confirmRestore}
					>
						{busy?.startsWith('restore-confirm:')
							? m.backup_restore_preparing()
							: m.backup_restore_confirm()}
					</button>
				{/if}
				<button
					type="button"
					class="btn btn-ghost"
					disabled={busy !== null}
					onclick={closeRestorePreview}
				>
					{m.review_cancel()}
				</button>
			</div>
		</div>
	{/if}

	<div>
		<h3 class="text-sm font-semibold">{m.backup_history_title()}</h3>
		{#if history.length === 0}
			<p class="mt-2 text-xs text-neutral-400">{m.backup_history_empty()}</p>
		{:else}
			<ul class="mt-2 space-y-2">
				{#each history as entry (entry.id)}
					<li class="rounded-lg border border-neutral-800 p-3 text-xs">
						<div class="flex flex-wrap items-center justify-between gap-2">
							<span>{formatDate(entry.createdAt)}</span>
							<span class="badge badge-muted">{restoreStatus(entry.status)}</span>
						</div>
						{#if entry.safetyBackupId}<p class="mt-1 text-neutral-500">
								{m.backup_safety_id({ id: entry.safetyBackupId })}
							</p>{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</section>
