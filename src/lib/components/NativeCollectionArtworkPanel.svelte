<script lang="ts">
	import ArtworkUndoDialog from '$lib/components/ArtworkUndoDialog.svelte';
	import { m } from '$lib/paraglide/messages';

	type Kind = 'poster' | 'background';
	type Capability = 'supported' | 'unsupported' | 'unknown';
	type Candidate = {
		id: string;
		kind: Kind;
		provider: 'tmdb' | 'theposterdb';
		language: string | null;
		width: number | null;
		height: number | null;
		score: number;
	};

	function candidateProviderLabel(provider: Candidate['provider']): string {
		return provider === 'theposterdb' ? 'ThePosterDB' : 'TMDB';
	}
	type Workspace = {
		collection: {
			id: string;
			name: string;
			source: 'tmdb' | 'native';
			provider: 'plex' | 'jellyfin' | 'emby' | null;
			localMemberCount: number;
		};
		entity: {
			available: boolean;
			reason:
				| 'not_native'
				| 'provider_unknown'
				| 'server_unavailable'
				| 'server_scope_mismatch'
				| null;
		};
		candidateSource: {
			available: boolean;
			reason: 'member_identity_incomplete' | 'provider_unavailable' | 'no_candidates' | null;
		};
		slots: Array<{
			kind: Kind;
			capability: Capability;
			current: {
				state: 'present' | 'absent' | 'unavailable';
				artworkVersion: number;
				hasPreview: boolean;
			};
			candidates: Candidate[];
		}>;
	};
	type ApplyPreview = {
		planId: string | null;
		digest: string | null;
		expiresAt: string | null;
		operations: Array<{
			id: string;
			kind: Kind;
			candidateId: string;
			expectedOverwrite: boolean;
			currentState: 'present' | 'absent' | 'unavailable';
		}>;
		skips: Array<{ kind: Kind; candidateId: string; code: string }>;
		summary: {
			operationCount: number;
			skipCount: number;
			poster: string;
			background: string;
		};
	};
	type HistoryEntry = {
		id: string;
		group: {
			id: string;
			kind: 'apply' | 'undo' | 'external_observation';
			outcome: 'pending' | 'success' | 'partial' | 'failed';
			createdAt: string;
			completedAt: string | null;
		};
		undoOfRevisionId: string | null;
		action: 'apply' | 'undo' | 'external_observation';
		kind: Kind;
		outcome: 'pending' | 'success' | 'failed' | 'skipped';
		verification: 'pending' | 'exact' | 'best_effort' | 'unavailable' | 'mismatch' | 'failed';
		errorCode: string | null;
		hasPriorState: boolean;
		undoAvailable: boolean;
		restored: boolean;
		createdAt: string;
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

	let { collectionId, locale = 'en' }: { collectionId: string; locale?: string } = $props();

	let workspace = $state<Workspace | null>(null);
	let history = $state<HistoryEntry[]>([]);
	let selected = $state<Record<Kind, string | null>>({ poster: null, background: null });
	let preview = $state<ApplyPreview | null>(null);
	let loading = $state(true);
	let busy = $state(false);
	let errorCode = $state<string | null>(null);
	let result = $state<{
		status: 'success' | 'partial' | 'failed';
		succeeded: number;
		failed: number;
	} | null>(null);
	let undoPreview = $state<UndoPreview | null>(null);
	let undoOpen = $state(false);
	let undoLabel = $state('');
	let loadedCollectionId = '';

	type HistoryGroup = HistoryEntry['group'] & { entries: HistoryEntry[] };
	const historyGroups = $derived.by(() => {
		const groups = new Map<string, HistoryGroup>();
		for (const entry of history) {
			const existing = groups.get(entry.group.id);
			if (existing) existing.entries.push(entry);
			else groups.set(entry.group.id, { ...entry.group, entries: [entry] });
		}
		return [...groups.values()];
	});
	const selectedCount = $derived(
		Number(Boolean(selected.poster)) + Number(Boolean(selected.background))
	);

	$effect(() => {
		const id = collectionId;
		if (!id || loadedCollectionId === id) return;
		loadedCollectionId = id;
		void load(id);
	});

	function slotLabel(kind: Kind): string {
		return kind === 'poster' ? m.collection_poster() : m.collection_background();
	}

	function statusLabel(status: HistoryEntry['outcome'] | HistoryEntry['group']['outcome']): string {
		if (status === 'success') return m.item_history_success();
		if (status === 'partial') return m.item_history_partial();
		if (status === 'failed') return m.item_history_failed();
		if (status === 'skipped') return m.item_history_skipped();
		return m.item_history_pending();
	}

	function date(value: string): string {
		return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
			new Date(value)
		);
	}

	function entityMessage(reason: Workspace['entity']['reason']): string {
		if (reason === 'not_native') return m.native_collection_entity_not_native();
		if (reason === 'provider_unknown') return m.native_collection_entity_provider_unknown();
		if (reason === 'server_scope_mismatch') return m.native_collection_entity_scope_mismatch();
		return m.native_collection_entity_server_unavailable();
	}

	function candidateSourceMessage(reason: Workspace['candidateSource']['reason']): string {
		if (reason === 'member_identity_incomplete') {
			return m.native_collection_candidates_identity_incomplete();
		}
		if (reason === 'no_candidates') return m.native_collection_candidates_empty();
		return m.native_collection_candidates_provider_unavailable();
	}

	function capabilityMessage(capability: Capability, kind: Kind): string {
		return capability === 'unsupported'
			? m.native_collection_capability_unsupported({ slot: slotLabel(kind) })
			: m.native_collection_capability_unknown({ slot: slotLabel(kind) });
	}

	function currentUrl(kind: Kind, version: number): string {
		return `/api/collections/${encodeURIComponent(collectionId)}/native/current/${kind}?v=${version}`;
	}

	function candidateUrl(candidateId: string): string {
		return `/api/collections/${encodeURIComponent(collectionId)}/native/candidates/${encodeURIComponent(candidateId)}`;
	}

	function errorMessage(code: string): string {
		return code.includes('stale') || code.includes('consumed')
			? m.collection_apply_stale()
			: m.collection_apply_error();
	}

	async function load(id = collectionId): Promise<void> {
		loading = true;
		errorCode = null;
		try {
			const [workspaceResponse, historyResponse] = await Promise.all([
				fetch(`/api/collections/${encodeURIComponent(id)}/native`),
				fetch(`/api/collections/${encodeURIComponent(id)}/native/history`)
			]);
			const workspaceBody = await workspaceResponse.json().catch(() => ({}));
			const historyBody = await historyResponse.json().catch(() => ({}));
			if (!workspaceResponse.ok) {
				errorCode = workspaceBody?.error?.code ?? 'native_collection_load_failed';
				workspace = null;
				return;
			}
			workspace = workspaceBody as Workspace;
			history = historyResponse.ok && Array.isArray(historyBody.entries) ? historyBody.entries : [];
			selected = { poster: null, background: null };
			preview = null;
		} catch {
			errorCode = 'native_collection_load_failed';
			workspace = null;
		} finally {
			loading = false;
		}
	}

	function choose(kind: Kind, candidateId: string): void {
		selected[kind] = selected[kind] === candidateId ? null : candidateId;
		preview = null;
		errorCode = null;
		result = null;
	}

	async function previewApply(): Promise<void> {
		if (busy || selectedCount === 0) return;
		busy = true;
		errorCode = null;
		preview = null;
		result = null;
		try {
			const selections = Object.fromEntries(
				(['poster', 'background'] as const).flatMap((kind) =>
					selected[kind] ? [[kind, selected[kind]] as const] : []
				)
			);
			const response = await fetch(
				`/api/collections/${encodeURIComponent(collectionId)}/native/preview`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ selections })
				}
			);
			const body = await response.json().catch(() => ({}));
			if (!response.ok) {
				errorCode = body?.error?.code ?? 'native_collection_preview_failed';
				return;
			}
			preview = body as ApplyPreview;
		} catch {
			errorCode = 'native_collection_preview_failed';
		} finally {
			busy = false;
		}
	}

	async function confirmApply(): Promise<void> {
		if (busy || !preview?.planId || !preview.digest) return;
		busy = true;
		errorCode = null;
		const frozen = preview;
		try {
			const response = await fetch(
				`/api/collections/${encodeURIComponent(collectionId)}/native/apply`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ planId: frozen.planId, digest: frozen.digest })
				}
			);
			const body = await response.json().catch(() => ({}));
			if (!response.ok || !body.summary) {
				errorCode = body?.error?.code ?? 'native_collection_apply_failed';
				preview = null;
				return;
			}
			result = {
				status: body.status,
				succeeded: Number(body.summary.succeeded ?? 0),
				failed: Number(body.summary.failed ?? 0)
			};
			await load();
		} catch {
			errorCode = 'native_collection_apply_failed';
		} finally {
			busy = false;
		}
	}

	async function previewUndo(scope: { kind: 'group' | 'revision'; id: string }): Promise<void> {
		if (busy) return;
		busy = true;
		errorCode = null;
		try {
			const response = await fetch(
				`/api/collections/${encodeURIComponent(collectionId)}/native/undo`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						scope:
							scope.kind === 'group'
								? { kind: 'group', revisionGroupId: scope.id }
								: { kind: 'revision', revisionId: scope.id }
					})
				}
			);
			const body = await response.json().catch(() => ({}));
			if (!response.ok || !body.preview) {
				errorCode = body?.error?.code ?? 'native_collection_undo_failed';
				return;
			}
			undoPreview = body.preview as UndoPreview;
			undoLabel =
				scope.kind === 'group'
					? m.native_collection_undo_group_scope()
					: m.native_collection_undo_revision_scope();
			undoOpen = true;
		} catch {
			errorCode = 'native_collection_undo_failed';
		} finally {
			busy = false;
		}
	}

	async function confirmUndo(): Promise<void> {
		if (busy || !undoPreview) return;
		busy = true;
		errorCode = null;
		try {
			const response = await fetch(
				`/api/collections/${encodeURIComponent(collectionId)}/native/undo`,
				{
					method: 'PUT',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ planId: undoPreview.planId, digest: undoPreview.digest })
				}
			);
			const body = await response.json().catch(() => ({}));
			if (!body.result?.summary) {
				errorCode = body?.error?.code ?? 'native_collection_undo_failed';
				return;
			}
			result = {
				status: body.result.status,
				succeeded: Number(body.result.summary.succeeded ?? 0),
				failed: Number(body.result.summary.failed ?? 0)
			};
			undoOpen = false;
			undoPreview = null;
			await load();
		} catch {
			errorCode = 'native_collection_undo_failed';
		} finally {
			busy = false;
		}
	}
</script>

<section
	class="surface overflow-hidden"
	aria-labelledby="native-collection-title"
	aria-busy={loading || busy}
>
	<header
		class="border-b border-neutral-800 bg-gradient-to-r from-accent-950/25 to-transparent px-5 py-4"
	>
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div>
				<p class="text-[11px] font-medium tracking-[0.14em] text-accent-300 uppercase">
					{m.native_collection_badge()}
				</p>
				<h2 id="native-collection-title" class="mt-1 text-lg font-semibold tracking-tight">
					{m.native_collection_title()}
				</h2>
				<p class="mt-1 max-w-3xl text-sm text-neutral-400">{m.native_collection_hint()}</p>
			</div>
			<span class="badge badge-info">{m.collection_apply_review_first()}</span>
		</div>
	</header>

	<div class="p-5">
		{#if loading}
			<p class="text-sm text-neutral-400" role="status">{m.native_collection_loading()}</p>
		{:else if errorCode && !workspace}
			<p class="text-sm text-red-300" role="alert">{errorMessage(errorCode)}</p>
		{:else if workspace && !workspace.entity.available}
			<div class="rounded-lg border border-neutral-800 bg-neutral-950/50 p-4">
				<p class="text-sm text-neutral-300">{entityMessage(workspace.entity.reason)}</p>
				<p class="mt-2 text-xs text-neutral-500">{m.native_collection_member_unaffected()}</p>
			</div>
		{:else if workspace}
			{#if !workspace.candidateSource.available}
				<p
					class="mb-4 rounded-lg border border-neutral-800 bg-neutral-950/50 p-3 text-xs text-neutral-400"
				>
					{candidateSourceMessage(workspace.candidateSource.reason)}
				</p>
			{/if}

			<div class="space-y-6">
				{#each workspace.slots as entry (entry.kind)}
					<article aria-labelledby={`native-slot-${entry.kind}`}>
						<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
							<h3 id={`native-slot-${entry.kind}`} class="text-sm font-semibold text-neutral-200">
								{slotLabel(entry.kind)}
							</h3>
							<span
								class={entry.capability === 'supported'
									? 'badge badge-changed'
									: 'badge badge-muted'}
							>
								{entry.capability === 'supported'
									? m.item_history_server()
									: entry.capability === 'unsupported'
										? m.collection_consistency_unknown()
										: m.item_history_pending()}
							</span>
						</div>

						{#if entry.capability !== 'supported'}
							<p class="mb-3 text-xs text-amber-300">
								{capabilityMessage(entry.capability, entry.kind)}
							</p>
						{:else if entry.current.state === 'unavailable'}
							<p class="mb-3 text-xs text-amber-300">
								{m.native_collection_current_unavailable({ slot: slotLabel(entry.kind) })}
							</p>
						{/if}

						<div class="flex gap-3 overflow-x-auto pb-2">
							<div class={`shrink-0 ${entry.kind === 'poster' ? 'w-32' : 'w-48'}`}>
								<p class="mb-1.5 text-[10px] font-medium tracking-wide text-neutral-500 uppercase">
									{m.collection_current()}
								</p>
								<div
									class={`overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 ${entry.kind === 'poster' ? 'aspect-[2/3]' : 'aspect-video'}`}
								>
									{#if entry.current.hasPreview}
										<img
											src={currentUrl(entry.kind, entry.current.artworkVersion)}
											alt={m.native_collection_current_alt({ slot: slotLabel(entry.kind) })}
											class="h-full w-full object-cover"
										/>
									{:else}
										<span
											class="flex h-full items-center justify-center p-3 text-center text-[11px] text-neutral-600"
										>
											{m.collection_no_artwork()}
										</span>
									{/if}
								</div>
							</div>

							{#each entry.candidates as candidate, index (candidate.id)}
								<button
									type="button"
									class={`group relative shrink-0 overflow-hidden rounded-lg border text-left transition-colors ${entry.kind === 'poster' ? 'aspect-[2/3] w-32' : 'aspect-video w-56'} ${selected[entry.kind] === candidate.id ? 'border-accent-400 ring-2 ring-accent-600/50' : 'border-neutral-800 hover:border-neutral-600'}`}
									disabled={entry.capability !== 'supported' ||
										entry.current.state === 'unavailable'}
									aria-pressed={selected[entry.kind] === candidate.id}
									aria-label={m.native_collection_select_candidate({
										slot: slotLabel(entry.kind),
										rank: index + 1
									})}
									onclick={() => choose(entry.kind, candidate.id)}
								>
									<img
										src={candidateUrl(candidate.id)}
										alt={m.native_collection_candidate_alt({
											slot: slotLabel(entry.kind),
											rank: index + 1
										})}
										loading="lazy"
										class="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
									/>
									<span
										class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-2 pt-6 pb-2 text-[10px] text-neutral-200"
									>
										{candidateProviderLabel(candidate.provider)}{candidate.language
											? ` · ${candidate.language}`
											: ''}
									</span>
									{#if selected[entry.kind] === candidate.id}
										<span class="badge badge-mediux absolute top-2 right-2">
											{m.native_collection_selected()}
										</span>
									{/if}
								</button>
							{/each}
						</div>
					</article>
				{/each}
			</div>

			<div class="mt-5 border-t border-neutral-800 pt-4">
				<div class="flex flex-wrap items-center gap-3">
					<button
						type="button"
						class="btn btn-accent"
						disabled={busy || selectedCount === 0}
						onclick={previewApply}
					>
						{busy ? m.collection_apply_previewing() : m.collection_apply_preview()}
					</button>
					<p class="text-xs text-neutral-500">{m.native_collection_member_unaffected()}</p>
				</div>
				{#if errorCode}
					<p class="mt-3 text-sm text-red-300" role="alert">{errorMessage(errorCode)}</p>
				{/if}
				{#if result}
					<p
						class={`mt-3 text-sm ${result.failed ? 'text-amber-300' : 'text-emerald-300'}`}
						role="status"
					>
						{result.failed
							? m.native_collection_apply_partial({
									succeeded: result.succeeded,
									failed: result.failed
								})
							: m.native_collection_apply_success()}
					</p>
				{/if}
			</div>

			{#if preview}
				<div class="mt-4 rounded-xl border border-accent-900/60 bg-accent-950/15 p-4">
					<h3 class="text-sm font-semibold">{m.native_collection_preview_title()}</h3>
					<p class="mt-1 text-xs text-neutral-400">
						{m.native_collection_preview_summary({
							writes: preview.summary.operationCount,
							skips: preview.summary.skipCount
						})}
					</p>
					{#if preview.summary.operationCount === 0}
						<p class="mt-3 text-sm text-amber-300">{m.native_collection_preview_no_writes()}</p>
					{:else}
						<ul class="mt-3 flex flex-wrap gap-2">
							{#each preview.operations as operation (operation.id)}
								<li class="badge badge-muted">
									{slotLabel(operation.kind)} · {operation.expectedOverwrite
										? m.collection_current()
										: m.collection_no_artwork()}
								</li>
							{/each}
						</ul>
					{/if}
					<div class="mt-4 flex flex-wrap gap-2">
						<button
							type="button"
							class="btn btn-accent"
							disabled={busy || !preview.planId}
							onclick={confirmApply}
						>
							{busy ? m.collection_apply_confirming() : m.collection_apply_confirm()}
						</button>
						<button
							type="button"
							class="btn btn-ghost"
							disabled={busy}
							onclick={() => (preview = null)}
						>
							{m.automation_cancel()}
						</button>
					</div>
				</div>
			{/if}

			<div class="mt-7 border-t border-neutral-800 pt-5">
				<h3 class="text-sm font-semibold">{m.native_collection_history_title()}</h3>
				{#if historyGroups.length === 0}
					<p class="mt-2 text-sm text-neutral-500">{m.native_collection_history_empty()}</p>
				{:else}
					<ul class="mt-3 space-y-2">
						{#each historyGroups as group (group.id)}
							<li class="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
								<div class="flex flex-wrap items-center justify-between gap-3">
									<div>
										<p class="text-xs font-medium text-neutral-200">{date(group.createdAt)}</p>
										<p class="mt-1 text-[11px] text-neutral-500">{statusLabel(group.outcome)}</p>
									</div>
									{#if group.entries.some((entry) => entry.undoAvailable)}
										<button
											type="button"
											class="btn btn-ghost px-3 py-1.5 text-xs"
											disabled={busy}
											onclick={() => previewUndo({ kind: 'group', id: group.id })}
										>
											{m.collection_undo_group()}
										</button>
									{/if}
								</div>
								<ul class="mt-3 space-y-1 border-t border-neutral-800 pt-3">
									{#each group.entries as entry (entry.id)}
										<li class="flex flex-wrap items-center justify-between gap-3 py-1">
											<div class="flex flex-wrap items-center gap-2">
												<span class="text-xs text-neutral-300">
													{m.native_collection_history_entry({
														slot: slotLabel(entry.kind),
														status: statusLabel(entry.outcome)
													})}
												</span>
												{#if entry.restored}<span class="badge badge-changed"
														>{m.collection_history_restored()}</span
													>{/if}
											</div>
											{#if entry.undoAvailable}
												<button
													type="button"
													class="btn btn-ghost px-2.5 py-1 text-[11px]"
													disabled={busy}
													onclick={() => previewUndo({ kind: 'revision', id: entry.id })}
												>
													{m.collection_undo_revision()}
												</button>
											{/if}
										</li>
									{/each}
								</ul>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	</div>
</section>

<ArtworkUndoDialog
	open={undoOpen}
	{busy}
	preview={undoPreview}
	contextLabel={undoLabel}
	onConfirm={confirmUndo}
	onCancel={() => {
		undoOpen = false;
		undoPreview = null;
	}}
/>
