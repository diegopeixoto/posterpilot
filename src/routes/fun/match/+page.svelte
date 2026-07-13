<script lang="ts">
	import { goto } from '$app/navigation';
	import { m } from '$lib/paraglide/messages';
	import {
		choosePosterMatchWinner,
		createPosterMatch,
		markPosterMatchUnavailable
	} from '$lib/fun-poster-match';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	// svelte-ignore state_referenced_locally
	let match = $state(createPosterMatch(data.candidates, data.seed));
	let staging = $state(false);
	let staged = $state(false);
	let stageError = $state(false);
	let matchKey = $state('');

	$effect(() => {
		const nextKey = `${data.selectedItem?.id ?? 'none'}:${data.seed}`;
		if (nextKey !== matchKey) {
			matchKey = nextKey;
			match = createPosterMatch(data.candidates, data.seed);
			staged = false;
			stageError = false;
		}
	});

	const byId = $derived(new Map(data.candidates.map((candidate) => [candidate.id, candidate])));
	const pair = $derived(match.current?.map((id) => byId.get(id)).filter(Boolean) ?? []);
	const winner = $derived(match.winnerId ? (byId.get(match.winnerId) ?? null) : null);

	function choose(id: number) {
		match = choosePosterMatchWinner(match, id);
	}

	function unavailable(id: number) {
		match = markPosterMatchUnavailable(match, id);
	}

	function restart() {
		match = createPosterMatch(data.candidates, Date.now().toString(36));
		staged = false;
		stageError = false;
	}

	async function stageWinner() {
		if (!winner || !data.selectedItem || staging) return;
		staging = true;
		stageError = false;
		try {
			const response = await fetch(`/api/items/${data.selectedItem.id}/select`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ posterUrl: winner.url, posterCandidateId: winner.id })
			});
			if (!response.ok) throw new Error(String(response.status));
			staged = true;
		} catch {
			stageError = true;
		} finally {
			staging = false;
		}
	}
</script>

<svelte:head><title>{m.fun_match_title()} · PosterPilot</title></svelte:head>

<section class="space-y-6">
	<header>
		<h2 class="text-xl font-semibold tracking-tight text-white">{m.fun_match_title()}</h2>
		<p class="mt-1 text-sm text-neutral-400">{m.fun_match_subtitle()}</p>
	</header>

	<form method="GET" action="/fun/match" class="surface flex flex-wrap items-end gap-3 p-5">
		<label class="min-w-64 flex-1">
			<span class="mb-1 block text-xs text-neutral-400">{m.fun_match_item()}</span>
			<select
				name="item"
				value={data.selectedItem?.id ?? ''}
				aria-label={m.fun_match_item()}
				class="input w-full"
				required
			>
				<option value="" disabled>{m.fun_match_choose_item()}</option>
				{#each data.items as item (item.id)}
					<option value={item.id}>{item.title} {item.year ? `(${item.year})` : ''}</option>
				{/each}
			</select>
		</label>
		<input type="hidden" name="seed" value={data.seed} />
		<button type="submit" class="btn btn-accent">{m.fun_match_start()}</button>
	</form>

	{#if data.items.length === 0}
		<div class="surface p-8 text-center text-sm text-neutral-400">{m.fun_match_no_items()}</div>
	{:else if data.selectedItem && pair.length === 2}
		<div
			class="flex flex-wrap items-center justify-between gap-3 text-sm text-neutral-400"
			role="status"
			aria-live="polite"
			aria-atomic="true"
		>
			<span>{m.fun_match_round({ round: match.round })}</span>
			<span
				>{m.fun_match_progress({ done: match.completedMatches, total: match.totalMatches })}</span
			>
		</div>
		<div class="grid gap-4 sm:grid-cols-2" role="group" aria-label={m.fun_match_title()}>
			{#each pair as candidate (candidate!.id)}
				<button
					type="button"
					onclick={() => choose(candidate!.id)}
					aria-label={m.item_candidate_label({
						kind: m.item_poster(),
						provider: candidate!.provider
					})}
					class="surface group overflow-hidden text-left transition hover:border-accent-600 focus-visible:border-accent-500"
				>
					<div class="aspect-[2/3] overflow-hidden bg-neutral-950">
						<img
							src={`/api/thumb?url=${encodeURIComponent(candidate!.url)}`}
							alt=""
							onerror={() => unavailable(candidate!.id)}
							class="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
						/>
					</div>
					<div class="flex items-center justify-between gap-3 p-3 text-xs text-neutral-400">
						<span>{candidate!.provider}</span>
						<span>{candidate!.setAuthor ?? m.item_set_unattributed()}</span>
					</div>
				</button>
			{/each}
		</div>
	{:else if data.selectedItem && winner}
		<div class="surface mx-auto max-w-md overflow-hidden border-accent-800" aria-busy={staging}>
			<img
				src={`/api/thumb?url=${encodeURIComponent(winner.url)}`}
				alt={m.fun_match_winner()}
				class="aspect-[2/3] w-full object-cover"
			/>
			<div class="space-y-3 p-5 text-center">
				<h3 class="text-lg font-semibold text-white">{m.fun_match_winner()}</h3>
				<p class="text-sm text-neutral-400">{m.fun_match_stage_hint()}</p>
				<div class="flex flex-wrap justify-center gap-2">
					<button
						type="button"
						onclick={stageWinner}
						disabled={staging || staged}
						class="btn btn-accent"
					>
						{staged ? m.fun_match_staged() : staging ? m.item_working() : m.fun_match_stage()}
					</button>
					<button type="button" onclick={restart} class="btn btn-ghost"
						>{m.fun_match_restart()}</button
					>
					<button type="button" onclick={() => goto('/fun')} class="btn btn-ghost"
						>{m.fun_match_abandon()}</button
					>
				</div>
				{#if stageError}<p role="alert" class="text-sm text-red-300">
						{m.library_action_failed()}
					</p>{/if}
				{#if staged}<p role="status" class="sr-only">{m.fun_match_staged()}</p>{/if}
			</div>
		</div>
	{:else if data.selectedItem}
		<div class="surface p-8 text-center text-sm text-neutral-400">{m.fun_match_unavailable()}</div>
	{/if}
</section>
