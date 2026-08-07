<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { m } from '$lib/paraglide/messages';
	import {
		createSingleFlightTmdbRepairRefresh,
		isActiveTmdbRepairJob,
		observeTmdbRepairWakeSignals,
		tmdbRepairPollInterval
	} from './tmdb-repair-polling';

	type RepairJob = {
		id: number;
		status: string;
		processed: number;
		total: number;
	};

	let {
		repair,
		mutationDisabled = false
	}: {
		repair: { pendingCount: number; job: RepairJob | null };
		mutationDisabled?: boolean;
	} = $props();

	let starting = $state(false);
	let actionError = $state<string | null>(null);
	const refresh = createSingleFlightTmdbRepairRefresh(invalidateAll);
	const active = $derived(isActiveTmdbRepairJob(repair.job?.status));
	const incomplete = $derived(
		repair.job !== null &&
			['partial_failed', 'failed', 'cancelled', 'interrupted'].includes(repair.job.status)
	);

	// Durable database state remains authoritative. Poll only while a repair job is active;
	// an idle warning can otherwise live for days and must not keep invalidating every root
	// load in every open tab. Visibility and focus refreshes still pick up work done elsewhere.
	$effect(() => {
		if (
			repair.pendingCount === 0 ||
			typeof document === 'undefined' ||
			typeof window === 'undefined'
		)
			return;
		const stopWakeRefresh = observeTmdbRepairWakeSignals(document, window, refresh);
		const interval = tmdbRepairPollInterval(repair.pendingCount, repair.job?.status);
		const timer = interval === null ? null : setInterval(() => void refresh(), interval);
		return () => {
			stopWakeRefresh();
			if (timer !== null) clearInterval(timer);
		};
	});

	async function startRepair() {
		if (starting || active || mutationDisabled) return;
		starting = true;
		actionError = null;
		try {
			const response = await fetch('/api/tmdb-repair', { method: 'POST' });
			const body = (await response.json().catch(() => ({}))) as {
				jobId?: number | null;
				error?: { code?: string; conflictingJobId?: number };
			};
			if (!response.ok) {
				actionError =
					body.error?.code === 'job_conflict' && body.error.conflictingJobId
						? m.tmdb_repair_banner_conflict({ id: body.error.conflictingJobId })
						: m.tmdb_repair_banner_start_failed();
				return;
			}
			await invalidateAll();
		} catch {
			actionError = m.tmdb_repair_banner_start_failed();
		} finally {
			starting = false;
		}
	}
</script>

{#if repair.pendingCount > 0}
	<div
		data-testid="tmdb-repair-banner"
		class="border-b border-amber-900/60 bg-amber-950/45 px-4 py-3 text-amber-100"
		role="status"
		aria-live="polite"
	>
		<div
			class="mx-auto flex max-w-7xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
		>
			<div class="flex min-w-0 items-start gap-2.5">
				<span class="mt-0.5 text-amber-300" aria-hidden="true">⚠</span>
				<div>
					<p class="text-sm font-semibold text-amber-100">
						{#if active && repair.job?.status === 'retry_scheduled'}
							{m.tmdb_repair_banner_retry_scheduled({ count: repair.pendingCount })}
						{:else if active}
							{m.tmdb_repair_banner_running({ count: repair.pendingCount })}
						{:else if incomplete}
							{m.tmdb_repair_banner_incomplete({ count: repair.pendingCount })}
						{:else}
							{m.tmdb_repair_banner_pending({ count: repair.pendingCount })}
						{/if}
					</p>
					<p class="mt-0.5 text-xs text-amber-200/80">{m.tmdb_repair_banner_hint()}</p>
					{#if actionError}
						<p class="mt-1 text-xs text-red-300" role="alert">{actionError}</p>
					{/if}
				</div>
			</div>
			<div class="flex shrink-0 flex-wrap items-center gap-2 pl-7 sm:pl-0">
				{#if repair.job}
					<a
						href={`/?job=${repair.job.id}#job-${repair.job.id}`}
						class="rounded px-2 py-1 text-xs font-semibold text-amber-200 underline decoration-amber-500/60 underline-offset-2 hover:text-amber-50"
					>
						{m.tmdb_repair_banner_job({ id: repair.job.id })}
					</a>
				{/if}
				<button
					type="button"
					class="btn min-h-11 border-amber-700 bg-amber-900/60 text-amber-50 hover:bg-amber-800/70 disabled:opacity-60"
					disabled={starting || active || mutationDisabled}
					onclick={startRepair}
				>
					{starting
						? m.tmdb_repair_banner_starting()
						: active
							? m.tmdb_repair_banner_in_progress()
							: incomplete
								? m.tmdb_repair_banner_retry()
								: m.tmdb_repair_banner_action()}
				</button>
			</div>
		</div>
	</div>
{/if}
