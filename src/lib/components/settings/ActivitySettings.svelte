<script lang="ts">
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { m } from '$lib/paraglide/messages';
	import { toasts } from '$lib/stores/toasts.svelte';

	export type ActivityEventRow = {
		id: number;
		level: string;
		type: string;
		message: string;
		createdAt: string | Date | null;
	};

	type LevelFilter = 'all' | 'info' | 'warn' | 'error';

	let {
		initialEvents,
		initialCursor,
		locale
	}: {
		initialEvents: ActivityEventRow[];
		initialCursor: number | null;
		locale: string;
	} = $props();

	const levelFilters: { key: LevelFilter; label: () => string }[] = [
		{ key: 'all', label: m.events_level_all },
		{ key: 'info', label: m.events_level_info },
		{ key: 'warn', label: m.events_level_warn },
		{ key: 'error', label: m.events_level_error }
	];
	const eventBadgeClass: Record<string, string> = {
		info: 'badge badge-info',
		warn: 'badge badge-warn',
		error: 'badge badge-error'
	};

	// svelte-ignore state_referenced_locally
	let events = $state<ActivityEventRow[]>([...initialEvents]);
	// svelte-ignore state_referenced_locally
	let eventsCursor = $state<number | null>(initialCursor);
	let eventLevel = $state<LevelFilter>('all');
	let eventsLoading = $state(false);
	let clearingEvents = $state(false);
	let confirmingClear = $state(false);
	let eventsError = $state<string | null>(null);

	function fmtTime(ts: string | Date | null): string {
		return ts ? new Date(ts).toLocaleString(locale) : '—';
	}

	function eventLevelLabel(level: string): string {
		if (level === 'info') return m.events_level_info();
		if (level === 'warn') return m.events_level_warn();
		return m.events_level_error();
	}

	function eventTypeLabel(type: string): string {
		switch (type) {
			case 'auth':
				return m.events_type_auth();
			case 'sync':
				return m.events_type_sync();
			case 'discover':
				return m.events_type_discover();
			case 'apply':
				return m.events_type_apply();
			case 'provider':
				return m.events_type_provider();
			case 'settings':
				return m.events_type_settings();
			case 'system':
				return m.events_type_system();
			case 'automation':
				return m.events_type_automation();
			case 'backup':
				return m.events_type_backup();
			case 'restore':
				return m.events_type_restore();
			default:
				return m.events_type_unknown();
		}
	}

	async function loadEvents(opts: { level?: LevelFilter; before?: number | null } = {}) {
		if (eventsLoading) return;
		eventsLoading = true;
		eventsError = null;
		try {
			const params = new URLSearchParams();
			const level = opts.level ?? eventLevel;
			if (level !== 'all') params.set('level', level);
			if (opts.before != null) params.set('before', String(opts.before));
			const response = await fetch(`/api/events?${params.toString()}`);
			if (!response.ok) throw new Error('events_load_failed');
			const body = (await response.json()) as {
				events?: ActivityEventRow[];
				nextCursor?: number | null;
			};
			if (!Array.isArray(body.events)) throw new Error('events_load_failed');
			events = opts.before != null ? [...events, ...body.events] : body.events;
			eventsCursor = body.nextCursor ?? null;
		} catch {
			const message = m.events_load_failed();
			eventsError = message;
			toasts.error(message);
		} finally {
			eventsLoading = false;
		}
	}

	function setEventLevel(level: LevelFilter) {
		if (level === eventLevel || eventsLoading) return;
		eventLevel = level;
		events = [];
		eventsCursor = null;
		void loadEvents({ level, before: null });
	}

	async function clearEvents() {
		if (!confirmingClear) {
			confirmingClear = true;
			return;
		}
		confirmingClear = false;
		clearingEvents = true;
		eventsError = null;
		try {
			const response = await fetch('/api/events', { method: 'DELETE' });
			if (!response.ok) throw new Error('events_clear_failed');
			events = [];
			eventsCursor = null;
			toasts.success(m.events_cleared());
		} catch {
			const message = m.events_clear_failed();
			eventsError = message;
			toasts.error(message);
		} finally {
			clearingEvents = false;
		}
	}
</script>

<div>
	<div class="flex flex-wrap items-center gap-1">
		{#each levelFilters as filter (filter.key)}
			<button
				type="button"
				onclick={() => setEventLevel(filter.key)}
				disabled={eventsLoading}
				aria-pressed={eventLevel === filter.key}
				class="chip {eventLevel === filter.key ? 'chip-active' : ''}"
			>
				{filter.label()}
			</button>
		{/each}
		<button
			type="button"
			onclick={clearEvents}
			onblur={() => (confirmingClear = false)}
			disabled={clearingEvents || eventsLoading || events.length === 0}
			title={confirmingClear ? m.events_clear_confirm() : undefined}
			class="btn ml-auto {confirmingClear
				? 'bg-red-900/50 text-red-300 hover:bg-red-900/70'
				: 'btn-ghost'}"
		>
			{confirmingClear ? m.events_clear_confirm_action() : m.events_clear()}
		</button>
	</div>

	{#if eventsError}
		<p class="mt-3 text-sm text-red-300" role="alert">{eventsError}</p>
	{/if}

	<div class="surface mt-4 overflow-x-auto" aria-busy={eventsLoading}>
		<span class="sr-only" aria-live="polite">
			{eventsLoading ? m.settings_activity_loading() : ''}
		</span>
		<table class="w-full text-sm">
			<thead class="text-left text-xs text-neutral-400">
				<tr class="border-b border-neutral-800">
					<th class="px-4 py-2 font-medium">{m.events_col_level()}</th>
					<th class="px-4 py-2 font-medium">{m.events_col_type()}</th>
					<th class="px-4 py-2 font-medium">{m.events_col_message()}</th>
					<th class="px-4 py-2 font-medium">{m.events_col_time()}</th>
				</tr>
			</thead>
			<tbody>
				{#if eventsLoading && events.length === 0}
					{#each Array(5) as _, index (index)}
						<tr class="border-b border-neutral-800/60" aria-hidden="true">
							<td class="px-4 py-3"><Skeleton class="h-4 w-14 rounded" /></td>
							<td class="px-4 py-3"><Skeleton class="h-4 w-20 rounded" /></td>
							<td class="px-4 py-3"><Skeleton class="h-4 w-full rounded" /></td>
							<td class="px-4 py-3"><Skeleton class="h-4 w-28 rounded" /></td>
						</tr>
					{/each}
				{:else if events.length === 0}
					<tr><td colspan="4" class="p-4 text-sm text-neutral-400">{m.events_empty()}</td></tr>
				{:else}
					{#each events as event (event.id)}
						<tr class="border-b border-neutral-800/60 align-top last:border-0">
							<td class="px-4 py-2">
								<span class={eventBadgeClass[event.level] ?? 'badge badge-muted'}>
									{eventLevelLabel(event.level)}
								</span>
							</td>
							<td class="px-4 py-2 text-neutral-400">{eventTypeLabel(event.type)}</td>
							<td class="px-4 py-2 text-neutral-200">{event.message}</td>
							<td class="px-4 py-2 whitespace-nowrap text-neutral-400">
								{fmtTime(event.createdAt)}
							</td>
						</tr>
					{/each}
					{#if eventsLoading}
						<tr aria-hidden="true">
							<td class="px-4 py-3"><Skeleton class="h-4 w-14 rounded" /></td>
							<td class="px-4 py-3"><Skeleton class="h-4 w-20 rounded" /></td>
							<td class="px-4 py-3"><Skeleton class="h-4 w-full rounded" /></td>
							<td class="px-4 py-3"><Skeleton class="h-4 w-28 rounded" /></td>
						</tr>
					{/if}
				{/if}
			</tbody>
		</table>
	</div>

	{#if eventsCursor != null}
		<div class="mt-4 text-center">
			<button
				type="button"
				onclick={() => loadEvents({ before: eventsCursor })}
				disabled={eventsLoading}
				class="btn btn-ghost"
			>
				{eventsLoading ? m.settings_activity_loading() : m.events_load_more()}
			</button>
		</div>
	{/if}
</div>
