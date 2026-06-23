<script lang="ts">
	let { jobId, onDone }: { jobId: number; onDone?: (status: string) => void } = $props();

	let processed = $state(0);
	let total = $state(0);
	let status = $state('pending');
	let currentItem = $state<string | null>(null);

	const TERMINAL = ['completed', 'failed', 'cancelled', 'interrupted'];

	$effect(() => {
		const es = new EventSource(`/api/jobs/${jobId}/stream`);
		es.onmessage = (e) => {
			const d = JSON.parse(e.data);
			processed = d.processed;
			total = d.total;
			status = d.status;
			currentItem = d.currentItem;
			if (TERMINAL.includes(status)) {
				es.close();
				onDone?.(status);
			}
		};
		es.onerror = () => es.close();
		return () => es.close();
	});

	let pct = $derived(total ? Math.round((processed / total) * 100) : 0);
	let done = $derived(TERMINAL.includes(status));

	async function cancel() {
		await fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
	}
</script>

<div class="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
	<div class="mb-2 flex items-center justify-between text-xs">
		<span class="font-medium text-neutral-300">Job #{jobId} · {status}</span>
		<span class="text-neutral-500">{processed}/{total} ({pct}%)</span>
	</div>
	<div class="h-2 w-full overflow-hidden rounded bg-neutral-800">
		<div
			class="h-full rounded transition-all {status === 'failed'
				? 'bg-red-500'
				: status === 'completed'
					? 'bg-emerald-500'
					: 'bg-accent-500'}"
			style="width: {pct}%"
		></div>
	</div>
	<div class="mt-2 flex items-center justify-between">
		<span class="truncate text-xs text-neutral-500">{currentItem ?? ''}</span>
		{#if !done}
			<button onclick={cancel} class="text-xs text-neutral-400 hover:text-red-400">Cancel</button>
		{/if}
	</div>
</div>
