<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import JobProgress from '$lib/components/JobProgress.svelte';
	import { m } from '$lib/paraglide/messages';
	import { jobStatusLabel } from '$lib/job-labels';

	type TriggerType = 'interval' | 'daily' | 'event';
	type Action = 'sync' | 'sync_discover';
	type Schedule = {
		id: string;
		serverInstanceId: string;
		name: string;
		enabled: boolean;
		triggerType: TriggerType;
		action: Action;
		timezone: string;
		intervalMinutes: number | null;
		localTime: string | null;
		eventType: string | null;
		libraryScopes: string[];
		discoveryInputs: Record<string, unknown> | null;
		reviewViewId: string | null;
		retryPolicy: Record<string, unknown> | null;
		failurePauseThreshold: number;
		consecutiveFailures: number;
		catchUpWindowMinutes: number;
		lastRunAt: string | null;
		lastSuccessAt: string | null;
		nextRunAt: string | null;
		pausedAt: string | null;
		webhookEnabled: boolean;
		createdAt: string;
		updatedAt: string;
	};
	type Occurrence = {
		id: string;
		scheduleId: string;
		serverInstanceId: string;
		logicalKey: string;
		triggerType: string;
		eventIdentity: string | null;
		scheduledFor: string;
		jobId: number | null;
		status: 'pending' | 'running' | 'completed' | 'partial_failed' | 'failed' | 'skipped';
		errorCode: string | null;
		createdAt: string;
		startedAt: string | null;
		completedAt: string | null;
		job: {
			id: number;
			status: string;
			phase: string | null;
			attempt: number;
			maxAttempts: number;
			processed: number;
			total: number;
			errorCode: string | null;
			summary: {
				processed: number;
				succeeded: number;
				failed: number;
				skipped: number;
				interrupted: number;
			} | null;
			attempts: {
				attemptNumber: number;
				trigger: string;
				status: string;
				retryable: boolean;
				errorCode: string | null;
				startedAt: string | null;
				finishedAt: string | null;
			}[];
		} | null;
	};

	let {
		initialSchedules,
		initialOccurrences,
		libraries,
		reviewViews,
		locale
	}: {
		initialSchedules: Schedule[];
		initialOccurrences: Occurrence[];
		libraries: { key: string; title: string; type: string }[];
		reviewViews: { id: string; name: string }[];
		locale: string;
	} = $props();

	let schedules = $state<Schedule[]>(untrack(() => [...initialSchedules]));
	let occurrences = $state<Occurrence[]>(untrack(() => [...initialOccurrences]));
	let formOpen = $state(false);
	let editingId = $state<string | null>(null);
	let busy = $state<string | null>(null);
	let deleteConfirmId = $state<string | null>(null);
	let webhookConfirm = $state<{ id: string; action: 'rotate' | 'disable' } | null>(null);
	let webhookCredential = $state<{
		scheduleId: string;
		endpoint: string;
		header: string;
		token: string;
	} | null>(null);
	let notice = $state<string | null>(null);
	let errorCode = $state<string | null>(null);
	let nameInput = $state<HTMLInputElement | null>(null);

	let name = $state('');
	let enabled = $state(true);
	let triggerType = $state<TriggerType>('daily');
	let intervalMinutes = $state('1440');
	let localTime = $state('03:00');
	let eventType = $state<'new_items' | 'sync_completed'>('new_items');
	let timezone = $state('UTC');
	let action = $state<Action>('sync_discover');
	let selectedLibraries = $state<string[]>(untrack(() => libraries.map((library) => library.key)));
	let reviewViewId = $state('');
	let failurePauseThreshold = $state('3');
	let catchUpWindowMinutes = $state('60');

	const scheduleById = $derived(new Map(schedules.map((schedule) => [schedule.id, schedule])));

	onMount(() => {
		if (!formOpen && timezone === 'UTC') {
			timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
		}
	});

	function clearFeedback(): void {
		notice = null;
		errorCode = null;
	}

	function resetForm(): void {
		editingId = null;
		name = '';
		enabled = true;
		triggerType = 'daily';
		intervalMinutes = '1440';
		localTime = '03:00';
		eventType = 'new_items';
		action = 'sync_discover';
		selectedLibraries = libraries.map((library) => library.key);
		reviewViewId = '';
		failurePauseThreshold = '3';
		catchUpWindowMinutes = '60';
	}

	async function openCreate(): Promise<void> {
		clearFeedback();
		resetForm();
		formOpen = true;
		await tick();
		nameInput?.focus();
	}

	async function openEdit(schedule: Schedule): Promise<void> {
		clearFeedback();
		editingId = schedule.id;
		name = schedule.name;
		enabled = schedule.enabled;
		triggerType = schedule.triggerType;
		intervalMinutes = String(schedule.intervalMinutes ?? 1440);
		localTime = schedule.localTime ?? '03:00';
		eventType = schedule.eventType === 'sync_completed' ? 'sync_completed' : 'new_items';
		timezone = schedule.timezone;
		action = schedule.action;
		selectedLibraries = [...schedule.libraryScopes];
		reviewViewId = schedule.reviewViewId ?? '';
		failurePauseThreshold = String(schedule.failurePauseThreshold);
		catchUpWindowMinutes = String(schedule.catchUpWindowMinutes);
		formOpen = true;
		await tick();
		nameInput?.focus();
	}

	function closeForm(): void {
		const returnId = editingId;
		formOpen = false;
		resetForm();
		requestAnimationFrame(() => {
			if (returnId) document.getElementById(`automation-edit-${returnId}`)?.focus();
			else document.getElementById('automation-add')?.focus();
		});
	}

	function toggleLibrary(key: string): void {
		selectedLibraries = selectedLibraries.includes(key)
			? selectedLibraries.filter((value) => value !== key)
			: [...selectedLibraries, key];
	}

	function requestBody(): Record<string, unknown> {
		return {
			name,
			enabled,
			timezone,
			timing:
				triggerType === 'interval'
					? { triggerType, intervalMinutes: Number(intervalMinutes) }
					: triggerType === 'daily'
						? { triggerType, localTime }
						: { triggerType, eventType },
			action,
			libraryScopes: selectedLibraries,
			reviewViewId: reviewViewId || null,
			failurePauseThreshold: Number(failurePauseThreshold),
			catchUpWindowMinutes: Number(catchUpWindowMinutes)
		};
	}

	async function refresh(): Promise<void> {
		const response = await fetch('/api/automations?historyLimit=50');
		if (!response.ok) throw new Error('automation_refresh_failed');
		const result = (await response.json()) as {
			schedules?: Schedule[];
			occurrences?: Occurrence[];
		};
		schedules = result.schedules ?? [];
		occurrences = result.occurrences ?? [];
	}

	async function save(): Promise<void> {
		if (busy) return;
		clearFeedback();
		busy = editingId ? `save:${editingId}` : 'create';
		try {
			const response = await fetch(
				editingId ? `/api/automations/${encodeURIComponent(editingId)}` : '/api/automations',
				{
					method: editingId ? 'PUT' : 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(requestBody())
				}
			);
			const result = await response.json().catch(() => ({}));
			if (!response.ok) {
				errorCode = result?.error?.code ?? 'automation_request_failed';
				return;
			}
			notice = editingId ? m.automation_updated() : m.automation_created();
			formOpen = false;
			resetForm();
			await refresh();
		} catch {
			errorCode = 'automation_request_failed';
		} finally {
			busy = null;
		}
	}

	async function toggleEnabled(schedule: Schedule): Promise<void> {
		if (busy) return;
		clearFeedback();
		busy = `toggle:${schedule.id}`;
		try {
			const response = await fetch(`/api/automations/${encodeURIComponent(schedule.id)}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ enabled: !schedule.enabled })
			});
			if (!response.ok) throw new Error('automation_toggle_failed');
			notice = m.automation_toggled();
			await refresh();
		} catch {
			errorCode = 'automation_request_failed';
		} finally {
			busy = null;
		}
	}

	async function remove(schedule: Schedule): Promise<void> {
		if (deleteConfirmId !== schedule.id) {
			deleteConfirmId = schedule.id;
			return;
		}
		if (busy) return;
		clearFeedback();
		busy = `delete:${schedule.id}`;
		try {
			const response = await fetch(`/api/automations/${encodeURIComponent(schedule.id)}`, {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ confirm: true })
			});
			if (!response.ok) throw new Error('automation_delete_failed');
			deleteConfirmId = null;
			notice = m.automation_deleted();
			await refresh();
		} catch {
			errorCode = 'automation_request_failed';
		} finally {
			busy = null;
		}
	}

	async function retryOccurrence(occurrence: Occurrence): Promise<void> {
		if (!occurrence.jobId || busy) return;
		clearFeedback();
		busy = `retry:${occurrence.id}`;
		try {
			const response = await fetch(`/api/jobs/${occurrence.jobId}/retry`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{}'
			});
			const result = await response.json().catch(() => ({}));
			if (!response.ok) {
				errorCode = result?.error?.code ?? 'automation_retry_failed';
				return;
			}
			notice = m.automation_retry_started({ id: result.jobId ?? occurrence.jobId });
			await refresh();
		} catch {
			errorCode = 'automation_retry_failed';
		} finally {
			busy = null;
		}
	}

	async function rotateWebhook(schedule: Schedule): Promise<void> {
		if (
			schedule.webhookEnabled &&
			(webhookConfirm?.id !== schedule.id || webhookConfirm.action !== 'rotate')
		) {
			webhookConfirm = { id: schedule.id, action: 'rotate' };
			return;
		}
		if (busy) return;
		clearFeedback();
		busy = `webhook:${schedule.id}`;
		try {
			const response = await fetch(
				`/api/automations/${encodeURIComponent(schedule.id)}/webhook-token`,
				{ method: 'POST' }
			);
			const result = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error('automation_webhook_failed');
			webhookCredential = {
				scheduleId: schedule.id,
				endpoint: result.endpoint,
				header: result.header,
				token: result.token
			};
			webhookConfirm = null;
			notice = m.automation_webhook_created();
			await refresh();
		} catch {
			errorCode = 'automation_webhook_failed';
		} finally {
			busy = null;
		}
	}

	async function disableWebhook(schedule: Schedule): Promise<void> {
		if (webhookConfirm?.id !== schedule.id || webhookConfirm.action !== 'disable') {
			webhookConfirm = { id: schedule.id, action: 'disable' };
			return;
		}
		if (busy) return;
		clearFeedback();
		busy = `webhook:${schedule.id}`;
		try {
			const response = await fetch(
				`/api/automations/${encodeURIComponent(schedule.id)}/webhook-token`,
				{ method: 'DELETE' }
			);
			if (!response.ok) throw new Error('automation_webhook_failed');
			webhookCredential = null;
			webhookConfirm = null;
			notice = m.automation_webhook_disabled();
			await refresh();
		} catch {
			errorCode = 'automation_webhook_failed';
		} finally {
			busy = null;
		}
	}

	function formatDate(value: string | null): string {
		return value
			? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
					new Date(value)
				)
			: m.automation_never();
	}

	function timingLabel(schedule: Schedule): string {
		if (schedule.triggerType === 'interval') {
			return m.automation_schedule_interval({ minutes: schedule.intervalMinutes ?? 0 });
		}
		if (schedule.triggerType === 'daily') {
			return m.automation_schedule_daily({
				time: schedule.localTime ?? '—',
				timezone: schedule.timezone
			});
		}
		return schedule.eventType === 'sync_completed'
			? m.automation_event_sync_completed()
			: m.automation_event_new_items();
	}

	function errorMessage(code: string): string {
		if (code === 'duplicate_automation_name') return m.automation_error_duplicate();
		if (
			code === 'library_scope_not_found' ||
			code === 'review_view_not_found' ||
			code === 'server_instance_unavailable'
		) {
			return m.automation_error_scope();
		}
		if (code.startsWith('invalid_')) return m.automation_error_invalid();
		if (code.startsWith('job_retry_') || code === 'automation_retry_failed') {
			return m.automation_retry_error();
		}
		if (code.startsWith('webhook_') || code === 'automation_webhook_failed') {
			return m.automation_webhook_error();
		}
		return m.automation_error_generic();
	}

	function occurrenceStatus(status: Occurrence['status']): string {
		return status === 'skipped' ? m.automation_status_skipped() : jobStatusLabel(status);
	}

	function isActiveJob(occurrence: Occurrence): boolean {
		return ['pending', 'running', 'retry_scheduled'].includes(occurrence.job?.status ?? '');
	}

	function reviewHref(occurrence: Occurrence, schedule: Schedule | undefined): string {
		const params = new URLSearchParams();
		if (schedule?.reviewViewId) params.set('view', schedule.reviewViewId);
		if (occurrence.jobId) params.set('job', String(occurrence.jobId));
		return `/review${params.size ? `?${params.toString()}` : ''}`;
	}
</script>

<section class="space-y-5" aria-labelledby="automation-title" aria-busy={busy !== null}>
	<header class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<div class="flex flex-wrap items-center gap-2">
				<h2 id="automation-title" class="text-lg font-semibold">{m.automation_title()}</h2>
				<span class="badge badge-info">{m.automation_review_only_badge()}</span>
			</div>
			<p class="mt-1 max-w-2xl text-sm text-neutral-400">{m.automation_intro()}</p>
		</div>
		<button id="automation-add" type="button" class="btn btn-accent" onclick={openCreate}>
			{m.automation_add()}
		</button>
	</header>

	{#if notice}<p class="text-sm text-emerald-300" role="status">{notice}</p>{/if}
	{#if errorCode}<p class="text-sm text-red-300" role="alert">{errorMessage(errorCode)}</p>{/if}

	{#if formOpen}
		<form
			class="surface grid gap-4 border-accent-900/60 p-4 sm:grid-cols-2"
			onsubmit={(event) => {
				event.preventDefault();
				void save();
			}}
		>
			<div class="sm:col-span-2">
				<h3 class="text-sm font-semibold">
					{editingId ? m.automation_edit_title() : m.automation_create_title()}
				</h3>
				<p class="mt-1 text-xs text-neutral-400">{m.automation_review_only_hint()}</p>
			</div>
			<label class="text-sm text-neutral-300 sm:col-span-2">
				{m.automation_name()}
				<input
					bind:this={nameInput}
					bind:value={name}
					required
					maxlength="80"
					class="input mt-1 w-full"
				/>
			</label>
			<label class="text-sm text-neutral-300">
				{m.automation_trigger()}
				<select
					bind:value={triggerType}
					aria-label={m.automation_trigger()}
					class="input mt-1 w-full"
				>
					<option value="daily">{m.automation_trigger_daily()}</option>
					<option value="interval">{m.automation_trigger_interval()}</option>
					<option value="event">{m.automation_trigger_event()}</option>
				</select>
			</label>
			{#if triggerType === 'daily'}
				<label class="text-sm text-neutral-300">
					{m.automation_daily_time()}
					<input bind:value={localTime} type="time" required class="input mt-1 w-full" />
				</label>
			{:else if triggerType === 'interval'}
				<label class="text-sm text-neutral-300">
					{m.automation_interval_minutes()}
					<input
						bind:value={intervalMinutes}
						type="number"
						min="5"
						max="527040"
						required
						class="input mt-1 w-full"
					/>
				</label>
			{:else}
				<label class="text-sm text-neutral-300">
					{m.automation_event_type()}
					<select
						bind:value={eventType}
						aria-label={m.automation_event_type()}
						class="input mt-1 w-full"
					>
						<option value="new_items">{m.automation_event_new_items()}</option>
						<option value="sync_completed">{m.automation_event_sync_completed()}</option>
					</select>
				</label>
			{/if}
			<label class="text-sm text-neutral-300">
				{m.automation_timezone()}
				<input
					bind:value={timezone}
					required
					placeholder="America/Bahia"
					class="input mt-1 w-full"
				/>
			</label>
			<label class="text-sm text-neutral-300">
				{m.automation_action()}
				<select bind:value={action} aria-label={m.automation_action()} class="input mt-1 w-full">
					<option value="sync_discover">{m.automation_action_sync_discover()}</option>
					<option value="sync">{m.automation_action_sync()}</option>
				</select>
				<span class="mt-1 block text-xs text-neutral-500">{m.automation_action_hint()}</span>
			</label>

			<fieldset class="sm:col-span-2">
				<legend class="text-sm text-neutral-300">{m.automation_libraries()}</legend>
				<p class="mt-1 text-xs text-neutral-500">{m.automation_libraries_hint()}</p>
				<div class="mt-2 flex flex-wrap gap-2">
					{#each libraries as library (library.key)}
						<label class="chip cursor-pointer">
							<input
								type="checkbox"
								checked={selectedLibraries.includes(library.key)}
								onchange={() => toggleLibrary(library.key)}
							/>
							{library.title}
						</label>
					{/each}
				</div>
			</fieldset>

			<label class="text-sm text-neutral-300 sm:col-span-2">
				{m.automation_review_view()}
				<select
					bind:value={reviewViewId}
					aria-label={m.automation_review_view()}
					class="input mt-1 w-full"
				>
					<option value="">{m.automation_review_view_none()}</option>
					{#each reviewViews as view (view.id)}<option value={view.id}>{view.name}</option>{/each}
				</select>
			</label>

			<details class="sm:col-span-2">
				<summary class="cursor-pointer text-sm text-neutral-300">{m.automation_advanced()}</summary>
				<div class="mt-3 grid gap-3 sm:grid-cols-2">
					<label class="text-sm text-neutral-300">
						{m.automation_failure_threshold()}
						<input
							bind:value={failurePauseThreshold}
							type="number"
							min="1"
							max="20"
							class="input mt-1 w-full"
						/>
					</label>
					<label class="text-sm text-neutral-300">
						{m.automation_catchup_window()}
						<input
							bind:value={catchUpWindowMinutes}
							type="number"
							min="0"
							max="10080"
							class="input mt-1 w-full"
						/>
					</label>
				</div>
			</details>

			<label class="flex items-center gap-2 text-sm text-neutral-300 sm:col-span-2">
				<input type="checkbox" bind:checked={enabled} />
				{m.automation_enabled_on_save()}
			</label>
			<div class="flex flex-wrap gap-2 sm:col-span-2">
				<button
					type="submit"
					class="btn btn-accent"
					disabled={busy !== null || selectedLibraries.length === 0}
				>
					{busy?.startsWith('save:') || busy === 'create'
						? m.automation_saving()
						: m.automation_save()}
				</button>
				<button type="button" class="btn btn-ghost" disabled={busy !== null} onclick={closeForm}>
					{m.automation_cancel()}
				</button>
			</div>
		</form>
	{/if}

	<section aria-labelledby="automation-list-title">
		<div class="flex items-center justify-between gap-3">
			<h3 id="automation-list-title" class="section-title">{m.automation_schedules_title()}</h3>
			<button type="button" class="btn btn-ghost py-1 text-xs" onclick={refresh}>
				{m.automation_refresh()}
			</button>
		</div>
		{#if schedules.length === 0}
			<div class="surface mt-3 p-5 text-sm text-neutral-400">{m.automation_empty()}</div>
		{:else}
			<ul class="mt-3 space-y-3">
				{#each schedules as schedule (schedule.id)}
					{@const scopedLibraries = schedule.libraryScopes
						.map((key) => libraries.find((library) => library.key === key)?.title ?? key)
						.join(', ')}
					<li class="surface p-4">
						<div class="flex flex-wrap items-start justify-between gap-3">
							<div>
								<div class="flex flex-wrap items-center gap-2">
									<h4 class="font-medium text-neutral-100">{schedule.name}</h4>
									<span class={schedule.enabled ? 'badge badge-success' : 'badge badge-muted'}>
										{schedule.pausedAt
											? m.automation_paused()
											: schedule.enabled
												? m.automation_enabled()
												: m.automation_disabled()}
									</span>
									<span class="badge badge-info">{m.automation_review_only_badge()}</span>
									{#if schedule.triggerType === 'event' && schedule.webhookEnabled}
										<span class="badge badge-muted">{m.automation_webhook_enabled()}</span>
									{/if}
								</div>
								<p class="mt-1 text-xs text-neutral-400">{timingLabel(schedule)}</p>
								<p class="mt-1 text-xs text-neutral-400">
									{m.automation_scope_summary({ libraries: scopedLibraries })}
								</p>
								<p class="mt-2 text-xs text-neutral-500">
									{m.automation_next_run({ date: formatDate(schedule.nextRunAt) })} ·
									{m.automation_last_run({ date: formatDate(schedule.lastRunAt) })} ·
									{m.automation_last_success({ date: formatDate(schedule.lastSuccessAt) })}
									{#if schedule.consecutiveFailures > 0}
										· {m.automation_failure_count({ count: schedule.consecutiveFailures })}
									{/if}
								</p>
							</div>
							<div class="flex flex-wrap justify-end gap-2">
								<button
									id={`automation-edit-${schedule.id}`}
									type="button"
									class="btn btn-ghost px-2.5 py-1.5 text-xs"
									disabled={busy !== null}
									onclick={() => openEdit(schedule)}>{m.automation_edit()}</button
								>
								<button
									type="button"
									class="btn btn-subtle px-2.5 py-1.5 text-xs"
									disabled={busy !== null}
									onclick={() => toggleEnabled(schedule)}
								>
									{schedule.enabled ? m.automation_disable() : m.automation_enable()}
								</button>
								<button
									type="button"
									class={deleteConfirmId === schedule.id
										? 'btn bg-red-900/60 px-2.5 py-1.5 text-xs text-red-100'
										: 'btn btn-ghost px-2.5 py-1.5 text-xs'}
									disabled={busy !== null}
									aria-describedby={deleteConfirmId === schedule.id
										? `automation-delete-${schedule.id}`
										: undefined}
									onclick={() => remove(schedule)}
								>
									{deleteConfirmId === schedule.id
										? m.automation_delete_confirm()
										: m.automation_delete()}
								</button>
								{#if schedule.triggerType === 'event'}
									<button
										type="button"
										class={webhookConfirm?.id === schedule.id && webhookConfirm.action === 'rotate'
											? 'btn bg-amber-900/50 px-2.5 py-1.5 text-xs text-amber-100'
											: 'btn btn-ghost px-2.5 py-1.5 text-xs'}
										disabled={busy !== null}
										onclick={() => rotateWebhook(schedule)}
									>
										{webhookConfirm?.id === schedule.id && webhookConfirm.action === 'rotate'
											? m.automation_webhook_confirm_rotate()
											: schedule.webhookEnabled
												? m.automation_webhook_rotate()
												: m.automation_webhook_create()}
									</button>
									{#if schedule.webhookEnabled}
										<button
											type="button"
											class={webhookConfirm?.id === schedule.id &&
											webhookConfirm.action === 'disable'
												? 'btn bg-red-900/60 px-2.5 py-1.5 text-xs text-red-100'
												: 'btn btn-ghost px-2.5 py-1.5 text-xs'}
											disabled={busy !== null}
											onclick={() => disableWebhook(schedule)}
										>
											{webhookConfirm?.id === schedule.id && webhookConfirm.action === 'disable'
												? m.automation_webhook_confirm_disable()
												: m.automation_webhook_disable()}
										</button>
									{/if}
								{/if}
							</div>
						</div>
						{#if deleteConfirmId === schedule.id}
							<p
								id={`automation-delete-${schedule.id}`}
								class="mt-3 text-xs text-red-200"
								role="alert"
							>
								{m.automation_delete_hint()}
							</p>
						{/if}
						{#if webhookCredential?.scheduleId === schedule.id}
							<div
								class="mt-4 rounded-lg border border-amber-800/60 bg-amber-950/30 p-3"
								role="status"
							>
								<div class="flex items-start justify-between gap-3">
									<div>
										<p class="text-sm font-medium text-amber-100">
											{m.automation_webhook_once_title()}
										</p>
										<p class="mt-1 text-xs text-amber-200/80">
											{m.automation_webhook_once_hint()}
										</p>
									</div>
									<button
										type="button"
										class="btn btn-ghost px-2 py-1 text-xs"
										onclick={() => (webhookCredential = null)}
									>
										{m.automation_webhook_close()}
									</button>
								</div>
								<div class="mt-3 grid gap-2">
									<label class="text-xs text-neutral-300">
										{m.automation_webhook_endpoint()}
										<input
											class="input mt-1 w-full font-mono text-xs"
											readonly
											value={webhookCredential.endpoint}
										/>
									</label>
									<label class="text-xs text-neutral-300">
										{m.automation_webhook_header()}
										<input
											class="input mt-1 w-full font-mono text-xs"
											readonly
											value={webhookCredential.header}
										/>
									</label>
									<label class="text-xs text-neutral-300">
										{m.automation_webhook_token()}
										<input
											class="input mt-1 w-full font-mono text-xs"
											readonly
											spellcheck="false"
											value={webhookCredential.token}
										/>
									</label>
								</div>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section aria-labelledby="automation-history-title">
		<h3 id="automation-history-title" class="section-title">{m.automation_history_title()}</h3>
		{#if occurrences.length === 0}
			<div class="surface mt-3 p-5 text-sm text-neutral-400">{m.automation_history_empty()}</div>
		{:else}
			<div class="surface mt-3 overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead class="border-b border-neutral-800 text-xs text-neutral-400">
						<tr>
							<th class="px-4 py-2 font-medium">{m.automation_name()}</th>
							<th class="px-4 py-2 font-medium">{m.automation_scheduled_for()}</th>
							<th class="px-4 py-2 font-medium">{m.jobs_col_status()}</th>
							<th class="px-4 py-2 font-medium">{m.automation_result()}</th>
						</tr>
					</thead>
					<tbody>
						{#each occurrences as occurrence (occurrence.id)}
							{@const schedule = scheduleById.get(occurrence.scheduleId)}
							{@const summary = occurrence.job?.summary}
							<tr class="border-b border-neutral-800/70 last:border-0">
								<td class="px-4 py-3 text-neutral-200">{schedule?.name ?? '—'}</td>
								<td class="px-4 py-3 text-xs text-neutral-400"
									>{formatDate(occurrence.scheduledFor)}</td
								>
								<td class="px-4 py-3">
									<span class="badge badge-muted">{occurrenceStatus(occurrence.status)}</span>
								</td>
								<td class="px-4 py-3 text-xs">
									{#if occurrence.jobId}
										<span class="text-neutral-400">#{occurrence.jobId}</span>
									{/if}
									{#if summary}
										<p class="mt-1 text-neutral-300">
											{m.automation_result_summary({
												succeeded: summary.succeeded,
												failed: summary.failed,
												skipped: summary.skipped
											})}
										</p>
									{/if}
									{#if occurrence.job?.errorCode}
										<p class="mt-1 text-amber-300">{m.automation_failure_summary()}</p>
									{/if}
									<div class="mt-2 flex flex-wrap gap-3">
										{#if occurrence.status !== 'pending' && occurrence.status !== 'running'}
											<a
												class="text-accent-300 underline hover:text-accent-200"
												href={reviewHref(occurrence, schedule)}>{m.automation_open_review()}</a
											>
										{/if}
										{#if occurrence.jobId && (occurrence.status === 'failed' || occurrence.status === 'partial_failed')}
											<button
												type="button"
												class="text-accent-300 underline hover:text-accent-200 disabled:opacity-50"
												disabled={busy !== null}
												onclick={() => retryOccurrence(occurrence)}
											>
												{busy === `retry:${occurrence.id}`
													? m.automation_retrying()
													: m.automation_retry_failed()}
											</button>
										{/if}
									</div>
									{#if occurrence.job?.attempts.length}
										<details class="mt-2 text-neutral-400">
											<summary class="cursor-pointer text-neutral-300">
												{m.automation_attempts({ count: occurrence.job.attempts.length })}
											</summary>
											<ul class="mt-1 space-y-1 pl-4">
												{#each occurrence.job.attempts as attempt (attempt.attemptNumber)}
													<li>
														{m.jobs_attempt({
															attempt: attempt.attemptNumber,
															max: occurrence.job.maxAttempts
														})}
														· {jobStatusLabel(attempt.status)}
														{#if attempt.finishedAt}
															· {formatDate(attempt.finishedAt)}{/if}
													</li>
												{/each}
											</ul>
										</details>
									{/if}
								</td>
							</tr>
							{#if occurrence.jobId && isActiveJob(occurrence)}
								<tr class="border-b border-neutral-800/70">
									<td colspan="4" class="px-4 py-3">
										<JobProgress
											jobId={occurrence.jobId}
											onDone={() => void refresh()}
											onRetryStarted={(ids) => {
												notice = m.automation_retry_started({ id: ids[0] ?? occurrence.jobId! });
												void refresh();
											}}
										/>
									</td>
								</tr>
							{/if}
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</section>
