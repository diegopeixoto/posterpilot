<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import CollectionApplyPanel from '$lib/components/CollectionApplyPanel.svelte';
	import CollectionHistoryPanel from '$lib/components/CollectionHistoryPanel.svelte';
	import NativeCollectionArtworkPanel from '$lib/components/NativeCollectionArtworkPanel.svelte';
	import { m } from '$lib/paraglide/messages';
	import type { CollectionArtworkFamily } from '$lib/server/collections/consistency';
	import type {
		CollectionLocalMember,
		CollectionMemberArtworkState
	} from '$lib/server/collections/queries';
	import type {
		PublicCollectionCandidate,
		PublicCollectionFamilySuggestion
	} from '$lib/server/collections/suggestion-store';

	let { data } = $props();

	const heroMember = $derived(
		data.collection.localMembers.find(
			(member) => member.background.current.available || member.background.staged.available
		) ?? data.collection.localMembers[0]
	);
	const stagedCount = $derived(
		data.collection.localMembers.reduce(
			(count, member) =>
				count + Number(member.poster.staged.available) + Number(member.background.staged.available),
			0
		)
	);
	const selectionRevision = $derived(
		data.collection.localMembers
			.map(
				(member) =>
					`${member.id}:${member.poster.staged.version}:${member.background.staged.version}`
			)
			.join('|')
	);
	let familyBusy = $state<string | null>(null);
	let memberBusy = $state<string | null>(null);
	let actionMessage = $state('');
	let actionFailed = $state(false);

	function providerName(provider: string | null): string {
		switch (provider) {
			case 'plex':
				return 'Plex';
			case 'jellyfin':
				return 'Jellyfin';
			case 'emby':
				return 'Emby';
			case 'mediux':
				return 'MediUX';
			case 'tmdb':
				return 'TMDB';
			case 'fanarttv':
				return 'Fanart.tv';
			case 'theposterdb':
				return 'ThePosterDB';
			default:
				return provider ?? m.collections_source_server_unknown();
		}
	}

	function sourceLabel(sources: Array<'tmdb' | 'native'>): string {
		return sources.includes('tmdb') && sources.includes('native')
			? m.collections_source_both()
			: sources.includes('tmdb')
				? m.collections_source_tmdb()
				: m.collections_source_native({
						provider: providerName(data.collection.nativeProvider)
					});
	}

	function familyLabel(family: CollectionArtworkFamily | null): string {
		if (!family) return m.collection_provenance_unknown();
		const provider = providerName(family.provider);
		if (family.designFamily) {
			return m.collection_provenance_family({ provider, family: family.designFamily });
		}
		if (family.setId) return m.collection_provenance_set({ provider, set: family.setId });
		return m.collection_provenance_provider({ provider });
	}

	function consistencyLabel(state: CollectionMemberArtworkState['consistency']): string {
		switch (state) {
			case 'matches':
				return m.collection_consistency_match();
			case 'reviewed_mismatch':
				return m.collection_consistency_reviewed_mismatch();
			case 'staged_mismatch':
				return m.collection_consistency_staged_mismatch();
			case 'missing_artwork':
				return m.collection_consistency_missing_artwork();
			default:
				return m.collection_consistency_unknown_provenance();
		}
	}

	function consistencyClass(state: CollectionMemberArtworkState['consistency']): string {
		switch (state) {
			case 'matches':
				return 'badge-changed';
			case 'reviewed_mismatch':
			case 'staged_mismatch':
				return 'badge-warn';
			default:
				return 'badge-muted';
		}
	}

	function coverageStatusLabel(status: 'consistent' | 'mixed' | 'incomplete' | 'unknown') {
		switch (status) {
			case 'consistent':
				return m.collection_consistency_consistent();
			case 'mixed':
				return m.collection_consistency_mixed();
			case 'incomplete':
				return m.collection_consistency_incomplete();
			default:
				return m.collection_consistency_unknown();
		}
	}

	function coverageStatusClass(status: 'consistent' | 'mixed' | 'incomplete' | 'unknown') {
		return status === 'consistent'
			? 'badge-changed'
			: status === 'mixed'
				? 'badge-warn'
				: 'badge-muted';
	}

	function currentArtworkUrl(member: CollectionLocalMember, kind: 'poster' | 'background') {
		return `/api/artwork/${member.id}/${kind}?v=${member.artworkVersion}`;
	}

	function stagedArtworkUrl(member: CollectionLocalMember, kind: 'poster' | 'background') {
		const version =
			kind === 'poster' ? member.poster.staged.version : member.background.staged.version;
		return `/api/collections/items/${member.id}/staged/${kind}?v=${version}`;
	}

	function artworkAlt(
		member: CollectionLocalMember,
		kind: 'poster' | 'background',
		state: 'current' | 'staged'
	): string {
		if (kind === 'poster') {
			return state === 'current'
				? m.collection_current_poster_alt({ title: member.title })
				: m.collection_staged_poster_alt({ title: member.title });
		}
		return state === 'current'
			? m.collection_current_background_alt({ title: member.title })
			: m.collection_staged_background_alt({ title: member.title });
	}

	function suggestionEvidenceLabel(suggestion: PublicCollectionFamilySuggestion): string {
		switch (suggestion.evidence) {
			case 'design_family':
				return m.collection_suggestion_evidence_design({
					provider: providerName(suggestion.provider),
					family: suggestion.designFamily ?? m.collection_provenance_unknown()
				});
			case 'exact_set':
				return m.collection_suggestion_evidence_set({
					provider: providerName(suggestion.provider),
					set: suggestion.setId ?? m.collection_provenance_unknown()
				});
			default:
				return m.collection_suggestion_evidence_author({
					provider: providerName(suggestion.provider),
					author: suggestion.setAuthor ?? m.collection_provenance_unknown()
				});
		}
	}

	function memberNames(ids: number[]): string {
		const names = ids.map(
			(id) => data.collection.localMembers.find((member) => member.id === id)?.title ?? String(id)
		);
		return new Intl.ListFormat(data.locale, { style: 'long', type: 'conjunction' }).format(names);
	}

	function candidateOptions(
		mediaItemId: number,
		kind: 'poster' | 'background'
	): PublicCollectionCandidate[] {
		return (
			data.suggestions.members.find((member) => member.mediaItemId === mediaItemId)?.[kind] ?? []
		);
	}

	function candidateImageUrl(candidateId: number): string {
		return `/api/collections/${encodeURIComponent(data.collection.id)}/candidates/${candidateId}`;
	}

	function candidateProvenanceLabel(candidate: PublicCollectionCandidate): string {
		const provider = providerName(candidate.provider);
		if (candidate.designFamily) {
			return m.collection_provenance_family({ provider, family: candidate.designFamily });
		}
		if (candidate.setAuthor) {
			return m.collection_suggestion_evidence_author({
				provider,
				author: candidate.setAuthor
			});
		}
		return m.collection_provenance_set({ provider, set: candidate.setId });
	}

	function memberActionKey(mediaItemId: number, kind: 'poster' | 'background'): string {
		return `${mediaItemId}:${kind}`;
	}

	async function stageFamily(suggestion: PublicCollectionFamilySuggestion) {
		if (familyBusy || memberBusy) return;
		familyBusy = suggestion.id;
		actionFailed = false;
		actionMessage = m.collection_suggestion_staging();
		try {
			const response = await fetch(
				`/api/collections/${encodeURIComponent(data.collection.id)}/stage`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ suggestionId: suggestion.id })
				}
			);
			if (!response.ok) {
				if (response.status === 409) throw new Error('stale');
				throw new Error('failed');
			}
			const result = (await response.json()) as { stagedSlots: number; coveredMembers: number };
			await invalidateAll();
			actionMessage = m.collection_suggestion_staged({
				slots: result.stagedSlots,
				members: result.coveredMembers
			});
		} catch (cause) {
			actionFailed = true;
			actionMessage =
				cause instanceof Error && cause.message === 'stale'
					? m.collection_suggestion_stale()
					: m.collection_suggestion_failed();
		} finally {
			familyBusy = null;
		}
	}

	async function changeMemberSelection(
		member: CollectionLocalMember,
		kind: 'poster' | 'background',
		candidate: PublicCollectionCandidate | null
	) {
		if (familyBusy || memberBusy) return;
		const key = memberActionKey(member.id, kind);
		memberBusy = key;
		actionFailed = false;
		actionMessage = candidate
			? m.collection_override_staging({ title: member.title })
			: m.collection_override_clearing({ title: member.title });
		try {
			const response = await fetch(
				`/api/collections/${encodeURIComponent(data.collection.id)}/members/${member.id}/stage`,
				{
					method: candidate ? 'PUT' : 'DELETE',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ kind, candidateId: candidate?.candidateId })
				}
			);
			if (!response.ok) throw new Error('failed');
			await invalidateAll();
			actionMessage = candidate
				? m.collection_override_staged({ title: member.title })
				: m.collection_override_cleared({ title: member.title });
		} catch {
			actionFailed = true;
			actionMessage = m.collection_suggestion_failed();
		} finally {
			memberBusy = null;
		}
	}
</script>

<svelte:head>
	<title>{data.collection.name} · {m.collections_title()} · {m.app_name()}</title>
</svelte:head>

<div>
	<a class="btn btn-ghost mb-4" href="/collections">← {m.collections_back()}</a>

	<header class="surface relative overflow-hidden px-5 py-10 sm:px-8 sm:py-14">
		{#if heroMember?.background.current.available}
			<img
				src={currentArtworkUrl(heroMember, 'background')}
				alt=""
				class="absolute inset-0 h-full w-full object-cover opacity-35"
			/>
		{:else if heroMember?.background.staged.available}
			<img
				src={stagedArtworkUrl(heroMember, 'background')}
				alt=""
				class="absolute inset-0 h-full w-full object-cover opacity-35"
			/>
		{/if}
		<div
			class="absolute inset-0 bg-gradient-to-r from-neutral-950 via-neutral-950/85 to-neutral-950/30"
		></div>
		<div
			class="absolute inset-0 bg-gradient-to-t from-neutral-950 via-transparent to-transparent"
		></div>
		<div class="relative max-w-3xl">
			<div class="mb-3 flex flex-wrap gap-2">
				<span class="badge badge-muted">
					◎ {data.collection.source === 'tmdb'
						? m.collections_source_tmdb()
						: m.collections_source_native({
								provider: providerName(data.collection.nativeProvider)
							})}
				</span>
				<span class="badge badge-info">
					{m.collections_server_scope({ server: data.serverName })}
				</span>
			</div>
			<h1 class="text-3xl font-bold tracking-tight sm:text-5xl">{data.collection.name}</h1>
			<p class="mt-3 text-sm text-neutral-300">
				{m.collections_members_summary({
					local: data.collection.localMembers.length,
					unavailable: data.collection.unavailableMembers.length
				})}
			</p>
			<p class="mt-5 max-w-2xl text-sm leading-6 text-neutral-300">
				{m.collection_review_only_hint()}
			</p>
		</div>
	</header>

	<div
		class={`mt-4 min-h-6 text-sm ${actionFailed ? 'text-red-300' : 'text-emerald-300'}`}
		role="status"
		aria-live="polite"
	>
		{actionMessage}
	</div>

	<section class="mt-6" aria-labelledby="suggestions-title">
		<div class="mb-4 max-w-3xl">
			<p class="mb-2 text-xs font-semibold tracking-[0.16em] text-accent-300 uppercase">
				{m.collection_suggestion_eyebrow()}
			</p>
			<h2 id="suggestions-title" class="text-xl font-semibold">
				{m.collection_suggestion_title()}
			</h2>
			<p class="mt-2 text-sm leading-6 text-neutral-400">
				{m.collection_suggestion_hint()}
			</p>
		</div>

		{#if data.suggestions.families.length > 0}
			<div class="grid gap-4 lg:grid-cols-2">
				{#each data.suggestions.families as suggestion, index (suggestion.id)}
					<article class="surface overflow-hidden">
						<div class="border-b border-neutral-800 p-5">
							<div class="flex flex-wrap items-start justify-between gap-3">
								<div class="min-w-0">
									<div class="flex flex-wrap items-center gap-2">
										<span class="badge badge-mediux">
											{m.collection_suggestion_rank({ rank: index + 1 })}
										</span>
										{#if suggestion.stale}
											<span class="badge badge-warn">! {m.collection_suggestion_stale_badge()}</span
											>
										{/if}
									</div>
									<h3 class="mt-2 text-base font-semibold">
										{suggestionEvidenceLabel(suggestion)}
									</h3>
									{#if suggestion.language}
										<p class="mt-1 text-xs text-neutral-400">
											{m.collection_suggestion_language({ language: suggestion.language })}
										</p>
									{/if}
								</div>
								<p class="text-right text-2xl font-semibold tabular-nums">
									{suggestion.coveragePercentage}%
								</p>
							</div>
							<progress
								class="mt-4 h-2 w-full accent-accent-500"
								max="100"
								value={suggestion.coveragePercentage}
								aria-label={m.collection_suggestion_coverage_label({
									family: suggestionEvidenceLabel(suggestion)
								})}
							></progress>
							<p class="mt-2 text-sm text-neutral-300">
								{m.collection_suggestion_member_coverage({
									covered: suggestion.coveredMemberIds.length,
									total: data.collection.localMembers.length,
									slots: suggestion.coveredSlots
								})}
							</p>
							<dl class="mt-4 grid grid-cols-2 gap-2 text-sm">
								<div class="rounded-md border border-neutral-800 bg-neutral-950/60 p-3">
									<dt class="text-xs text-neutral-400">{m.collection_poster()}</dt>
									<dd class="mt-1 font-semibold">
										{m.collections_artwork_coverage({
											covered: suggestion.posterCoveredMemberIds.length,
											total: data.collection.localMembers.length
										})}
									</dd>
								</div>
								<div class="rounded-md border border-neutral-800 bg-neutral-950/60 p-3">
									<dt class="text-xs text-neutral-400">{m.collection_background()}</dt>
									<dd class="mt-1 font-semibold">
										{m.collections_artwork_coverage({
											covered: suggestion.backgroundCoveredMemberIds.length,
											total: data.collection.localMembers.length
										})}
									</dd>
								</div>
							</dl>
						</div>

						<div class="p-5">
							<div class="grid grid-cols-4 gap-2 sm:grid-cols-6" aria-hidden="true">
								{#each suggestion.selections
									.filter((selection) => selection.kind === 'poster')
									.slice(0, 6) as selection (selection.candidateId)}
									<img
										src={candidateImageUrl(selection.candidateId)}
										alt=""
										class="aspect-[2/3] w-full rounded border border-neutral-800 object-cover"
										loading="lazy"
									/>
								{/each}
							</div>
							{#if suggestion.posterUncoveredMemberIds.length > 0}
								<p class="mt-3 text-xs leading-5 text-amber-300">
									! {m.collection_suggestion_uncovered({
										slot: m.collection_poster(),
										members: memberNames(suggestion.posterUncoveredMemberIds)
									})}
								</p>
							{/if}
							{#if suggestion.backgroundUncoveredMemberIds.length > 0}
								<p class="mt-1 text-xs leading-5 text-amber-300">
									! {m.collection_suggestion_uncovered({
										slot: m.collection_background(),
										members: memberNames(suggestion.backgroundUncoveredMemberIds)
									})}
								</p>
							{/if}
							<button
								type="button"
								class="btn btn-accent mt-5 w-full"
								disabled={familyBusy !== null || memberBusy !== null}
								onclick={() => stageFamily(suggestion)}
							>
								{familyBusy === suggestion.id
									? m.collection_suggestion_staging()
									: m.collection_suggestion_stage()}
							</button>
							<p class="mt-2 text-center text-xs text-neutral-400">
								{m.collection_suggestion_stage_hint()}
							</p>
						</div>
					</article>
				{/each}
			</div>
		{:else if data.suggestions.hasCandidates}
			<div class="surface border-amber-900/60 p-6">
				<h3 class="font-semibold text-amber-200">{m.collection_suggestion_no_common()}</h3>
				<p class="mt-2 max-w-3xl text-sm leading-6 text-neutral-300">
					{m.collection_suggestion_no_common_hint()}
				</p>
			</div>
		{:else}
			<div class="surface p-6">
				<h3 class="font-semibold">{m.collection_suggestion_no_candidates()}</h3>
				<p class="mt-2 text-sm text-neutral-400">
					{m.collection_suggestion_no_candidates_hint()}
				</p>
			</div>
		{/if}
	</section>

	<section class="mt-8" aria-labelledby="consistency-title">
		<div class="mb-4 max-w-3xl">
			<h2 id="consistency-title" class="text-xl font-semibold">
				{m.collection_consistency_title()}
			</h2>
			<p class="mt-2 text-sm leading-6 text-neutral-400">
				{m.collection_consistency_hint()}
			</p>
		</div>
		<div class="grid gap-4 lg:grid-cols-2">
			{#each [{ label: m.collection_poster(), coverage: data.collection.consistency.poster }, { label: m.collection_background(), coverage: data.collection.consistency.background }] as slot (slot.label)}
				<article class="surface p-5">
					<div class="flex items-start justify-between gap-4">
						<h3 class="font-semibold">{slot.label}</h3>
						<span class={`badge ${coverageStatusClass(slot.coverage.status)}`}>
							{slot.coverage.status === 'consistent' ? '✓' : '●'}
							{coverageStatusLabel(slot.coverage.status)}
						</span>
					</div>
					<p class="mt-4 text-2xl font-semibold tabular-nums">
						{slot.coverage.percentage}%
					</p>
					<progress
						class="mt-2 h-2 w-full accent-accent-500"
						max="100"
						value={slot.coverage.percentage}
						aria-label={m.collection_consistency_progress({ slot: slot.label })}
					></progress>
					<p class="mt-3 text-sm leading-6 text-neutral-300">
						{m.collection_consistency_coverage({
							covered: slot.coverage.coveredMembers,
							total: slot.coverage.localMembers,
							percent: slot.coverage.percentage
						})}
					</p>
					{#if slot.coverage.dominantFamily}
						<p class="mt-2 text-xs text-neutral-400">
							{m.collection_consistency_dominant({
								family: familyLabel(slot.coverage.dominantFamily)
							})}
						</p>
					{/if}
					<dl class="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
						<div class="rounded-md border border-neutral-800 bg-neutral-950/60 p-2">
							<dt class="text-neutral-400">{m.collection_consistency_known()}</dt>
							<dd class="mt-1 font-semibold text-neutral-200">{slot.coverage.knownEvidence}</dd>
						</div>
						<div class="rounded-md border border-neutral-800 bg-neutral-950/60 p-2">
							<dt class="text-neutral-400">{m.collection_consistency_unknown_short()}</dt>
							<dd class="mt-1 font-semibold text-neutral-200">{slot.coverage.unknownProvenance}</dd>
						</div>
						<div class="rounded-md border border-neutral-800 bg-neutral-950/60 p-2">
							<dt class="text-neutral-400">{m.collection_consistency_missing_short()}</dt>
							<dd class="mt-1 font-semibold text-neutral-200">{slot.coverage.missingArtwork}</dd>
						</div>
					</dl>
				</article>
			{/each}
		</div>
		{#if data.collection.unavailableMembers.length > 0}
			<p class="mt-3 text-xs text-neutral-400">
				{m.collection_consistency_excluded({ count: data.collection.unavailableMembers.length })}
			</p>
		{/if}
	</section>

	<section class="mt-10" aria-labelledby="local-members-title">
		<div class="mb-5">
			<h2 id="local-members-title" class="text-xl font-semibold">
				{m.collection_local_members()}
			</h2>
			<p class="mt-2 text-sm text-neutral-400">{m.collection_local_members_hint()}</p>
		</div>

		{#if data.collection.localMembers.length === 0}
			<div class="surface p-8 text-center text-sm text-neutral-400">
				{m.collection_no_local_members()}
			</div>
		{:else}
			<div class="grid gap-5 xl:grid-cols-2">
				{#each data.collection.localMembers as member (member.id)}
					<article class="surface overflow-hidden">
						<header class="flex items-start justify-between gap-4 border-b border-neutral-800 p-4">
							<div class="min-w-0">
								<h3 class="truncate font-semibold">
									<a class="hover:text-accent-200" href={`/item/${member.id}`}>{member.title}</a>
								</h3>
								<p class="mt-1 text-xs text-neutral-400">
									{member.year ?? '—'} · {member.type === 'movie'
										? m.manual_match_type_movie()
										: m.manual_match_type_show()}
								</p>
							</div>
							<span class="badge badge-muted">◎ {sourceLabel(member.sources)}</span>
						</header>

						<div class="space-y-6 p-4">
							{#each [{ kind: 'poster' as const, label: m.collection_poster(), artwork: member.poster }, { kind: 'background' as const, label: m.collection_background(), artwork: member.background }] as slot (slot.kind)}
								{@const options = candidateOptions(member.id, slot.kind)}
								<section
									aria-label={m.collection_member_slot({ title: member.title, slot: slot.label })}
								>
									<div class="mb-2 flex flex-wrap items-center justify-between gap-2">
										<h4 class="text-xs font-semibold tracking-wide text-neutral-300 uppercase">
											{slot.label}
										</h4>
										<span class={`badge ${consistencyClass(slot.artwork.consistency)}`}>
											{slot.artwork.consistency === 'matches' ? '✓' : '●'}
											{consistencyLabel(slot.artwork.consistency)}
										</span>
									</div>

									<div class="grid grid-cols-2 gap-3">
										{#each [{ state: 'current' as const, label: m.collection_current(), available: slot.artwork.current.available, provenance: slot.artwork.current.provenance }, { state: 'staged' as const, label: m.collection_staged(), available: slot.artwork.staged.available, provenance: slot.artwork.staged.provenance }] as image (image.state)}
											<figure class="min-w-0">
												<figcaption class="mb-1.5 text-xs font-medium text-neutral-300">
													{image.label}
												</figcaption>
												<div
													class={`${slot.kind === 'poster' ? 'aspect-[2/3]' : 'aspect-video'} overflow-hidden rounded-md border border-neutral-800 bg-neutral-950`}
												>
													{#if image.available}
														<img
															src={image.state === 'current'
																? currentArtworkUrl(member, slot.kind)
																: stagedArtworkUrl(member, slot.kind)}
															alt={artworkAlt(member, slot.kind, image.state)}
															class="h-full w-full object-cover"
															loading="lazy"
															decoding="async"
														/>
													{:else}
														<div
															class="flex h-full items-center justify-center px-3 text-center text-xs text-neutral-400"
														>
															{m.collection_no_artwork()}
														</div>
													{/if}
												</div>
												<p
													class="mt-2 truncate text-[11px] text-neutral-400"
													title={familyLabel(image.provenance)}
												>
													{image.available
														? familyLabel(image.provenance)
														: m.collection_provenance_not_applicable()}
												</p>
											</figure>
										{/each}
									</div>
									{#if options.length > 0 || slot.artwork.staged.available}
										<details
											class="mt-3 rounded-md border border-neutral-800 bg-neutral-950/40 p-3"
										>
											<summary class="cursor-pointer text-xs font-medium text-neutral-200">
												{m.collection_override_options({ count: options.length })}
											</summary>
											{#if options.length > 0}
												<div
													class={`mt-3 grid gap-2 ${slot.kind === 'poster' ? 'grid-cols-3 sm:grid-cols-4' : 'grid-cols-2'}`}
												>
													{#each options as candidate (candidate.candidateId)}
														<button
															type="button"
															class={`group overflow-hidden rounded-md border bg-neutral-950 text-left transition-colors ${slot.artwork.staged.candidateId === candidate.candidateId ? 'border-accent-400' : 'border-neutral-800 hover:border-neutral-600'}`}
															aria-pressed={slot.artwork.staged.candidateId ===
																candidate.candidateId}
															aria-label={m.collection_override_stage_candidate({
																title: member.title,
																slot: slot.label,
																provenance: candidateProvenanceLabel(candidate)
															})}
															disabled={familyBusy !== null || memberBusy !== null}
															onclick={() => changeMemberSelection(member, slot.kind, candidate)}
														>
															<img
																src={candidateImageUrl(candidate.candidateId)}
																alt=""
																class={`${slot.kind === 'poster' ? 'aspect-[2/3]' : 'aspect-video'} w-full object-cover`}
																loading="lazy"
															/>
															<span
																class="block truncate px-2 pt-2 text-[10px] font-medium text-neutral-200"
															>
																{providerName(candidate.provider)}
															</span>
															<span class="block truncate px-2 pb-2 text-[10px] text-neutral-400">
																{candidate.setAuthor ?? candidate.designFamily ?? candidate.setId}
															</span>
															{#if candidate.stale}
																<span class="badge badge-warn m-2 mt-0"
																	>! {m.collection_suggestion_stale_badge()}</span
																>
															{/if}
														</button>
													{/each}
												</div>
											{:else}
												<p class="mt-3 text-xs text-neutral-400">
													{m.collection_override_no_candidates()}
												</p>
											{/if}
											<div class="mt-3 flex flex-wrap gap-2">
												{#if slot.artwork.staged.available}
													<button
														type="button"
														class="btn btn-ghost"
														disabled={familyBusy !== null || memberBusy !== null}
														onclick={() => changeMemberSelection(member, slot.kind, null)}
													>
														{memberBusy === memberActionKey(member.id, slot.kind)
															? m.collection_override_clearing({ title: member.title })
															: m.collection_override_clear()}
													</button>
												{/if}
												<a class="btn btn-ghost" href={`/item/${member.id}`}>
													{m.collection_override_open_item()}
												</a>
											</div>
										</details>
									{/if}
								</section>
							{/each}
						</div>
					</article>
				{/each}
			</div>
		{/if}
	</section>

	<div class="mt-10 space-y-6">
		<NativeCollectionArtworkPanel collectionId={data.collection.id} locale={data.locale} />
		<CollectionApplyPanel
			collectionId={data.collection.id}
			members={data.collection.localMembers.map((member) => ({
				id: member.id,
				title: member.title
			}))}
			{stagedCount}
			{selectionRevision}
			defaultMethod={data.defaultApplyMethod}
			onChanged={() => invalidateAll()}
		/>
		<CollectionHistoryPanel
			collectionId={data.collection.id}
			groups={data.history}
			locale={data.locale}
			onChanged={() => invalidateAll()}
		/>
	</div>

	{#if data.collection.unavailableMembers.length > 0}
		<section class="mt-10" aria-labelledby="unavailable-members-title">
			<h2 id="unavailable-members-title" class="text-xl font-semibold">
				{m.collection_unavailable_members()}
			</h2>
			<p class="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">
				{m.collection_unavailable_hint()}
			</p>
			<ul class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{#each data.collection.unavailableMembers as member (member.id)}
					<li class="surface flex items-start justify-between gap-3 p-4">
						<div class="min-w-0">
							<p class="truncate text-sm font-medium">
								{member.title ?? m.collection_unknown_member()}
							</p>
							<p class="mt-1 text-xs text-neutral-400">{member.year ?? '—'}</p>
						</div>
						<div class="flex flex-col items-end gap-2">
							<span class="badge badge-warn">! {m.collection_member_unavailable()}</span>
							<span class="text-[10px] text-neutral-400">
								{member.source === 'tmdb'
									? m.collections_source_tmdb()
									: m.collections_source_native({
											provider: providerName(data.collection.nativeProvider)
										})}
							</span>
						</div>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>
