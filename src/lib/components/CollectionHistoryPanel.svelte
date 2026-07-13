<script lang="ts">
	import ArtworkUndoDialog from '$lib/components/ArtworkUndoDialog.svelte';
	import JobProgress from '$lib/components/JobProgress.svelte';
	import type { PublicJobProgress } from '$lib/job-progress';
	import { m } from '$lib/paraglide/messages';

	type Revision = {
		id: string;
		mediaItemId: number | null;
		mediaCollectionId: string | null;
		memberTitle: string | null;
		destination: 'server' | 'kometa';
		kind: 'poster' | 'background' | 'title_card';
		season: number | null;
		episode: number | null;
		outcome: 'pending' | 'success' | 'failed' | 'skipped';
		verification: 'pending' | 'exact' | 'best_effort' | 'unavailable' | 'mismatch' | 'failed';
		createdAt: string | Date;
		restorable: boolean;
		restored: boolean;
	};
	type Group = {
		id: string;
		jobId: number | null;
		outcome: 'pending' | 'success' | 'partial' | 'failed';
		createdAt: string | Date;
		completedAt: string | Date | null;
		revisionCount: number;
		memberCount: number;
		revisions: Revision[];
	};
	type UndoPreview = {
		planId: string;
		digest: string;
		summary: {
			operationCount: number;
			actionableCount: number;
			unavailableCount: number;
			targetCount: number;
			slotCount: number;
			destinations: { server: number; kometa: number };
			restoreStates: { present: number; absent: number; unavailable: number };
		};
	};

	let {
		collectionId,
		groups,
		locale,
		onChanged
	}: {
		collectionId: string;
		groups: Group[];
		locale: string;
		onChanged?: () => void | Promise<void>;
	} = $props();

	let preview = $state<UndoPreview | null>(null);
	let open = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let result = $state<{ succeeded: number; failed: number; skipped: number } | null>(null);
	let undoJobId = $state<number | null>(null);
	let selectedScopeLabel = $state(m.collection_undo_scope());

	function date(value: string | Date): string {
		return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
			new Date(value)
		);
	}

	function outcomeLabel(outcome: Group['outcome']): string {
		if (outcome === 'success') return m.item_history_success();
		if (outcome === 'partial') return m.item_history_partial();
		if (outcome === 'failed') return m.item_history_failed();
		return m.item_history_pending();
	}

	function revisionOutcomeLabel(outcome: Revision['outcome']): string {
		if (outcome === 'success') return m.item_history_success();
		if (outcome === 'failed') return m.item_history_failed();
		if (outcome === 'skipped') return m.item_history_skipped();
		return m.item_history_pending();
	}

	function slotLabel(kind: Revision['kind']): string {
		if (kind === 'poster') return m.collection_poster();
		if (kind === 'background') return m.collection_background();
		return m.collection_title_card();
	}

	function destinationLabel(destination: Revision['destination']): string {
		return destination === 'server' ? m.item_history_server() : 'Kometa';
	}

	async function previewUndo(scope: { kind: 'group' | 'revision'; id: string }): Promise<void> {
		if (busy) return;
		busy = true;
		error = null;
		result = null;
		try {
			const response = await fetch(`/api/collections/${encodeURIComponent(collectionId)}/undo`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(
					scope.kind === 'group' ? { revisionGroupId: scope.id } : { revisionId: scope.id }
				)
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok || !body.preview) {
				error = m.collection_undo_error();
				return;
			}
			preview = body.preview;
			selectedScopeLabel =
				scope.kind === 'group' ? m.collection_undo_scope() : m.collection_undo_revision_scope();
			open = true;
		} catch {
			error = m.collection_undo_error();
		} finally {
			busy = false;
		}
	}

	async function confirmUndo(): Promise<void> {
		if (!preview || busy) return;
		busy = true;
		error = null;
		try {
			const response = await fetch(`/api/collections/${encodeURIComponent(collectionId)}/undo`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ planId: preview.planId, digest: preview.digest })
			});
			const body = await response.json().catch(() => ({}));
			// A grouped undo runs on the durable worker: follow its job instead of
			// waiting on a response that would time out for a large collection.
			if (!response.ok || !body.job) {
				error = m.collection_undo_error();
				return;
			}
			undoJobId = Number(body.job.jobId);
			open = false;
			preview = null;
		} catch {
			error = m.collection_undo_error();
		} finally {
			busy = false;
		}
	}

	async function onUndoDone(status: string, progress: PublicJobProgress): Promise<void> {
		undoJobId = null;
		if (status === 'completed' || status === 'partial_failed') {
			result = {
				succeeded: progress.resultSummary.succeeded,
				failed: progress.resultSummary.failed,
				skipped: progress.resultSummary.skipped
			};
		} else {
			error = m.collection_undo_error();
		}
		await onChanged?.();
	}
</script>

<section class="surface p-5" aria-labelledby="collection-history-title" aria-busy={busy}>
	<h2 id="collection-history-title" class="text-lg font-semibold">
		{m.collection_history_title()}
	</h2>
	<p class="mt-1 text-sm text-neutral-400">{m.collection_history_hint()}</p>
	{#if error}<p class="mt-3 text-sm text-red-300" role="alert">{error}</p>{/if}
	{#if undoJobId}
		<div class="mt-3"><JobProgress jobId={undoJobId} onDone={onUndoDone} /></div>
	{/if}
	{#if result}
		<p
			class="mt-3 text-sm {result.failed > 0 ? 'text-amber-300' : 'text-emerald-300'}"
			role="status"
		>
			{result.failed > 0
				? m.collection_undo_partial({ succeeded: result.succeeded, failed: result.failed })
				: m.collection_undo_completed({ count: result.succeeded })}
		</p>
	{/if}

	{#if groups.length === 0}
		<p class="mt-4 text-sm text-neutral-400">{m.collection_history_empty()}</p>
	{:else}
		<ul class="mt-4 space-y-2">
			{#each groups as group (group.id)}
				<li class="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
					<div class="flex flex-wrap items-center justify-between gap-3">
						<div>
							<p class="text-sm font-medium text-neutral-200">{date(group.createdAt)}</p>
							<p class="mt-1 text-xs text-neutral-400">
								{m.collection_history_summary({
									members: group.memberCount,
									changes: group.revisionCount,
									status: outcomeLabel(group.outcome)
								})}
							</p>
						</div>
						<button
							type="button"
							class="btn btn-ghost px-3 py-1.5 text-xs"
							disabled={busy ||
								(group.outcome !== 'success' && group.outcome !== 'partial') ||
								!group.revisions.some((revision) => revision.restorable)}
							onclick={() => previewUndo({ kind: 'group', id: group.id })}
						>
							{m.collection_undo_group()}
						</button>
					</div>
					{#if group.revisions.length > 0}
						<details class="mt-3 border-t border-neutral-800 pt-3">
							<summary class="cursor-pointer text-xs font-medium text-neutral-300">
								{m.collection_history_revisions()}
							</summary>
							<ul class="mt-3 space-y-2">
								{#each group.revisions as revision (revision.id)}
									<li
										class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-neutral-800 bg-neutral-900/60 p-3"
									>
										<div>
											<p class="text-xs font-medium text-neutral-200">
												{m.collection_history_revision_summary({
													title: revision.memberTitle ?? m.collection_unknown_member(),
													slot: slotLabel(revision.kind),
													destination: destinationLabel(revision.destination)
												})}
											</p>
											<div class="mt-1 flex flex-wrap gap-1.5">
												<span class="badge badge-muted"
													>{revisionOutcomeLabel(revision.outcome)}</span
												>
												{#if revision.restored}
													<span class="badge badge-changed">{m.collection_history_restored()}</span>
												{/if}
											</div>
										</div>
										{#if revision.restorable && revision.mediaItemId !== null}
											<button
												type="button"
												class="btn btn-ghost px-3 py-1.5 text-xs"
												disabled={busy}
												onclick={() => previewUndo({ kind: 'revision', id: revision.id })}
											>
												{m.collection_undo_revision()}
											</button>
										{/if}
									</li>
								{/each}
							</ul>
						</details>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<ArtworkUndoDialog
	{open}
	{busy}
	{preview}
	contextLabel={selectedScopeLabel}
	onConfirm={confirmUndo}
	onCancel={() => {
		open = false;
		preview = null;
	}}
/>
