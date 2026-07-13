<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages';

	type Destination = 'server' | 'kometa';
	type ArtworkKind = 'poster' | 'background' | 'title_card';
	type Outcome = 'pending' | 'success' | 'partial' | 'failed' | 'skipped';
	type Verification = 'pending' | 'exact' | 'best_effort' | 'unavailable' | 'mismatch' | 'failed';

	interface Entry {
		group: {
			id: string;
			kind: 'apply' | 'undo' | 'external_observation';
			outcome: 'pending' | 'success' | 'partial' | 'failed';
			createdAt: string;
		};
		revision: {
			id: string;
			action: 'apply' | 'undo' | 'external_observation';
			destination: Destination;
			kind: ArtworkKind;
			season: number | null;
			episode: number | null;
			sourceProvider: string | null;
			outcome: Exclude<Outcome, 'partial'>;
			verification: Verification;
			error: { code: string } | null;
			originalProtected: boolean;
			undoAvailable: boolean;
			createdAt: string;
		};
	}

	let {
		itemId,
		locale,
		refreshToken = 0,
		onUndoItem,
		onUndoRevision,
		onUndoAvailabilityChange
	}: {
		itemId: number;
		locale: string;
		refreshToken?: number;
		onUndoItem?: () => void;
		onUndoRevision?: (revisionId: string) => void;
		onUndoAvailabilityChange?: (available: boolean) => void;
	} = $props();
	let entries = $state<Entry[]>([]);
	let cursor = $state<string | null>(null);
	let destination = $state<'' | Destination>('');
	let kind = $state<'' | ArtworkKind>('');
	let loading = $state(false);
	let failed = $state(false);
	let mounted = $state(false);
	let requestKey = $state('');

	const groups = $derived.by(() => {
		const grouped = new Map<string, { group: Entry['group']; revisions: Entry['revision'][] }>();
		for (const entry of entries) {
			let group = grouped.get(entry.group.id);
			if (!group) {
				group = { group: entry.group, revisions: [] };
				grouped.set(entry.group.id, group);
			}
			group.revisions.push(entry.revision);
		}
		return [...grouped.values()];
	});
	const canUndoAny = $derived(entries.some((entry) => entry.revision.undoAvailable));
	let reportedUndoAvailability = $state<boolean | null>(null);

	$effect(() => {
		if (reportedUndoAvailability === canUndoAny) return;
		reportedUndoAvailability = canUndoAny;
		onUndoAvailabilityChange?.(canUndoAny);
	});

	function outcomeLabel(outcome: Outcome): string {
		switch (outcome) {
			case 'success':
				return m.item_history_success();
			case 'partial':
				return m.item_history_partial();
			case 'failed':
				return m.item_history_failed();
			case 'skipped':
				return m.item_history_skipped();
			default:
				return m.item_history_pending();
		}
	}

	function actionLabel(action: Entry['revision']['action']): string {
		if (action === 'undo') return m.item_history_action_undo();
		if (action === 'external_observation') return m.item_history_action_external();
		return m.item_history_action_apply();
	}

	function kindLabel(value: ArtworkKind): string {
		if (value === 'background') return m.item_backdrop();
		if (value === 'title_card') return m.item_title_card();
		return m.item_poster();
	}

	function scopeLabel(revision: Entry['revision']): string {
		if (revision.season === null) return m.item_history_root_scope();
		if (revision.episode !== null) {
			return m.item_history_episode_scope({
				season: revision.season,
				episode: revision.episode
			});
		}
		return m.item_season_label({ number: revision.season });
	}

	function verificationLabel(value: Verification): string {
		switch (value) {
			case 'exact':
				return m.item_history_verification_exact();
			case 'best_effort':
				return m.item_history_verification_best_effort();
			case 'unavailable':
				return m.item_history_verification_unavailable();
			case 'mismatch':
				return m.item_history_verification_mismatch();
			case 'failed':
				return m.item_history_verification_failed();
			default:
				return m.item_history_pending();
		}
	}

	function badgeClass(outcome: Outcome): string {
		if (outcome === 'success') return 'badge-changed';
		if (outcome === 'failed') return 'border-red-800 bg-red-950/60 text-red-200';
		if (outcome === 'partial') return 'border-amber-800 bg-amber-950/60 text-amber-200';
		return 'border-neutral-700 bg-neutral-900 text-neutral-300';
	}

	function formatDate(value: string): string {
		return new Intl.DateTimeFormat(locale, {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(value));
	}

	async function load(reset = false): Promise<void> {
		if (loading) return;
		loading = true;
		failed = false;
		try {
			const params = new URLSearchParams({ limit: '20' });
			if (destination) params.set('destination', destination);
			if (kind) params.set('kind', kind);
			if (!reset && cursor) params.set('cursor', cursor);
			const response = await fetch(`/api/items/${itemId}/revisions?${params}`);
			if (!response.ok) throw new Error('history_request_failed');
			const page = (await response.json()) as { entries?: Entry[]; nextCursor?: string | null };
			entries = reset ? (page.entries ?? []) : [...entries, ...(page.entries ?? [])];
			cursor = page.nextCursor ?? null;
		} catch {
			failed = true;
			if (reset) entries = [];
		} finally {
			loading = false;
		}
	}

	function refresh(): void {
		cursor = null;
		void load(true);
	}

	onMount(() => {
		mounted = true;
		requestKey = `${itemId}:${refreshToken}`;
		refresh();
	});

	$effect(() => {
		const nextKey = `${itemId}:${refreshToken}`;
		if (!mounted || nextKey === requestKey) return;
		requestKey = nextKey;
		refresh();
	});
</script>

<section class="mt-6 scroll-mt-20" aria-labelledby="artwork-history-title">
	<div class="mb-3 flex flex-wrap items-end justify-between gap-3">
		<div>
			<h2 id="artwork-history-title" class="section-title">{m.item_history_title()}</h2>
			<p class="mt-1 text-xs text-neutral-400">{m.item_history_hint()}</p>
		</div>
		<div class="flex flex-wrap gap-2">
			{#if canUndoAny && onUndoItem}
				<button type="button" class="btn btn-ghost py-1.5 text-xs" onclick={onUndoItem}>
					{m.item_undo_item()}
				</button>
			{/if}
			<label class="text-xs text-neutral-300">
				<span class="sr-only">{m.item_history_filter_destination()}</span>
				<select bind:value={destination} onchange={refresh} class="input py-1.5 text-xs">
					<option value="">{m.item_history_all_destinations()}</option>
					<option value="server">{m.item_history_server()}</option>
					<option value="kometa">Kometa</option>
				</select>
			</label>
			<label class="text-xs text-neutral-300">
				<span class="sr-only">{m.item_history_filter_kind()}</span>
				<select bind:value={kind} onchange={refresh} class="input py-1.5 text-xs">
					<option value="">{m.item_history_all_artwork()}</option>
					<option value="poster">{m.item_poster()}</option>
					<option value="background">{m.item_backdrop()}</option>
					<option value="title_card">{m.item_title_card()}</option>
				</select>
			</label>
		</div>
	</div>

	{#if loading && entries.length === 0}
		<div class="surface p-5 text-sm text-neutral-300" role="status">
			{m.item_history_loading()}
		</div>
	{:else if failed && entries.length === 0}
		<div class="surface p-5" role="alert">
			<p class="text-sm text-red-200">{m.item_history_error()}</p>
			<button type="button" class="btn btn-ghost mt-3" onclick={refresh}
				>{m.item_history_retry()}</button
			>
		</div>
	{:else if groups.length === 0}
		<div class="surface p-5 text-sm text-neutral-400">{m.item_history_empty()}</div>
	{:else}
		<div class="space-y-3">
			{#each groups as block (block.group.id)}
				<article class="surface overflow-hidden">
					<header class="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-4 py-3">
						<strong class="text-sm text-neutral-100"
							>{actionLabel(block.revisions[0].action)}</strong
						>
						<span class={`badge ${badgeClass(block.group.outcome)}`}
							>{outcomeLabel(block.group.outcome)}</span
						>
						<time class="ml-auto text-xs text-neutral-400" datetime={block.group.createdAt}
							>{formatDate(block.group.createdAt)}</time
						>
					</header>
					<ul class="divide-y divide-neutral-800" aria-label={m.item_history_group_entries()}>
						{#each block.revisions as revision (revision.id)}
							<li class="grid gap-2 px-4 py-3 text-xs sm:grid-cols-[minmax(0,1fr)_auto]">
								<div class="min-w-0">
									<p class="font-medium text-neutral-200">
										{revision.destination === 'server' ? m.item_history_server() : 'Kometa'} ·
										{kindLabel(revision.kind)} · {scopeLabel(revision)}
									</p>
									<p class="mt-1 text-neutral-400">
										{verificationLabel(revision.verification)}{#if revision.sourceProvider}
											· {revision.sourceProvider}{/if}
										{#if revision.originalProtected}
											· {m.item_history_original_protected()}{/if}
									</p>
									{#if revision.error}
										<p class="mt-1 text-red-200">{m.item_history_operation_failed()}</p>
									{/if}
								</div>
								<div class="flex items-center justify-end gap-2 self-start">
									{#if revision.undoAvailable && onUndoRevision}
										<button
											type="button"
											class="btn btn-ghost px-2 py-1 text-xs"
											onclick={() => onUndoRevision(revision.id)}
										>
											{m.item_undo_revision()}
										</button>
									{/if}
									<span class={`badge ${badgeClass(revision.outcome)}`}
										>{outcomeLabel(revision.outcome)}</span
									>
								</div>
							</li>
						{/each}
					</ul>
				</article>
			{/each}
		</div>
		{#if cursor}
			<div class="mt-4 text-center">
				<button type="button" class="btn btn-ghost" disabled={loading} onclick={() => load(false)}>
					{loading ? m.item_history_loading() : m.item_history_load_more()}
				</button>
			</div>
		{/if}
		{#if failed}
			<p class="mt-3 text-sm text-red-200" role="alert">{m.item_history_error()}</p>
		{/if}
	{/if}
</section>
