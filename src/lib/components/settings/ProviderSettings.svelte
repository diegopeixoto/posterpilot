<script lang="ts">
	import { tick } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { artworkLanguageChoices, artworkLanguageName } from '$lib/posters/candidate-disclosure';
	import {
		dropIndexForPointer,
		moveProvider,
		reorderProviders,
		type ProviderRowBounds,
		type RankingProvider
	} from '$lib/settings/provider-order';
	import {
		ARTWORK_LANGUAGE_ANY,
		ARTWORK_LANGUAGE_UI,
		type TmdbArtworkLanguage
	} from '$lib/tmdb-artwork-language';

	let {
		tmdbKey = $bindable(),
		tmdbKeySet,
		providerMediux = $bindable(),
		providerTmdb = $bindable(),
		providerFanart = $bindable(),
		providerThePosterDb = $bindable(),
		providerPriority = $bindable(),
		tmdbArtworkLanguage = $bindable(),
		fanartKey = $bindable(),
		fanartKeySet,
		thePosterDbUsername = $bindable(),
		thePosterDbPassword = $bindable(),
		thePosterDbPasswordSet,
		thePosterDbPasswordClear = $bindable(),
		env
	}: {
		tmdbKey: string;
		tmdbKeySet: boolean;
		providerMediux: boolean;
		providerTmdb: boolean;
		providerFanart: boolean;
		providerThePosterDb: boolean;
		providerPriority: RankingProvider[];
		tmdbArtworkLanguage: TmdbArtworkLanguage;
		fanartKey: string;
		fanartKeySet: boolean;
		thePosterDbUsername: string;
		thePosterDbPassword: string;
		thePosterDbPasswordSet: boolean;
		thePosterDbPasswordClear: boolean;
		env: Record<string, boolean>;
	} = $props();

	// Values stay ISO 639-1 base codes: `resolveConfig` narrows what it reads
	// (`pt-BR` comes back as `pt`), so a regional value would never match its
	// own option after a save. Option labels are native names, like the UI
	// language switcher, so the list reads the same in every locale.
	const languageChoices = $derived(artworkLanguageChoices(tmdbArtworkLanguage));

	// Enablement, credentials and env overrides are four independent scalars in the
	// save payload; these maps let one ordered row render the right one per provider.
	const providerNames: Record<RankingProvider, () => string> = {
		mediux: m.settings_provider_mediux,
		theposterdb: m.settings_provider_theposterdb,
		fanarttv: m.settings_provider_fanart,
		tmdb: m.settings_provider_tmdb
	};
	const providerEnabled: Record<RankingProvider, boolean> = $derived({
		mediux: providerMediux,
		theposterdb: providerThePosterDb,
		fanarttv: providerFanart,
		tmdb: providerTmdb
	});
	const providerEnvManaged: Record<RankingProvider, boolean> = $derived({
		mediux: env.providerMediux,
		theposterdb: env.providerThePosterDb,
		fanarttv: env.providerFanart,
		tmdb: env.providerTmdb
	});

	function setProviderEnabled(provider: RankingProvider, enabled: boolean): void {
		if (provider === 'mediux') providerMediux = enabled;
		else if (provider === 'theposterdb') providerThePosterDb = enabled;
		else if (provider === 'fanarttv') providerFanart = enabled;
		else providerTmdb = enabled;
	}

	// `null` means the provider needs no credential at all (MediUX is anonymous), so its
	// row simply omits the badge rather than claiming a state it does not have.
	type ProviderCredentialState = 'set' | 'missing' | 'optional';
	const credentialState: Record<RankingProvider, ProviderCredentialState | null> = $derived({
		mediux: null,
		theposterdb:
			thePosterDbPassword !== '' || (thePosterDbPasswordSet && !thePosterDbPasswordClear)
				? 'set'
				: 'optional',
		fanarttv: fanartKey !== '' || fanartKeySet ? 'set' : 'missing',
		tmdb: tmdbKey !== '' || tmdbKeySet ? 'set' : 'missing'
	});
	const credentialLabels: Record<ProviderCredentialState, () => string> = {
		set: m.settings_provider_credential_set,
		missing: m.settings_provider_credential_missing,
		optional: m.settings_provider_credential_optional
	};

	let orderList: HTMLUListElement | null = $state(null);
	let orderAnnouncement = $state('');
	let dragProvider = $state<RankingProvider | null>(null);
	let dropIndex = $state(-1);
	const dragFromIndex = $derived(dragProvider ? providerPriority.indexOf(dragProvider) : -1);

	function announceOrder(provider: RankingProvider): void {
		orderAnnouncement = m.settings_provider_order_announcement({
			provider: providerNames[provider](),
			position: providerPriority.indexOf(provider) + 1,
			total: providerPriority.length
		});
	}

	function moveButton(provider: RankingProvider, direction: 'up' | 'down'): HTMLElement | null {
		return document.getElementById(`provider-order-${direction}-${provider}`);
	}

	async function moveByButton(provider: RankingProvider, delta: -1 | 1): Promise<void> {
		const from = providerPriority.indexOf(provider);
		const next = moveProvider(providerPriority, from, delta);
		if (next[from] === provider) return;
		providerPriority = next;
		announceOrder(provider);
		// The keyed `{#each}` re-inserts the row it moved and browsers drop focus from a
		// re-inserted node, so put focus back on the provider the user moved — on the
		// button they pressed, or its sibling when that one just hit the list bound.
		//
		// `tick()` rather than `requestAnimationFrame`: this list is a `$bindable()`
		// prop, so the update travels child → parent → child and the rows are still
		// the pre-move nodes on the next frame. Focusing there lands on a node the
		// re-insertion then discards, leaving focus on `<body>`.
		await tick();
		const pressed = moveButton(provider, delta < 0 ? 'up' : 'down');
		if (pressed instanceof HTMLButtonElement && !pressed.disabled) pressed.focus();
		else moveButton(provider, delta < 0 ? 'down' : 'up')?.focus();
	}

	/** Rows keep their DOM order for the whole drag, so bounds index like `providerPriority`. */
	function rowBounds(): ProviderRowBounds[] {
		const rows = orderList?.querySelectorAll<HTMLElement>('[data-provider-row]') ?? [];
		return [...rows].map((row) => {
			const rect = row.getBoundingClientRect();
			return { top: rect.top, height: rect.height };
		});
	}

	function startDrag(event: PointerEvent, provider: RankingProvider): void {
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		// Only the handle carries `touch-action: none`, so a touch anywhere else on the
		// page still scrolls; capture keeps the moves coming here once the finger leaves it.
		event.preventDefault();
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		dragProvider = provider;
		dropIndex = providerPriority.indexOf(provider);
	}

	function trackDrag(event: PointerEvent): void {
		if (!dragProvider) return;
		dropIndex = dropIndexForPointer(event.clientY, rowBounds());
	}

	// Reordering waits for the drop: moving rows mid-drag would detach the capturing
	// handle and kill the gesture, so the pending landing spot is previewed instead.
	function endDrag(): void {
		const provider = dragProvider;
		const target = dropIndex;
		dragProvider = null;
		dropIndex = -1;
		if (!provider || target < 0) return;
		const from = providerPriority.indexOf(provider);
		if (target === from) return;
		providerPriority = reorderProviders(providerPriority, from, target);
		announceOrder(provider);
	}

	function cancelDrag(): void {
		dragProvider = null;
		dropIndex = -1;
	}
</script>

<div>
	<label for="tmdbKey" class="mb-1 block text-sm font-medium">{m.settings_tmdb_key()}</label>
	<input
		id="tmdbKey"
		type="password"
		bind:value={tmdbKey}
		disabled={env.tmdbKey}
		placeholder={tmdbKeySet
			? m.settings_secret_placeholder_set()
			: m.settings_tmdb_key_placeholder_unset()}
		class="input w-full disabled:opacity-50"
	/>
	{#if env.tmdbKey}<p class="mt-1 text-xs text-amber-400">{m.settings_set_from_env()}</p>{/if}
</div>

<div>
	<span id="provider-order-label" class="mb-1 block text-sm font-medium">
		{m.settings_providers()}
	</span>
	<p class="text-xs text-neutral-400">{m.settings_providers_hint()}</p>
	<p class="mt-1 mb-3 text-xs text-neutral-400">{m.settings_provider_order_hint()}</p>
	<ul class="space-y-2" aria-labelledby="provider-order-label" bind:this={orderList}>
		{#each providerPriority as provider, index (provider)}
			{@const dragging = dragProvider === provider}
			{@const position = dragging && dropIndex >= 0 ? dropIndex + 1 : index + 1}
			{@const credential = credentialState[provider]}
			<li
				data-provider-row
				class="relative rounded-lg border bg-neutral-950/40 p-2 transition-colors {dragging
					? 'border-accent-600'
					: 'border-neutral-800'}"
			>
				{#if dropIndex === index && dragFromIndex >= 0 && dropIndex !== dragFromIndex}
					<span
						class="pointer-events-none absolute right-0 left-0 h-0.5 rounded bg-accent-500 {dropIndex <
						dragFromIndex
							? '-top-1.5'
							: '-bottom-1.5'}"
						aria-hidden="true"
					></span>
				{/if}
				<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
					<button
						type="button"
						tabindex="-1"
						aria-hidden="true"
						title={m.settings_provider_order_drag()}
						onpointerdown={(event) => startDrag(event, provider)}
						onpointermove={trackDrag}
						onpointerup={endDrag}
						onpointercancel={cancelDrag}
						class="shrink-0 touch-none rounded-md p-2 text-neutral-500 select-none hover:text-neutral-300 {dragging
							? 'cursor-grabbing text-accent-300'
							: 'cursor-grab'}"
					>
						<svg viewBox="0 0 10 16" class="size-4" fill="currentColor" aria-hidden="true">
							<circle cx="3" cy="3" r="1.4" />
							<circle cx="7" cy="3" r="1.4" />
							<circle cx="3" cy="8" r="1.4" />
							<circle cx="7" cy="8" r="1.4" />
							<circle cx="3" cy="13" r="1.4" />
							<circle cx="7" cy="13" r="1.4" />
						</svg>
					</button>
					<span
						class="w-5 shrink-0 text-center text-sm font-semibold text-neutral-300 tabular-nums"
					>
						<span aria-hidden="true">{position}</span>
						<span class="sr-only">
							{m.settings_provider_order_position({ position, total: providerPriority.length })}
						</span>
					</span>
					<label class="flex min-w-0 flex-1 items-center gap-2 text-sm text-neutral-300">
						<input
							type="checkbox"
							checked={providerEnabled[provider]}
							disabled={providerEnvManaged[provider]}
							onchange={(event) => setProviderEnabled(provider, event.currentTarget.checked)}
						/>
						<span class="truncate">{providerNames[provider]()}</span>
						{#if provider === 'theposterdb'}
							<span class="shrink-0 text-xs text-neutral-400">{m.settings_experimental()}</span>
						{/if}
					</label>
					<div class="flex shrink-0 flex-wrap items-center gap-2">
						{#if !providerEnabled[provider]}
							<span class="badge badge-muted">{m.settings_provider_order_disabled()}</span>
						{/if}
						{#if credential}
							<span class="badge {credential === 'missing' ? 'badge-warn' : 'badge-muted'}">
								{credentialLabels[credential]()}
							</span>
						{/if}
						{#if providerEnvManaged[provider]}
							<span class="text-xs text-amber-400">{m.settings_set_from_env()}</span>
						{/if}
					</div>
					<div class="ml-auto flex shrink-0 gap-1">
						<button
							id={`provider-order-up-${provider}`}
							type="button"
							class="btn btn-ghost min-h-11 min-w-11"
							disabled={index === 0}
							aria-label={m.settings_priority_up({ provider: providerNames[provider]() })}
							onclick={() => moveByButton(provider, -1)}>↑</button
						>
						<button
							id={`provider-order-down-${provider}`}
							type="button"
							class="btn btn-ghost min-h-11 min-w-11"
							disabled={index === providerPriority.length - 1}
							aria-label={m.settings_priority_down({ provider: providerNames[provider]() })}
							onclick={() => moveByButton(provider, 1)}>↓</button
						>
					</div>
				</div>
			</li>
		{/each}
	</ul>
	<p class="sr-only" aria-live="polite" aria-atomic="true">{orderAnnouncement}</p>
	<div class="mt-4 max-w-xs">
		<label for="tmdbArtworkLanguage" class="mb-1 block text-sm font-medium">
			{m.settings_tmdb_artwork_language()}
		</label>
		<select
			id="tmdbArtworkLanguage"
			bind:value={tmdbArtworkLanguage}
			disabled={env.tmdbArtworkLanguage}
			class="input w-full disabled:opacity-50"
		>
			<option value={ARTWORK_LANGUAGE_ANY}>{m.settings_tmdb_artwork_language_any()}</option>
			<option value={ARTWORK_LANGUAGE_UI}>{m.settings_tmdb_artwork_language_ui()}</option>
			{#each languageChoices as code (code)}
				<option value={code}>{artworkLanguageName(code)}</option>
			{/each}
		</select>
		<p class="mt-1 text-xs text-neutral-400">{m.settings_tmdb_artwork_language_hint()}</p>
		{#if env.tmdbArtworkLanguage}<p class="mt-1 text-xs text-amber-400">
				{m.settings_set_from_env()}
			</p>{/if}
	</div>
	{#if providerThePosterDb}
		<div class="mt-3 space-y-2 rounded-md border border-neutral-800 p-3">
			<p class="text-xs text-neutral-400">{m.settings_theposterdb_auth_hint()}</p>
			<div>
				<label for="thePosterDbUsername" class="mb-1 block text-sm font-medium"
					>{m.settings_theposterdb_username()}</label
				>
				<input
					id="thePosterDbUsername"
					type="text"
					autocomplete="off"
					bind:value={thePosterDbUsername}
					disabled={env.thePosterDbUsername}
					placeholder={m.settings_theposterdb_username_placeholder()}
					class="input w-full disabled:opacity-50"
				/>
				{#if env.thePosterDbUsername}<p class="mt-1 text-xs text-amber-400">
						{m.settings_set_from_env()}
					</p>{/if}
			</div>
			<div>
				<label for="thePosterDbPassword" class="mb-1 block text-sm font-medium"
					>{m.settings_theposterdb_password()}</label
				>
				<input
					id="thePosterDbPassword"
					type="password"
					autocomplete="off"
					bind:value={thePosterDbPassword}
					oninput={() => (thePosterDbPasswordClear = false)}
					disabled={env.thePosterDbPassword}
					placeholder={thePosterDbPasswordSet
						? m.settings_secret_placeholder_set()
						: m.settings_theposterdb_password_placeholder_unset()}
					class="input w-full disabled:opacity-50"
				/>
				{#if env.thePosterDbPassword}<p class="mt-1 text-xs text-amber-400">
						{m.settings_set_from_env()}
					</p>{/if}
				{#if thePosterDbPasswordSet && !env.thePosterDbPassword && thePosterDbPassword === ''}
					<button
						type="button"
						aria-pressed={thePosterDbPasswordClear}
						onclick={() => (thePosterDbPasswordClear = !thePosterDbPasswordClear)}
						class="btn mt-1.5 px-2 py-0.5 text-xs {thePosterDbPasswordClear
							? 'bg-red-900/50 text-red-300 hover:bg-red-900/70'
							: 'btn-ghost'}"
					>
						{m.settings_theposterdb_password_clear()}
					</button>
					{#if thePosterDbPasswordClear}
						<p class="mt-1 text-xs text-red-300" role="status">
							{m.settings_theposterdb_password_clear_pending()}
						</p>
					{/if}
				{/if}
			</div>
		</div>
	{/if}
	<div class="mt-3">
		<label for="fanartKey" class="mb-1 block text-sm font-medium">{m.settings_fanart_key()}</label>
		<input
			id="fanartKey"
			type="password"
			bind:value={fanartKey}
			disabled={env.fanartKey}
			placeholder={fanartKeySet
				? m.settings_secret_placeholder_set()
				: m.settings_fanart_key_placeholder_unset()}
			class="input w-full disabled:opacity-50"
		/>
		{#if env.fanartKey}<p class="mt-1 text-xs text-amber-400">{m.settings_set_from_env()}</p>{/if}
	</div>
</div>
