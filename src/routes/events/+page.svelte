<script lang="ts">
	import { m } from '$lib/paraglide/messages';

	let { data } = $props();

	type LevelFilter = 'all' | 'info' | 'warn' | 'error';

	const filters: { key: LevelFilter; label: () => string }[] = [
		{ key: 'all', label: m.events_level_all },
		{ key: 'info', label: m.events_level_info },
		{ key: 'warn', label: m.events_level_warn },
		{ key: 'error', label: m.events_level_error }
	];

	// Build a query string for a level filter (drops the cursor so it restarts).
	function filterHref(level: LevelFilter): string {
		return level === 'all' ? '/events' : `/events?level=${level}`;
	}

	// "Load more" preserves the active level and continues from the id cursor.
	const loadMoreHref = $derived.by(() => {
		if (data.nextCursor == null) return null;
		const params = new URLSearchParams();
		if (data.level !== 'all') params.set('level', data.level);
		params.set('before', String(data.nextCursor));
		return `/events?${params.toString()}`;
	});

	const badgeClass: Record<string, string> = {
		info: 'badge badge-info',
		warn: 'badge badge-warn',
		error: 'badge badge-error'
	};

	// Format timestamps with the active locale's conventions.
	function fmt(ts: Date | null): string {
		return ts ? new Date(ts).toLocaleString(data.locale) : '—';
	}
</script>

<svelte:head><title>{m.events_title()} · PosterPilot</title></svelte:head>

<h1 class="text-2xl font-semibold tracking-tight">{m.events_title()}</h1>

<div class="mt-4 flex flex-wrap items-center gap-1">
	{#each filters as f (f.key)}
		<a
			href={filterHref(f.key)}
			class="chip {data.level === f.key ? 'chip-active' : ''}"
			data-sveltekit-noscroll
		>
			{f.label()}
		</a>
	{/each}
</div>

<div class="surface mt-4 overflow-hidden">
	{#if data.events.length === 0}
		<p class="p-4 text-sm text-neutral-500">{m.events_empty()}</p>
	{:else}
		<table class="w-full text-sm">
			<thead class="text-left text-xs text-neutral-500">
				<tr class="border-b border-neutral-800">
					<th class="px-4 py-2 font-medium">{m.events_col_level()}</th>
					<th class="px-4 py-2 font-medium">{m.events_col_type()}</th>
					<th class="px-4 py-2 font-medium">{m.events_col_message()}</th>
					<th class="px-4 py-2 font-medium">{m.events_col_time()}</th>
				</tr>
			</thead>
			<tbody>
				{#each data.events as event (event.id)}
					<tr class="border-b border-neutral-800/60 last:border-0 align-top">
						<td class="px-4 py-2">
							<span class={badgeClass[event.level] ?? 'badge badge-muted'}>{event.level}</span>
						</td>
						<td class="px-4 py-2 text-neutral-400">{event.type}</td>
						<td class="px-4 py-2 text-neutral-200">{event.message}</td>
						<td class="px-4 py-2 whitespace-nowrap text-neutral-500">{fmt(event.createdAt)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>

{#if loadMoreHref}
	<div class="mt-4 text-center">
		<a href={loadMoreHref} class="btn btn-ghost" data-sveltekit-noscroll>{m.events_load_more()}</a>
	</div>
{/if}
