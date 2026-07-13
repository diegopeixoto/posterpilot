<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { tick } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { readLocaleNeutralApiError } from '$lib/i18n/api-errors';

	type MediaType = 'movie' | 'tv';
	type SearchType = MediaType | 'both';

	type MatchItem = {
		id: number;
		serverInstanceId: string;
		title: string;
		year: number | null;
		type: 'movie' | 'show';
		tmdbId: string | null;
		mediaType: MediaType | null;
		resolved: boolean;
		resolutionReason: string | null;
		manualMatchPinned: boolean;
		resolutionUpdatedAt: string | Date | null;
	};

	type Candidate = {
		tmdbId: string;
		mediaType: MediaType;
		title: string;
		originalTitle: string | null;
		year: number | null;
		overview: string | null;
		posterUrl: string | null;
	};

	type Resolution = {
		tmdbId: string | null;
		mediaType: MediaType | null;
		resolved: boolean;
		resolutionReason: string | null;
		manualMatchPinned: boolean;
		resolutionUpdatedAt: string | Date | null;
	};

	type AuditEntry = {
		id: number;
		action: string;
		previousTmdbId: string | null;
		resultingTmdbId: string | null;
		reason: string;
		userConfirmed: boolean;
		createdAt: string | Date;
	};

	let {
		item,
		locale,
		onChanged
	}: { item: MatchItem; locale: string; onChanged?: () => void | Promise<void> } = $props();

	// svelte-ignore state_referenced_locally
	let loadedItemId = $state(item.id);
	// svelte-ignore state_referenced_locally
	let current = $state<Resolution>({
		tmdbId: item.tmdbId,
		mediaType: item.mediaType,
		resolved: item.resolved,
		resolutionReason: item.resolutionReason,
		manualMatchPinned: item.manualMatchPinned,
		resolutionUpdatedAt: item.resolutionUpdatedAt
	});
	// svelte-ignore state_referenced_locally
	let query = $state(item.title);
	// svelte-ignore state_referenced_locally
	let year = $state(item.year ? String(item.year) : '');
	// svelte-ignore state_referenced_locally
	let searchType = $state<SearchType>(item.type === 'movie' ? 'movie' : 'tv');
	let open = $state(false);
	let searching = $state(false);
	let saving = $state(false);
	let searched = $state(false);
	let results = $state<Candidate[]>([]);
	let selected = $state<Candidate | null>(null);
	let errorCode = $state<string | null>(null);
	let errorReference = $state<string | null>(null);
	let successMessage = $state<string | null>(null);
	let confirmingClear = $state(false);
	let audits = $state<AuditEntry[]>([]);
	let auditLoading = $state(false);
	let trigger = $state<HTMLButtonElement>();
	let searchInput = $state<HTMLInputElement>();

	$effect(() => {
		if (item.id === loadedItemId) return;
		loadedItemId = item.id;
		current = {
			tmdbId: item.tmdbId,
			mediaType: item.mediaType,
			resolved: item.resolved,
			resolutionReason: item.resolutionReason,
			manualMatchPinned: item.manualMatchPinned,
			resolutionUpdatedAt: item.resolutionUpdatedAt
		};
		query = item.title;
		year = item.year ? String(item.year) : '';
		searchType = item.type === 'movie' ? 'movie' : 'tv';
		open = false;
		results = [];
		selected = null;
		audits = [];
	});

	const endpoint = $derived(
		`/api/servers/${encodeURIComponent(item.serverInstanceId)}/items/${item.id}/tmdb`
	);

	function mediaLabel(type: MediaType | null): string {
		return type === 'tv' ? m.manual_match_type_show() : m.manual_match_type_movie();
	}

	function errorMessage(code: string | null): string | null {
		if (!code) return null;
		switch (code) {
			case 'invalid_request':
				return m.manual_match_error_invalid();
			case 'media_item_not_found':
				return m.manual_match_error_not_found();
			case 'tmdb_not_configured':
				return m.manual_match_error_not_configured();
			case 'tmdb_candidate_unavailable':
				return m.manual_match_error_candidate_unavailable();
			case 'tmdb_unavailable':
				return m.manual_match_error_unavailable();
			case 'manual_pin_not_found':
				return m.manual_match_error_pin_missing();
			default:
				return m.manual_match_error_generic();
		}
	}

	function auditAction(action: string): string {
		switch (action) {
			case 'pinned':
				return m.manual_match_audit_pinned();
			case 'replaced':
				return m.manual_match_audit_replaced();
			case 'cleared':
				return m.manual_match_audit_cleared();
			case 'unresolved':
				return m.manual_match_audit_unresolved();
			default:
				return m.manual_match_audit_resolved();
		}
	}

	function formatDate(value: string | Date | null): string {
		if (!value) return '—';
		return new Date(value).toLocaleString(locale);
	}

	function thumb(url: string): string {
		return `/api/thumb?url=${encodeURIComponent(url)}`;
	}

	async function readError(response: Response): Promise<string> {
		const parsed = readLocaleNeutralApiError(await response.json().catch(() => ({})));
		errorReference = parsed.correlationId;
		return parsed.code;
	}

	async function loadAudit() {
		auditLoading = true;
		try {
			const response = await fetch(`${endpoint}/audit`);
			if (!response.ok) return;
			const body = (await response.json()) as { entries: AuditEntry[] };
			audits = body.entries;
		} finally {
			auditLoading = false;
		}
	}

	async function toggleOpen() {
		open = !open;
		confirmingClear = false;
		errorCode = null;
		errorReference = null;
		selected = null;
		if (open) {
			void loadAudit();
			await tick();
			searchInput?.focus();
		} else {
			await tick();
			trigger?.focus();
		}
	}

	async function search() {
		if (searching || !query.trim()) return;
		errorReference = null;
		const parsedYear = year.trim() ? Number(year) : undefined;
		if (
			parsedYear !== undefined &&
			(!Number.isInteger(parsedYear) || parsedYear < 1800 || parsedYear > 9999)
		) {
			errorCode = 'invalid_request';
			return;
		}
		searching = true;
		searched = false;
		results = [];
		selected = null;
		errorCode = null;
		errorReference = null;
		successMessage = null;
		const params = new URLSearchParams({ q: query.trim(), type: searchType });
		if (parsedYear !== undefined) params.set('year', String(parsedYear));
		try {
			const response = await fetch(`${endpoint}/search?${params}`);
			if (!response.ok) {
				errorCode = await readError(response);
				return;
			}
			const body = (await response.json()) as { results: Candidate[] };
			results = body.results;
			searched = true;
		} catch {
			errorCode = 'tmdb_unavailable';
		} finally {
			searching = false;
		}
	}

	async function confirmSelection() {
		if (!selected || saving) return;
		saving = true;
		errorCode = null;
		errorReference = null;
		try {
			const response = await fetch(`${endpoint}/pin`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ tmdbId: selected.tmdbId, mediaType: selected.mediaType })
			});
			if (!response.ok) {
				errorCode = await readError(response);
				return;
			}
			const body = (await response.json()) as { item: Resolution };
			current = body.item;
			successMessage = m.manual_match_saved();
			selected = null;
			results = [];
			searched = false;
			await loadAudit();
			await invalidateAll();
			await onChanged?.();
		} catch {
			errorCode = 'tmdb_unavailable';
		} finally {
			saving = false;
		}
	}

	async function clearPin() {
		if (!confirmingClear) {
			confirmingClear = true;
			return;
		}
		if (saving) return;
		saving = true;
		errorCode = null;
		errorReference = null;
		try {
			const response = await fetch(`${endpoint}/pin`, { method: 'DELETE' });
			if (!response.ok) {
				errorCode = await readError(response);
				return;
			}
			const body = (await response.json()) as {
				item: Resolution;
				automaticResolution: { status: string };
			};
			current = body.item;
			successMessage =
				body.automaticResolution.status === 'resolved'
					? m.manual_match_cleared_resolved()
					: body.automaticResolution.status === 'unresolved'
						? m.manual_match_cleared_unresolved()
						: m.manual_match_cleared_eligible();
			confirmingClear = false;
			await loadAudit();
			await invalidateAll();
			await onChanged?.();
		} catch {
			errorCode = 'tmdb_unavailable';
		} finally {
			saving = false;
		}
	}
</script>

<section class="surface mt-6 p-4" aria-labelledby={`manual-match-title-${item.id}`}>
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h2 id={`manual-match-title-${item.id}`} class="text-sm font-semibold">
				{m.manual_match_title()}
			</h2>
			{#if current.tmdbId}
				<p class="mt-1 text-xs text-neutral-400">
					{current.manualMatchPinned
						? m.manual_match_current_manual({
								type: mediaLabel(current.mediaType),
								id: current.tmdbId
							})
						: m.manual_match_current_automatic({
								type: mediaLabel(current.mediaType),
								id: current.tmdbId
							})}
				</p>
			{:else}
				<p class="mt-1 text-xs text-amber-300">{m.manual_match_current_unresolved()}</p>
			{/if}
		</div>
		<button
			bind:this={trigger}
			type="button"
			class="btn btn-ghost"
			aria-expanded={open}
			onclick={toggleOpen}
		>
			{open
				? m.manual_match_close()
				: current.tmdbId
					? m.manual_match_replace()
					: m.manual_match_find()}
		</button>
	</div>

	{#if successMessage}
		<p class="mt-3 text-sm text-emerald-300" role="status">{successMessage}</p>
	{/if}

	{#if open}
		<div class="mt-4 border-t border-neutral-800 pt-4">
			<form
				class="grid gap-3 sm:grid-cols-[1fr_7rem_9rem_auto]"
				onsubmit={(event) => {
					event.preventDefault();
					void search();
				}}
			>
				<div>
					<label for={`tmdb-query-${item.id}`} class="mb-1 block text-xs text-neutral-400">
						{m.manual_match_query()}
					</label>
					<input
						bind:this={searchInput}
						id={`tmdb-query-${item.id}`}
						bind:value={query}
						maxlength="200"
						required
						class="input w-full"
					/>
				</div>
				<div>
					<label for={`tmdb-year-${item.id}`} class="mb-1 block text-xs text-neutral-400">
						{m.manual_match_year()}
					</label>
					<input
						id={`tmdb-year-${item.id}`}
						type="number"
						min="1800"
						max="9999"
						bind:value={year}
						class="input w-full"
					/>
				</div>
				<div>
					<label for={`tmdb-type-${item.id}`} class="mb-1 block text-xs text-neutral-400">
						{m.manual_match_media_type()}
					</label>
					<select id={`tmdb-type-${item.id}`} bind:value={searchType} class="input w-full">
						<option value="both">{m.manual_match_type_both()}</option>
						<option value="movie">{m.manual_match_type_movie()}</option>
						<option value="tv">{m.manual_match_type_show()}</option>
					</select>
				</div>
				<button type="submit" class="btn btn-accent self-end" disabled={searching || !query.trim()}>
					{searching ? m.manual_match_searching() : m.manual_match_search()}
				</button>
			</form>

			{#if errorMessage(errorCode)}
				<div class="mt-3 text-sm text-red-300" role="alert">
					<p>{errorMessage(errorCode)}</p>
					{#if errorReference}
						<p class="mt-1 font-mono text-xs text-red-200">
							{m.api_error_reference({ id: errorReference })}
						</p>
					{/if}
				</div>
			{/if}

			{#if searched && results.length === 0}
				<p class="mt-4 text-sm text-neutral-400" role="status">{m.manual_match_empty()}</p>
			{/if}

			{#if results.length}
				<ul class="mt-4 grid gap-3 lg:grid-cols-2" aria-label={m.manual_match_results()}>
					{#each results as candidate (`${candidate.mediaType}:${candidate.tmdbId}`)}
						<li class="flex gap-3 rounded-lg border border-neutral-800 bg-neutral-950/50 p-3">
							<div class="w-16 flex-none overflow-hidden rounded bg-neutral-900">
								{#if candidate.posterUrl}
									<img
										src={thumb(candidate.posterUrl)}
										alt={candidate.title}
										loading="lazy"
										class="aspect-[2/3] h-full w-full object-cover"
									/>
								{:else}
									<div
										class="flex aspect-[2/3] items-center justify-center px-1 text-center text-[10px] text-neutral-500"
									>
										{m.manual_match_no_poster()}
									</div>
								{/if}
							</div>
							<div class="min-w-0 flex-1">
								<div class="flex items-start justify-between gap-2">
									<div>
										<p class="font-medium text-neutral-100">{candidate.title}</p>
										<p class="text-xs text-neutral-400">
											{mediaLabel(candidate.mediaType)} · {candidate.year ??
												m.manual_match_year_unknown()} · TMDB {candidate.tmdbId}
										</p>
									</div>
									<button
										type="button"
										class="btn btn-subtle px-2 py-1 text-xs"
										onclick={() => (selected = candidate)}
									>
										{m.manual_match_select()}
									</button>
								</div>
								{#if candidate.originalTitle && candidate.originalTitle !== candidate.title}
									<p class="mt-1 text-xs text-neutral-500">
										{m.manual_match_original_title({ title: candidate.originalTitle })}
									</p>
								{/if}
								{#if candidate.overview}
									<p class="mt-2 line-clamp-3 text-xs text-neutral-300">{candidate.overview}</p>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}

			{#if selected}
				<div
					class="mt-4 rounded-lg border border-accent-800 bg-accent-950/30 p-4"
					role="alertdialog"
					aria-labelledby={`confirm-match-${item.id}`}
				>
					<h3 id={`confirm-match-${item.id}`} class="text-sm font-semibold">
						{m.manual_match_confirm_title()}
					</h3>
					<p class="mt-1 text-sm text-neutral-300">
						{m.manual_match_confirm_body({ title: selected.title, id: selected.tmdbId })}
					</p>
					<p class="mt-1 text-xs text-neutral-400">{m.manual_match_confirm_hint()}</p>
					<div class="mt-3 flex gap-2">
						<button
							type="button"
							class="btn btn-accent"
							disabled={saving}
							onclick={confirmSelection}
						>
							{saving ? m.manual_match_saving() : m.manual_match_confirm()}
						</button>
						<button
							type="button"
							class="btn btn-ghost"
							disabled={saving}
							onclick={() => (selected = null)}
						>
							{m.manual_match_cancel()}
						</button>
					</div>
				</div>
			{/if}

			{#if current.manualMatchPinned}
				<div class="mt-5 border-t border-neutral-800 pt-4">
					<p class="text-sm font-medium">{m.manual_match_clear_title()}</p>
					<p class="mt-1 text-xs text-neutral-400">{m.manual_match_clear_hint()}</p>
					<div class="mt-2 flex items-center gap-2">
						<button
							type="button"
							class={confirmingClear ? 'btn bg-red-900/50 text-red-200' : 'btn btn-ghost'}
							disabled={saving}
							onclick={clearPin}
						>
							{confirmingClear ? m.manual_match_clear_confirm() : m.manual_match_clear()}
						</button>
						{#if confirmingClear}
							<button type="button" class="btn btn-ghost" onclick={() => (confirmingClear = false)}>
								{m.manual_match_cancel()}
							</button>
						{/if}
					</div>
				</div>
			{/if}

			<details class="mt-5 border-t border-neutral-800 pt-4">
				<summary class="cursor-pointer text-sm text-neutral-300">{m.manual_match_history()}</summary
				>
				{#if auditLoading}
					<p class="mt-2 text-xs text-neutral-400">{m.manual_match_loading_history()}</p>
				{:else if audits.length === 0}
					<p class="mt-2 text-xs text-neutral-400">{m.manual_match_no_history()}</p>
				{:else}
					<ol class="mt-2 space-y-2">
						{#each [...audits].reverse() as audit (audit.id)}
							<li class="text-xs text-neutral-400">
								<span class="font-medium text-neutral-200">{auditAction(audit.action)}</span>
								{#if audit.resultingTmdbId}
									· TMDB {audit.resultingTmdbId}{/if}
								· {formatDate(audit.createdAt)}
							</li>
						{/each}
					</ol>
				{/if}
			</details>
		</div>
	{/if}
</section>
