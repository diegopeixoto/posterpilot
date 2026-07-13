<script lang="ts">
	import { untrack } from 'svelte';
	import JobProgress from '$lib/components/JobProgress.svelte';
	import { m } from '$lib/paraglide/messages';

	type ApplyMethod = 'server' | 'kometa' | 'both';
	type Preview = {
		planId: string | null;
		digest: string | null;
		expiresAt: string | null;
		summary: {
			itemCount: number;
			actionableItemCount: number;
			operationCount: number;
			skipCount: number;
			destinations: { server: number; kometa: number };
		};
		items: Array<{
			target: { mediaItemId: number };
			operations: Array<{
				id: string;
				destination: 'server' | 'kometa';
				slot: { kind: 'poster' | 'background' | 'title_card'; season: number | null };
			}>;
			skips: Array<{ code: string }>;
		}>;
	};

	let {
		collectionId,
		members,
		stagedCount,
		selectionRevision,
		defaultMethod,
		onChanged
	}: {
		collectionId: string;
		members: Array<{ id: number; title: string }>;
		stagedCount: number;
		selectionRevision: string;
		defaultMethod: ApplyMethod;
		onChanged?: () => void | Promise<void>;
	} = $props();

	let method = $state<ApplyMethod>(untrack(() => defaultMethod));
	let preview = $state<Preview | null>(null);
	let previewing = $state(false);
	let confirming = $state(false);
	let jobId = $state<number | null>(null);
	let errorCode = $state<string | null>(null);
	let trackedRevision = $state('');

	const titleById = $derived(new Map(members.map((member) => [member.id, member.title])));

	$effect(() => {
		const currentRevision = selectionRevision;
		if (trackedRevision && trackedRevision !== currentRevision) preview = null;
		trackedRevision = currentRevision;
	});

	function changeMethod(next: ApplyMethod): void {
		method = next;
		preview = null;
		errorCode = null;
	}

	function errorMessage(code: string): string {
		if (code === 'plan_stale' || code === 'result_set_changed') {
			return m.collection_apply_stale();
		}
		if (code === 'collection_has_no_local_members') return m.collection_apply_no_members();
		if (code === 'job_conflict') return m.collection_apply_conflict();
		return m.collection_apply_error();
	}

	function slotLabel(kind: 'poster' | 'background' | 'title_card'): string {
		if (kind === 'poster') return m.collection_poster();
		if (kind === 'background') return m.collection_background();
		return m.collection_title_card();
	}

	function destinationLabel(destination: 'server' | 'kometa'): string {
		return destination === 'server' ? m.item_history_server() : 'Kometa';
	}

	async function previewApply(): Promise<void> {
		if (previewing || confirming || stagedCount === 0) return;
		previewing = true;
		preview = null;
		errorCode = null;
		try {
			const response = await fetch(
				`/api/collections/${encodeURIComponent(collectionId)}/apply/preview`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ method })
				}
			);
			const result = await response.json().catch(() => ({}));
			if (!response.ok) {
				errorCode = result?.error?.code ?? result?.error ?? 'collection_apply_failed';
				return;
			}
			preview = result as Preview;
		} catch {
			errorCode = 'collection_apply_failed';
		} finally {
			previewing = false;
		}
	}

	async function confirmApply(): Promise<void> {
		if (confirming || !preview?.planId || !preview.digest || preview.summary.operationCount === 0) {
			return;
		}
		confirming = true;
		errorCode = null;
		const frozen = preview;
		try {
			const response = await fetch(`/api/collections/${encodeURIComponent(collectionId)}/apply`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ planId: frozen.planId, digest: frozen.digest })
			});
			const result = await response.json().catch(() => ({}));
			if (!response.ok) {
				errorCode = result?.error?.code ?? result?.error ?? 'collection_apply_failed';
				preview = null;
				return;
			}
			jobId = result.jobId;
			preview = null;
		} catch {
			errorCode = 'collection_apply_failed';
		} finally {
			confirming = false;
		}
	}

	async function jobDone(): Promise<void> {
		await onChanged?.();
	}
</script>

<section
	class="surface p-5"
	aria-labelledby="collection-apply-title"
	aria-busy={previewing || confirming}
>
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<h2 id="collection-apply-title" class="text-lg font-semibold">
				{m.collection_apply_title()}
			</h2>
			<p class="mt-1 max-w-2xl text-sm text-neutral-400">{m.collection_apply_hint()}</p>
		</div>
		<span class="badge badge-info">{m.collection_apply_review_first()}</span>
	</div>

	<div class="mt-4 flex flex-wrap items-end gap-3">
		<label class="text-sm text-neutral-300">
			{m.collection_apply_destination()}
			<select
				class="input mt-1 min-w-44"
				value={method}
				disabled={previewing || confirming}
				onchange={(event) => changeMethod(event.currentTarget.value as ApplyMethod)}
			>
				<option value="server">{m.collection_apply_server()}</option>
				<option value="kometa">Kometa</option>
				<option value="both">{m.collection_apply_both()}</option>
			</select>
		</label>
		<button
			type="button"
			class="btn btn-accent"
			disabled={previewing || confirming || stagedCount === 0}
			onclick={previewApply}
		>
			{previewing ? m.collection_apply_previewing() : m.collection_apply_preview()}
		</button>
		<p class="pb-2 text-xs text-neutral-400">
			{m.collection_apply_staged_count({ count: stagedCount })}
		</p>
	</div>

	{#if stagedCount === 0}
		<p class="mt-3 text-sm text-neutral-400">{m.collection_apply_nothing_staged()}</p>
	{/if}
	{#if errorCode}
		<p class="mt-3 text-sm text-red-300" role="alert">{errorMessage(errorCode)}</p>
	{/if}

	{#if preview}
		<div class="mt-5 rounded-xl border border-accent-900/60 bg-neutral-950/50 p-4">
			<h3 class="text-sm font-semibold">{m.collection_apply_preview_title()}</h3>
			<p class="mt-1 text-xs text-neutral-400">
				{m.collection_apply_preview_summary({
					items: preview.summary.actionableItemCount,
					writes: preview.summary.operationCount,
					skips: preview.summary.skipCount
				})}
			</p>
			<ul class="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
				{#each preview.items as item (item.target.mediaItemId)}
					<li class="rounded-lg border border-neutral-800 bg-neutral-900/70 p-3 text-xs">
						<p class="font-medium text-neutral-200">
							{titleById.get(item.target.mediaItemId) ?? m.collection_unknown_member()}
						</p>
						<div class="mt-2 flex flex-wrap gap-1.5">
							{#each item.operations as operation (operation.id)}
								<span class="badge badge-muted">
									{slotLabel(operation.slot.kind)} · {destinationLabel(operation.destination)}
								</span>
							{/each}
							{#if item.skips.length}
								<span class="badge badge-warn">
									{m.collection_apply_member_skips({ count: item.skips.length })}
								</span>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
			<p class="mt-3 text-xs text-neutral-400">{m.collection_apply_confirm_hint()}</p>
			<div class="mt-3 flex flex-wrap gap-2">
				<button
					type="button"
					class="btn btn-accent"
					disabled={confirming || !preview.planId || preview.summary.operationCount === 0}
					onclick={confirmApply}
				>
					{confirming ? m.collection_apply_confirming() : m.collection_apply_confirm()}
				</button>
				<button type="button" class="btn btn-ghost" onclick={() => (preview = null)}>
					{m.automation_cancel()}
				</button>
			</div>
		</div>
	{/if}

	{#if jobId}
		<div class="mt-5">
			<JobProgress {jobId} onDone={jobDone} />
		</div>
	{/if}
</section>
