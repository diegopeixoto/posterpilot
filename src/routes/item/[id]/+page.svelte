<script lang="ts">
	import { onMount } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import type { PosterCandidate } from '$lib/server/db/schema';
	import type { CandidateSet } from '$lib/server/posters/sets';
	import { groupSetArtwork } from '$lib/posters/season-groups';
	import { defaultExpanded, providerKey, setKey, seasonKey } from '$lib/posters/collapse';
	import { m } from '$lib/paraglide/messages';
	import JobProgress from '$lib/components/JobProgress.svelte';
	import ManualTmdbMatch from '$lib/components/ManualTmdbMatch.svelte';
	import ArtworkTimeline from '$lib/components/ArtworkTimeline.svelte';
	import ArtworkUndoDialog from '$lib/components/ArtworkUndoDialog.svelte';
	import type { PublicJobProgress } from '$lib/job-progress';
	import { jobStatusLabel } from '$lib/job-labels';
	import {
		canConfirmApplyAndNext,
		canRetryApplyNextCompletion,
		isFullySuccessfulApply
	} from '$lib/review-apply-next';
	import {
		isEditableReviewTarget,
		reviewShortcutForKey,
		reviewShortcutsBlocked
	} from '$lib/review-shortcuts';

	let { data } = $props();

	// svelte-ignore state_referenced_locally
	let selectedPoster = $state<string | null>(data.item.selectedPosterUrl);
	// svelte-ignore state_referenced_locally
	let selectedBackground = $state<string | null>(data.item.selectedBackgroundUrl);
	// svelte-ignore state_referenced_locally
	let method = $state<'plex' | 'kometa' | 'both'>(data.defaultApplyMethod);
	let busy = $state(false);
	let jobId = $state<number | null>(null);
	let undoJobId = $state<number | null>(null);
	let historyRefresh = $state(0);
	let message = $state<string | null>(null);
	// Whether the current message is an error (drives role="alert" + red styling).
	let messageError = $state(false);
	let reviewBusy = $state(false);
	let advanceAfterApply = $state(false);
	let advanceTargetHref = $state<string | null>(null);
	let finishingAdvance = $state(false);
	let completionRetry = $state<{ jobId: number; targetHref: string } | null>(null);
	function setMessage(text: string, isError = false) {
		message = text;
		messageError = isError;
	}

	function returnToContext(event: MouseEvent) {
		if (!data.canUseHistoryBack || history.length <= 1) return;
		event.preventDefault();
		history.back();
	}

	// Every destination is confirmation-bearing; the plan below is the source of truth.
	let confirmApply = $state(false);
	let applyPreview = $state<{
		planId: string | null;
		digest: string | null;
		summary: {
			skipCount: number;
			destinations: { server: number; kometa: number };
		};
	} | null>(null);
	const confirmTarget = $derived(
		method === 'both'
			? `${m.apply_target_server()} + Kometa`
			: method === 'kometa'
				? 'Kometa'
				: m.apply_target_server()
	);

	let posterUrlInput = $state('');
	let backgroundUrlInput = $state('');
	let posterFile = $state<File | null>(null);
	let uploadPreview = $state<{
		planId: string;
		digest: string;
		image: { sizeBytes: number; contentType: string; sha256: string };
		expiresAt: string;
	} | null>(null);

	type UndoUiScope =
		| { kind: 'item' }
		| { kind: 'revision'; revisionId: string }
		| { kind: 'season'; season: number };
	interface UndoPreview {
		planId: string;
		digest: string;
		scope: unknown;
		operations: unknown[];
		summary: {
			operationCount: number;
			actionableCount: number;
			unavailableCount: number;
			targetCount: number;
			slotCount: number;
			destinations: { server: number; kometa: number };
			restoreStates: { present: number; absent: number; unavailable: number };
		};
	}
	let undoPreview = $state<UndoPreview | null>(null);
	let undoContextLabel = $state('');
	let undoBusy = $state(false);
	let undoAvailable = $state(false);

	const isShow = $derived(data.item.type === 'show');

	// ---- Season/episode (child) selection state -------------------------------
	// Keyed `kind:season:episode` (episode empty for season-level slots).
	function childKey(kind: string, season: number, episode: number | null): string {
		return `${kind}:${season}:${episode ?? ''}`;
	}
	function hydrateChildren(rows: typeof data.childSelections): Record<string, string> {
		const out: Record<string, string> = {};
		for (const r of rows) out[childKey(r.kind, r.season, r.episode)] = r.url;
		return out;
	}
	// svelte-ignore state_referenced_locally
	let childSel = $state<Record<string, string>>(hydrateChildren(data.childSelections));
	function isChildStaged(kind: string, season: number, episode: number | null, url: string) {
		return childSel[childKey(kind, season, episode)] === url;
	}
	const stagedSeasons = $derived(
		Object.keys(childSel).filter((k) => k.startsWith('poster:') || k.startsWith('background:'))
			.length
	);
	const stagedEpisodes = $derived(
		Object.keys(childSel).filter((k) => k.startsWith('title_card:')).length
	);
	const hasStaged = $derived(
		Boolean(selectedPoster) ||
			Boolean(selectedBackground) ||
			stagedSeasons > 0 ||
			stagedEpisodes > 0
	);

	// ---- Scored suggestions ---------------------------------------------------
	// The highest-`score` candidate per slot (show poster/background, each season
	// poster, each episode title card), computed across ALL providers/sets since a
	// slot maps to exactly one applied artwork. Unscored candidates are ignored;
	// when `suggestPreselect` is off this stays empty (no chips, no pre-select).
	interface SlotSuggestions {
		ids: Set<number>;
		poster: PosterCandidate | null;
		background: PosterCandidate | null;
		seasonPosters: Map<number, PosterCandidate>;
		titleCards: Map<string, PosterCandidate>;
	}
	function computeSuggestions(cands: PosterCandidate[], enabled: boolean): SlotSuggestions {
		const out: SlotSuggestions = {
			ids: new Set(),
			poster: null,
			background: null,
			seasonPosters: new Map(),
			titleCards: new Map()
		};
		if (!enabled) return out;
		// Strictly-greater keeps the first-seen candidate on a score tie (stable).
		const better = (a: PosterCandidate | null | undefined, b: PosterCandidate) =>
			a == null || (b.score as number) > (a.score as number);
		for (const c of cands) {
			if (c.score == null) continue;
			if (c.kind === 'poster') {
				if (better(out.poster, c)) out.poster = c;
			} else if (c.kind === 'background') {
				if (better(out.background, c)) out.background = c;
			} else if (c.kind === 'season' && c.season != null) {
				if (better(out.seasonPosters.get(c.season), c)) out.seasonPosters.set(c.season, c);
			} else if (c.kind === 'title_card' && c.season != null && c.episode != null) {
				const k = childKey('title_card', c.season, c.episode);
				if (better(out.titleCards.get(k), c)) out.titleCards.set(k, c);
			}
		}
		for (const c of [
			out.poster,
			out.background,
			...out.seasonPosters.values(),
			...out.titleCards.values()
		]) {
			if (c) out.ids.add(c.id);
		}
		return out;
	}
	// Reactive (recomputes after discovery refreshes the candidate list).
	const suggestions = $derived(computeSuggestions(data.candidates, data.suggestPreselect));

	/**
	 * Explicitly stage the suggested pick for every slot the user hasn't already chosen,
	 * persisting exactly like a manual pick (children must be persisted for apply
	 * to read them). Only fills EMPTY slots, so it never overrides a real choice.
	 */
	async function stageSuggestions() {
		if (!data.suggestPreselect || busy || finishingAdvance) return;
		busy = true;
		confirmApply = false;
		applyPreview = null;
		advanceAfterApply = false;
		advanceTargetHref = null;
		completionRetry = null;
		const s = suggestions;
		let showChanged = false;
		if (!selectedPoster && s.poster) {
			selectedPoster = s.poster.url;
			showChanged = true;
		}
		if (!selectedBackground && s.background) {
			selectedBackground = s.background.url;
			showChanged = true;
		}
		const children: { kind: string; season: number; episode: number | null; url: string }[] = [];
		for (const [season, c] of s.seasonPosters) {
			if (!childSel[childKey('poster', season, null)]) {
				children.push({ kind: 'poster', season, episode: null, url: c.url });
			}
		}
		for (const c of s.titleCards.values()) {
			if (c.season == null || c.episode == null) continue;
			if (!childSel[childKey('title_card', c.season, c.episode)]) {
				children.push({ kind: 'title_card', season: c.season, episode: c.episode, url: c.url });
			}
		}
		try {
			if (showChanged && !(await persistSelection())) throw new Error('selection_failed');
			if (children.length) {
				const res = await fetch(`/api/items/${data.item.id}/select`, {
					method: 'POST',
					headers: jsonHeaders,
					body: JSON.stringify({ children })
				});
				if (!res.ok) throw new Error('selection_failed');
				const add: Record<string, string> = {};
				for (const c of children) add[childKey(c.kind, c.season, c.episode)] = c.url;
				childSel = { ...childSel, ...add };
			}
			if (showChanged || children.length) {
				setMessage(m.review_suggestion_staged());
				if (data.reviewNavigation) {
					await fetch(`/api/review/items/${data.item.id}`, {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({
							serverId: data.item.serverInstanceId,
							action: 'staged',
							context: { source: 'item_detail' }
						})
					});
				}
			} else {
				setMessage(m.review_no_suggestion_to_stage());
			}
		} catch {
			setMessage(m.review_action_failed(), true);
		} finally {
			busy = false;
		}
	}

	// ---- Collapse state (provider / set / season) -----------------------------
	const COLLAPSE_NS = 'pp:collapse:';
	// svelte-ignore state_referenced_locally
	let expanded = $state<Set<string>>(defaultExpanded(data.providerGroups));
	function isExpanded(key: string) {
		return expanded.has(key);
	}
	function toggle(key: string) {
		const next = new Set(expanded);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		expanded = next;
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(COLLAPSE_NS + data.item.id, JSON.stringify([...next]));
		}
	}
	// Load persisted collapse state on mount and whenever the item changes; falls
	// back to the default (first provider + first set expanded). Kept out of the
	// initial $state so SSR and first client render agree (no hydration mismatch).
	$effect(() => {
		const id = data.item.id;
		if (typeof localStorage === 'undefined') return;
		try {
			const raw = localStorage.getItem(COLLAPSE_NS + id);
			expanded = raw ? new Set(JSON.parse(raw) as string[]) : defaultExpanded(data.providerGroups);
		} catch {
			expanded = defaultExpanded(data.providerGroups);
		}
	});

	// Re-sync local selection when navigating to a different item.
	// svelte-ignore state_referenced_locally
	let loadedId = data.item.id;
	$effect(() => {
		if (data.item.id !== loadedId) {
			loadedId = data.item.id;
			selectedPoster = data.item.selectedPosterUrl;
			selectedBackground = data.item.selectedBackgroundUrl;
			childSel = hydrateChildren(data.childSelections);
			message = null;
			messageError = false;
			confirmApply = false;
			applyPreview = null;
			advanceAfterApply = false;
			advanceTargetHref = null;
			finishingAdvance = false;
			completionRetry = null;
			jobId = null;
			undoJobId = null;
			undoPreview = null;
			undoContextLabel = '';
			undoAvailable = false;
		}
	});

	function formatRuntime(min: number | null): string | null {
		if (!min) return null;
		const h = Math.floor(min / 60);
		const m = min % 60;
		return h ? `${h}h ${m}m` : `${m}m`;
	}

	// Locale-aware rating number (e.g. 8,5 in pt-BR / es).
	const ratingFmt = $derived(
		new Intl.NumberFormat(data.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
	);

	const metaBits = $derived(
		[
			data.item.rating ? `★ ${ratingFmt.format(data.item.rating)}` : null,
			data.item.year?.toString() ?? null,
			isShow
				? [
						data.item.seasonCount ? m.item_seasons({ count: data.item.seasonCount }) : null,
						data.item.episodeCount ? m.item_episodes({ count: data.item.episodeCount }) : null
					]
						.filter(Boolean)
						.join(' · ') || null
				: formatRuntime(data.item.runtime)
		].filter(Boolean) as string[]
	);

	const enriched = $derived(
		Boolean(data.item.backdropUrl || data.item.overview || (data.item.genres?.length ?? 0))
	);

	const PROVIDER_LABELS: Record<string, string> = {
		mediux: 'MediUX',
		tmdb: 'TMDB',
		fanarttv: 'Fanart.tv',
		theposterdb: 'ThePosterDB'
	};
	function providerLabel(id: string): string {
		return PROVIDER_LABELS[id] ?? id;
	}

	// Route REMOTE provider preview images through the on-disk thumbnail cache.
	// Leaves local/relative URLs untouched (the proxy only accepts http/https).
	function thumb(url: string): string {
		return /^https?:\/\//i.test(url) ? `/api/thumb?url=${encodeURIComponent(url)}` : url;
	}

	const jsonHeaders = { 'content-type': 'application/json' };

	/** Persist the current staged poster + background as the pending selection. */
	async function persistSelection(): Promise<boolean> {
		if (finishingAdvance) return false;
		confirmApply = false;
		applyPreview = null;
		advanceAfterApply = false;
		advanceTargetHref = null;
		completionRetry = null;
		const response = await fetch(`/api/items/${data.item.id}/select`, {
			method: 'POST',
			headers: jsonHeaders,
			body: JSON.stringify({ posterUrl: selectedPoster, backgroundUrl: selectedBackground })
		});
		return response.ok;
	}

	async function pickPoster(url: string) {
		if (finishingAdvance) return;
		selectedPoster = selectedPoster === url ? null : url;
		await persistSelection();
	}
	async function pickBackground(url: string) {
		if (finishingAdvance) return;
		selectedBackground = selectedBackground === url ? null : url;
		await persistSelection();
	}

	/** Toggle a single season/episode slot and persist it. */
	async function pickChild(kind: string, season: number, episode: number | null, url: string) {
		if (finishingAdvance) return;
		confirmApply = false;
		applyPreview = null;
		completionRetry = null;
		const key = childKey(kind, season, episode);
		const next = childSel[key] === url ? null : url;
		if (next === null) {
			const copy = { ...childSel };
			delete copy[key];
			childSel = copy;
		} else {
			childSel = { ...childSel, [key]: url };
		}
		await fetch(`/api/items/${data.item.id}/select`, {
			method: 'POST',
			headers: jsonHeaders,
			body: JSON.stringify({ child: { kind, season, episode }, url: next })
		});
	}

	/** Stage a whole set: show poster + backdrop and every season/episode slot it covers. */
	async function useSet(set: CandidateSet) {
		if (finishingAdvance) return;
		confirmApply = false;
		applyPreview = null;
		const g = groupSetArtwork(set.candidates);
		if (g.posters[0]) selectedPoster = g.posters[0].url;
		if (g.backgrounds[0]) selectedBackground = g.backgrounds[0].url;
		await persistSelection();

		const children: { kind: string; season: number; episode: number | null; url: string }[] = [];
		const seenEpisode = new Set<string>();
		for (const sg of g.seasons) {
			if (sg.posters[0]) {
				children.push({ kind: 'poster', season: sg.season, episode: null, url: sg.posters[0].url });
			}
			for (const tc of sg.titleCards) {
				if (tc.episode === null) continue;
				const epKey = `${sg.season}:${tc.episode}`;
				if (seenEpisode.has(epKey)) continue;
				seenEpisode.add(epKey);
				children.push({ kind: 'title_card', season: sg.season, episode: tc.episode, url: tc.url });
			}
		}
		if (children.length) {
			await fetch(`/api/items/${data.item.id}/select`, {
				method: 'POST',
				headers: jsonHeaders,
				body: JSON.stringify({ children })
			});
			const add: Record<string, string> = {};
			for (const c of children) add[childKey(c.kind, c.season, c.episode)] = c.url;
			childSel = { ...childSel, ...add };
		}
		setMessage(m.item_msg_set_staged());
	}

	async function useCustomUrl(which: 'poster' | 'background') {
		if (finishingAdvance) return;
		const url = (which === 'poster' ? posterUrlInput : backgroundUrlInput).trim();
		if (!url) return;
		if (which === 'poster') selectedPoster = url;
		else selectedBackground = url;
		await persistSelection();
	}

	async function discover() {
		if (busy) return;
		busy = true;
		setMessage('');
		try {
			const res = await fetch(`/api/items/${data.item.id}/discover`, { method: 'POST' });
			const result = await res.json().catch(() => ({}));
			if (!res.ok || result.error) {
				setMessage(m.item_msg_discovery_failed({ error: m.api_error_generic() }), true);
			} else {
				setMessage(
					result.count === 1
						? m.item_msg_found_cover_one({ count: result.count })
						: m.item_msg_found_covers({ count: result.count })
				);
			}
			await invalidateAll();
		} catch {
			setMessage(m.item_msg_discovery_failed({ error: m.item_error_network() }), true);
		} finally {
			busy = false;
		}
	}

	async function uploadPoster() {
		if (!posterFile || busy) return;
		busy = true;
		setMessage('');
		try {
			const fd = new FormData();
			fd.append('file', posterFile);
			if (uploadPreview) {
				fd.append('planId', uploadPreview.planId);
				fd.append('digest', uploadPreview.digest);
			}
			const res = await fetch(`/api/items/${data.item.id}/upload`, {
				method: uploadPreview ? 'PUT' : 'POST',
				body: fd
			});
			const result = await res.json().catch(() => ({}));
			if (res.ok && result.ok && result.preview) {
				uploadPreview = result.preview;
				setMessage(m.item_msg_upload_preview_ready());
			} else if (res.ok && result.ok && result.result) {
				uploadPreview = null;
				posterFile = null;
				setMessage(m.item_msg_uploaded());
				await invalidateAll();
				historyRefresh += 1;
			} else {
				if (result?.error?.code === 'plan_stale') uploadPreview = null;
				setMessage(m.item_msg_upload_failed({ error: m.api_error_generic() }), true);
			}
		} catch {
			setMessage(m.item_msg_upload_failed({ error: m.item_error_network() }), true);
		} finally {
			busy = false;
		}
	}

	async function requestUndo(scope: UndoUiScope, contextLabel: string) {
		if (busy || undoBusy) return;
		undoBusy = true;
		undoPreview = null;
		undoContextLabel = contextLabel;
		setMessage('');
		try {
			const res = await fetch(`/api/items/${data.item.id}/undo`, {
				method: 'POST',
				headers: jsonHeaders,
				body: JSON.stringify({ scope })
			});
			const result = await res.json().catch(() => ({}));
			if (res.ok && result.ok && result.preview) {
				undoPreview = result.preview as UndoPreview;
			} else {
				setMessage(m.item_undo_failed(), true);
			}
		} catch {
			setMessage(m.item_msg_revert_failed({ error: m.item_error_network() }), true);
		} finally {
			undoBusy = false;
		}
	}

	function cancelUndo(): void {
		if (undoBusy) return;
		undoPreview = null;
		undoContextLabel = '';
	}

	async function confirmUndo() {
		if (busy || undoBusy || !undoPreview) return;
		const frozenPreview = undoPreview;
		undoBusy = true;
		setMessage('');
		try {
			const res = await fetch(`/api/items/${data.item.id}/undo`, {
				method: 'PUT',
				headers: jsonHeaders,
				body: JSON.stringify({
					planId: frozenPreview.planId,
					digest: frozenPreview.digest
				})
			});
			const result = await res.json().catch(() => ({}));
			// Confirmation consumes the plan and hands it to the durable worker, so the
			// outcome arrives through job progress rather than from this response.
			if (res.ok && result.job) {
				undoJobId = result.job.jobId as number;
				setMessage(m.item_working());
			} else {
				setMessage(
					result?.error?.code === 'plan_stale' ? m.item_undo_stale() : m.item_undo_failed(),
					true
				);
			}
			undoPreview = null;
			undoContextLabel = '';
		} catch {
			setMessage(m.item_msg_revert_failed({ error: m.item_error_network() }), true);
		} finally {
			undoBusy = false;
		}
	}

	async function onUndoDone(status: string) {
		undoJobId = null;
		if (status === 'completed') setMessage(m.item_undo_success());
		else if (status === 'partial_failed') setMessage(m.item_undo_partial(), true);
		else setMessage(m.item_undo_failed(), true);
		await invalidateAll();
		historyRefresh += 1;
	}

	function previewUndoItem(): void {
		void requestUndo({ kind: 'item' }, data.item.title);
	}

	function previewUndoSeason(season: number): void {
		void requestUndo({ kind: 'season', season }, m.item_season_label({ number: season }));
	}

	function previewUndoRevision(revisionId: string): void {
		void requestUndo(
			{ kind: 'revision', revisionId },
			`${data.item.title} · ${m.item_undo_revision()}`
		);
	}

	async function toggleReviewIgnored() {
		if (!data.reviewNavigation || reviewBusy) return;
		reviewBusy = true;
		try {
			const response = await fetch(`/api/review/items/${data.item.id}`, {
				method: 'POST',
				headers: jsonHeaders,
				body: JSON.stringify({
					serverId: data.item.serverInstanceId,
					action: data.item.ignored ? 'unignored' : 'ignored',
					context: { source: 'item_detail' }
				})
			});
			if (!response.ok) throw new Error('review_action_failed');
			setMessage(m.review_action_done());
			await invalidateAll();
		} catch {
			setMessage(m.review_action_failed(), true);
		} finally {
			reviewBusy = false;
		}
	}

	function focusArtworkComparison() {
		const comparison = document.getElementById('artwork-compare');
		if (!comparison) {
			setMessage(m.review_no_comparison(), true);
			return;
		}
		comparison.focus({ preventScroll: true });
		comparison.scrollIntoView({
			block: 'start',
			behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
		});
		setMessage(m.review_comparison_focused());
	}

	function handleReviewShortcut(event: KeyboardEvent) {
		if (!data.reviewNavigation) return;
		const target = event.target instanceof HTMLElement ? event.target : null;
		if (isEditableReviewTarget(target)) return;
		if (
			reviewShortcutsBlocked({
				busy,
				reviewBusy,
				finishingAdvance,
				confirmationOpen: confirmApply,
				undoBusy,
				undoOpen: undoPreview !== null,
				modalOpen: Boolean(document.querySelector('dialog[open], [aria-modal="true"]'))
			})
		)
			return;
		const shortcut = reviewShortcutForKey(event);
		if (!shortcut) return;
		if (shortcut === 'previous' && data.reviewNavigation.previous) {
			event.preventDefault();
			void goto(data.reviewNavigation.previous.href);
		} else if (shortcut === 'next' && data.reviewNavigation.next) {
			event.preventDefault();
			void goto(data.reviewNavigation.next.href);
		} else if (shortcut === 'stage_suggestion') {
			event.preventDefault();
			void stageSuggestions();
		} else if (shortcut === 'ignore') {
			event.preventDefault();
			void toggleReviewIgnored();
		} else if (shortcut === 'compare') {
			event.preventDefault();
			focusArtworkComparison();
		} else if (shortcut === 'apply_next' && data.reviewNavigation.next) {
			event.preventDefault();
			void requestApply(true);
		}
	}

	onMount(() => {
		window.addEventListener('keydown', handleReviewShortcut);
		return () => window.removeEventListener('keydown', handleReviewShortcut);
	});

	/** Materialize the exact plan before showing the separate confirmation action. */
	async function requestApply(shouldAdvance = false) {
		if (!hasStaged) {
			advanceAfterApply = false;
			advanceTargetHref = null;
			setMessage(m.item_msg_stage_first(), true);
			return;
		}
		if (busy || finishingAdvance) return;
		advanceAfterApply = shouldAdvance;
		advanceTargetHref = shouldAdvance ? (data.reviewNavigation?.next?.href ?? null) : null;
		completionRetry = null;
		busy = true;
		setMessage('');
		try {
			const res = await fetch(`/api/items/${data.item.id}/apply`, {
				method: 'POST',
				headers: jsonHeaders,
				body: JSON.stringify({ method })
			});
			if (!res.ok) throw new Error(String(res.status));
			applyPreview = await res.json();
			confirmApply = true;
		} catch {
			advanceAfterApply = false;
			advanceTargetHref = null;
			applyPreview = null;
			confirmApply = false;
			setMessage(
				m.item_msg_apply_failed({ target: confirmTarget, error: m.item_error_network() }),
				true
			);
		} finally {
			busy = false;
		}
	}

	async function apply() {
		if (
			busy ||
			finishingAdvance ||
			!applyPreview?.planId ||
			!applyPreview.digest ||
			(advanceAfterApply && !canConfirmApplyAndNext(applyPreview))
		) {
			return;
		}
		busy = true;
		setMessage('');
		try {
			const res = await fetch(`/api/items/${data.item.id}/apply`, {
				method: 'POST',
				headers: jsonHeaders,
				body: JSON.stringify({
					planId: applyPreview.planId,
					digest: applyPreview.digest
				})
			});
			if (!res.ok) throw new Error(String(res.status));
			const result = (await res.json()) as { jobId: number };
			jobId = result.jobId;
			confirmApply = false;
			applyPreview = null;
			setMessage(m.item_working());
		} catch {
			advanceAfterApply = false;
			advanceTargetHref = null;
			confirmApply = false;
			applyPreview = null;
			setMessage(
				m.item_msg_apply_failed({ target: confirmTarget, error: m.item_error_network() }),
				true
			);
		} finally {
			busy = false;
		}
	}

	async function completeReviewAndAdvance(job: number, targetHref: string): Promise<void> {
		finishingAdvance = true;
		completionRetry = null;
		setMessage(m.review_apply_next_finishing());
		try {
			const response = await fetch(`/api/review/items/${data.item.id}/apply-next-complete`, {
				method: 'POST',
				headers: jsonHeaders,
				body: JSON.stringify({ jobId: job })
			});
			const body = (await response.json().catch(() => ({}))) as {
				state?: string;
				error?: { code?: string };
			};
			if (!response.ok || body.state !== 'completed') {
				const code = body.error?.code ?? 'internal_error';
				if (canRetryApplyNextCompletion(code)) completionRetry = { jobId: job, targetHref };
				setMessage(
					code === 'selection_changed'
						? m.review_apply_next_selection_changed()
						: code === 'job_not_verified' || code === 'review_not_completed'
							? m.review_apply_next_not_verified()
							: m.review_apply_next_completion_failed(),
					true
				);
				return;
			}
			selectedPoster = null;
			selectedBackground = null;
			childSel = {};
			setMessage(m.review_apply_next_completed());
			await invalidateAll();
			historyRefresh += 1;
			await goto(targetHref);
		} catch {
			completionRetry = { jobId: job, targetHref };
			setMessage(m.review_apply_next_completion_failed(), true);
		} finally {
			finishingAdvance = false;
		}
	}

	async function onApplyDone(status: string, progress: PublicJobProgress) {
		const shouldAdvance = advanceAfterApply;
		const targetHref = advanceTargetHref;
		advanceAfterApply = false;
		advanceTargetHref = null;
		if (shouldAdvance && targetHref) {
			if (isFullySuccessfulApply(status, progress.resultSummary)) {
				await completeReviewAndAdvance(progress.jobId, targetHref);
				return;
			}
			completionRetry = null;
			setMessage(
				progress.resultSummary.skipped > 0
					? m.review_apply_next_skipped({ count: progress.resultSummary.skipped })
					: m.review_apply_next_stayed({ status: jobStatusLabel(status) }),
				true
			);
		} else if (status === 'completed') {
			setMessage(m.item_msg_applied());
		} else {
			setMessage(
				m.item_msg_apply_failed({ target: confirmTarget, error: jobStatusLabel(status) }),
				true
			);
		}
		await invalidateAll();
		historyRefresh += 1;
	}
</script>

<svelte:head><title>{data.item.title} · PosterPilot</title></svelte:head>

{#snippet posterTile(c: PosterCandidate)}
	<button
		type="button"
		onclick={() => pickPoster(c.url)}
		aria-pressed={selectedPoster === c.url}
		aria-label={m.item_candidate_label({ kind: m.item_poster(), provider: c.provider })}
		class="relative overflow-hidden rounded-lg border-2 transition {selectedPoster === c.url
			? 'border-accent-500'
			: 'border-transparent hover:border-neutral-600'}"
	>
		{#if suggestions.ids.has(c.id)}{@render suggestedChip()}{/if}
		<img src={thumb(c.url)} alt="" loading="lazy" class="aspect-[2/3] w-full object-cover" />
	</button>
{/snippet}

{#snippet backdropTile(c: PosterCandidate)}
	<button
		type="button"
		onclick={() => pickBackground(c.url)}
		aria-pressed={selectedBackground === c.url}
		aria-label={m.item_candidate_label({ kind: m.item_backdrop(), provider: c.provider })}
		class="relative overflow-hidden rounded-lg border-2 transition {selectedBackground === c.url
			? 'border-accent-500'
			: 'border-transparent hover:border-neutral-600'}"
	>
		{#if suggestions.ids.has(c.id)}{@render suggestedChip()}{/if}
		<img src={thumb(c.url)} alt="" loading="lazy" class="aspect-video w-full object-cover" />
	</button>
{/snippet}

{#snippet seasonPosterTile(c: PosterCandidate, season: number)}
	<button
		type="button"
		onclick={() => pickChild('poster', season, null, c.url)}
		aria-pressed={isChildStaged('poster', season, null, c.url)}
		aria-label={m.item_candidate_label({
			kind: `${m.item_season_label({ number: season })} · ${m.item_poster()}`,
			provider: c.provider
		})}
		class="relative overflow-hidden rounded-lg border-2 transition {isChildStaged(
			'poster',
			season,
			null,
			c.url
		)
			? 'border-accent-500'
			: 'border-transparent hover:border-neutral-600'}"
	>
		{#if suggestions.ids.has(c.id)}{@render suggestedChip()}{/if}
		<img src={thumb(c.url)} alt="" loading="lazy" class="aspect-[2/3] w-full object-cover" />
	</button>
{/snippet}

{#snippet titleCardTile(c: PosterCandidate, season: number)}
	<button
		type="button"
		onclick={() => pickChild('title_card', season, c.episode, c.url)}
		aria-pressed={isChildStaged('title_card', season, c.episode, c.url)}
		aria-label={m.item_candidate_label({
			kind: `${m.item_season_label({ number: season })} · ${m.item_episode_label({ number: c.episode ?? 0 })} · ${m.item_title_card()}`,
			provider: c.provider
		})}
		class="relative overflow-hidden rounded-lg border-2 transition {isChildStaged(
			'title_card',
			season,
			c.episode,
			c.url
		)
			? 'border-accent-500'
			: 'border-transparent hover:border-neutral-600'}"
	>
		{#if suggestions.ids.has(c.id)}{@render suggestedChip()}{/if}
		<img src={thumb(c.url)} alt="" loading="lazy" class="aspect-video w-full object-cover" />
	</button>
{/snippet}

{#snippet suggestedChip()}
	<!-- Top-scored pick for this slot. Icon + label (never color alone); overridable. -->
	<span
		class="pointer-events-none absolute top-1.5 left-1.5 z-10 inline-flex items-center gap-1 rounded-full bg-accent-500/90 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm ring-1 ring-black/30"
	>
		<span aria-hidden="true">✦</span>{m.item_suggested()}
	</span>
{/snippet}

{#snippet chevron(open: boolean)}
	<span
		class="inline-block text-neutral-500 transition-transform motion-reduce:transition-none {open
			? 'rotate-90'
			: ''}"
		aria-hidden="true">▸</span
	>
{/snippet}

<div class="flex flex-wrap items-center justify-between gap-3">
	<a
		href={data.returnTo}
		onclick={returnToContext}
		class="text-sm text-neutral-400 hover:text-neutral-200"
		>{data.isReviewReturn ? m.review_back_to_inbox() : m.item_back_to_library()}</a
	>
	{#if data.reviewNavigation}
		<nav class="flex items-center gap-2" aria-label={m.review_item_navigation()}>
			{#if data.reviewNavigation.previous}
				<a
					class="btn btn-ghost"
					href={data.reviewNavigation.previous.href}
					rel="prev"
					aria-keyshortcuts="K">← {m.review_previous_item()}</a
				>
			{:else}
				<button class="btn btn-ghost" type="button" disabled>← {m.review_previous_item()}</button>
			{/if}
			<span class="hidden text-xs text-neutral-500 sm:inline">
				{m.review_context_count({ count: data.reviewNavigation.matchingCount })}
			</span>
			{#if data.reviewNavigation.next}
				<a
					class="btn btn-ghost"
					href={data.reviewNavigation.next.href}
					rel="next"
					aria-keyshortcuts="J">{m.review_next_item()} →</a
				>
			{:else}
				<button class="btn btn-ghost" type="button" disabled>{m.review_next_item()} →</button>
			{/if}
		</nav>
	{/if}
</div>
{#if data.reviewNavigation}
	<details class="mt-2 text-xs text-neutral-500">
		<summary class="w-fit cursor-pointer hover:text-neutral-300"
			>{m.review_shortcuts_title()}</summary
		>
		<p class="mt-2 flex flex-wrap gap-x-4 gap-y-1" aria-label={m.review_shortcuts_title()}>
			<span><kbd>K</kbd> {m.review_previous_item()}</span>
			<span><kbd>J</kbd> {m.review_next_item()}</span>
			<span><kbd>S</kbd> {m.review_stage_suggestion()}</span>
			<span><kbd>I</kbd> {data.item.ignored ? m.review_restore() : m.review_ignore()}</span>
			<span><kbd>C</kbd> {m.review_compare_action()}</span>
			<span><kbd>A</kbd> {m.review_apply_next()}</span>
		</p>
	</details>
{/if}

<!-- Hero -->
<section class="relative mt-3 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950">
	{#if data.item.hasCurrentBackground || data.item.backdropUrl}
		<img
			src={data.item.hasCurrentBackground
				? `/api/artwork/${data.item.id}/background?v=${data.item.currentBackgroundFingerprint ?? data.item.artworkVersion}`
				: data.item.backdropUrl}
			alt=""
			class="absolute inset-0 h-full w-full object-cover"
		/>
	{/if}
	<div
		class="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/80 to-neutral-950/30"
	></div>
	<div class="absolute inset-0 bg-gradient-to-r from-neutral-950/90 to-transparent"></div>

	<div class="relative flex flex-col gap-5 p-5 sm:flex-row sm:items-end sm:p-7">
		<div
			class="w-32 flex-none overflow-hidden rounded-lg border border-neutral-800 shadow-2xl sm:w-40"
		>
			{#if data.item.hasCurrentPoster}
				<img
					src={`/api/artwork/${data.item.id}/poster?v=${data.item.currentPosterFingerprint ?? data.item.artworkVersion}`}
					alt={data.item.title}
					class="w-full"
				/>
			{:else}
				<div class="flex aspect-[2/3] items-center justify-center text-neutral-400">
					{m.item_no_poster()}
				</div>
			{/if}
		</div>

		<div class="min-w-0 flex-1">
			{#if data.item.logoUrl}
				<img
					src={data.item.logoUrl}
					alt={data.item.title}
					class="max-h-24 max-w-[60%] object-contain drop-shadow-lg"
				/>
			{:else}
				<h1 class="text-3xl font-bold tracking-tight">{data.item.title}</h1>
			{/if}

			{#if metaBits.length}
				<p class="mt-2 text-sm text-neutral-300">
					{#each metaBits as bit, i (bit)}{#if i > 0}<span class="text-neutral-400">
								·
							</span>{/if}<span class={bit.startsWith('★') ? 'font-semibold text-amber-300' : ''}
							>{bit}</span
						>{/each}
				</p>
			{/if}

			{#if data.item.genres?.length}
				<div class="mt-2 flex flex-wrap gap-1.5">
					{#each data.item.genres as g (g)}<span class="chip">{g}</span>{/each}
				</div>
			{/if}

			{#if data.item.tagline}
				<p class="mt-3 text-sm text-neutral-400 italic">“{data.item.tagline}”</p>
			{/if}
			{#if data.item.overview}
				<p class="mt-2 line-clamp-3 max-w-2xl text-sm text-neutral-300">{data.item.overview}</p>
			{/if}

			<div class="mt-4 flex flex-wrap items-center gap-2">
				<button onclick={discover} disabled={busy || !data.item.resolved} class="btn btn-subtle">
					{busy ? m.item_working() : m.item_find_covers()}
				</button>
				{#if suggestions.ids.size > 0}
					<button
						type="button"
						class="btn btn-accent"
						disabled={busy}
						aria-keyshortcuts="S"
						onclick={stageSuggestions}>{m.review_stage_suggestion()}</button
					>
				{/if}
				{#if data.providerGroups.length > 0}
					<button
						type="button"
						class="btn btn-ghost"
						aria-keyshortcuts="C"
						onclick={focusArtworkComparison}>{m.review_compare_action()}</button
					>
				{/if}
				<a href="#artwork-history-title" class="btn btn-ghost">{m.item_history_title()}</a>
				{#if data.reviewNavigation}
					<button
						type="button"
						class="btn btn-ghost"
						disabled={reviewBusy}
						aria-keyshortcuts="I"
						onclick={toggleReviewIgnored}
						>{data.item.ignored ? m.review_restore() : m.review_ignore()}</button
					>
				{/if}
				{#if undoAvailable}
					<button
						type="button"
						onclick={previewUndoItem}
						disabled={busy || undoBusy}
						class="btn btn-ghost">{m.item_undo_item()}</button
					>
				{/if}
			</div>

			{#if !enriched}
				<p class="mt-3 text-xs text-neutral-400">
					{m.item_no_metadata()}
				</p>
			{/if}
		</div>
	</div>
</section>

<ManualTmdbMatch item={data.item} locale={data.locale} />

{#if data.item.cast?.length}
	<section class="mt-6">
		<h2 class="section-title">{m.item_cast()}</h2>
		<div class="flex gap-4 overflow-x-auto pb-2">
			{#each data.item.cast as person (person.name)}
				<div class="w-20 flex-none text-center">
					<div
						class="aspect-[2/3] w-20 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900"
					>
						{#if person.profileUrl}
							<img
								src={person.profileUrl}
								alt={person.name}
								loading="lazy"
								class="h-full w-full object-cover"
							/>
						{/if}
					</div>
					<p class="mt-1 truncate text-xs font-medium text-neutral-200" title={person.name}>
						{person.name}
					</p>
					{#if person.character}<p
							class="truncate text-[10px] text-neutral-400"
							title={person.character}
						>
							{person.character}
						</p>{/if}
				</div>
			{/each}
		</div>
	</section>
{/if}

<!-- Artwork sets, grouped by provider (collapsible) -->
<div id="artwork-compare" tabindex="-1" class="scroll-mt-20 focus-visible:outline-none"></div>
{#if data.providerGroups.length}
	<section class="mt-8 space-y-6 pb-4">
		{#each data.providerGroups as group (group.provider)}
			{@const pKey = providerKey(group.provider)}
			<div>
				<button
					type="button"
					onclick={() => toggle(pKey)}
					aria-expanded={isExpanded(pKey)}
					aria-label={isExpanded(pKey) ? m.item_collapse() : m.item_expand()}
					class="section-title flex w-full items-center gap-2"
				>
					{@render chevron(isExpanded(pKey))}
					<span>
						{group.sets.length === 1
							? m.item_set_count_one({
									provider: providerLabel(group.provider),
									count: group.sets.length
								})
							: m.item_set_count({
									provider: providerLabel(group.provider),
									count: group.sets.length
								})}
					</span>
				</button>

				{#if isExpanded(pKey)}
					<div class="mt-2 space-y-4">
						{#each group.sets as set (set.setId)}
							{@const sKey = setKey(set.setId)}
							{@const g = groupSetArtwork(set.candidates)}
							<div class="surface p-4">
								<div class="flex items-center justify-between">
									<button
										type="button"
										onclick={() => toggle(sKey)}
										aria-expanded={isExpanded(sKey)}
										class="flex items-center gap-2 text-sm text-neutral-300"
									>
										{@render chevron(isExpanded(sKey))}
										{#if set.author}{m.item_set_by()}
											<span class="font-semibold text-neutral-100">{set.author}</span>{:else}<span
												class="text-neutral-400">{m.item_set_unattributed()}</span
											>{/if}
									</button>
									{#if g.posters.length || g.backgrounds.length || g.seasons.length}
										<button onclick={() => useSet(set)} class="btn btn-accent px-3 py-1 text-xs"
											>{m.item_use_set()}</button
										>
									{/if}
								</div>

								{#if isExpanded(sKey)}
									<div class="mt-3 flex flex-col gap-4 sm:flex-row">
										{#if g.posters.length}
											<div class="min-w-0 flex-1">
												<p class="mb-1 text-[11px] text-neutral-400">
													{g.posters.length > 1 ? m.item_posters() : m.item_poster()}
												</p>
												<div class="flex gap-2 overflow-x-auto pb-2">
													{#each g.posters as c (c.id)}<div class="w-20 flex-none">
															{@render posterTile(c)}
														</div>{/each}
												</div>
											</div>
										{/if}
										{#if g.backgrounds.length}
											<div class="min-w-0 flex-1">
												<p class="mb-1 text-[11px] text-neutral-400">
													{g.backgrounds.length > 1 ? m.item_backdrops() : m.item_backdrop()}
												</p>
												<div class="grid grid-cols-2 gap-2">
													{#each g.backgrounds as c (c.id)}{@render backdropTile(c)}{/each}
												</div>
											</div>
										{/if}
									</div>

									{#if isShow}
										{#each g.seasons as sg (sg.season)}
											{@const seaKey = seasonKey(set.setId, sg.season)}
											<div class="mt-4 rounded-lg border border-neutral-800 p-3">
												<div class="flex items-center justify-between">
													<button
														type="button"
														onclick={() => toggle(seaKey)}
														aria-expanded={isExpanded(seaKey)}
														class="flex items-center gap-2 text-sm font-medium text-neutral-200"
													>
														{@render chevron(isExpanded(seaKey))}
														{m.item_season_label({ number: sg.season })}
													</button>
													{#if undoAvailable}
														<button
															type="button"
															onclick={() => previewUndoSeason(sg.season)}
															disabled={busy || undoBusy}
															class="btn btn-ghost px-2 py-1 text-xs">{m.item_undo_season()}</button
														>
													{/if}
												</div>

												{#if isExpanded(seaKey)}
													{#if sg.posters.length}
														<p class="mt-2 mb-1 text-[11px] text-neutral-400">
															{sg.posters.length > 1 ? m.item_posters() : m.item_poster()}
														</p>
														<div class="grid grid-cols-4 gap-2 sm:grid-cols-8">
															{#each sg.posters as c (c.id)}{@render seasonPosterTile(
																	c,
																	sg.season
																)}{/each}
														</div>
													{/if}
													{#if sg.titleCards.length}
														<p class="mt-3 mb-1 text-[11px] text-neutral-400">
															{m.item_title_cards({ count: sg.titleCards.length })}
														</p>
														<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
															{#each sg.titleCards as c (c.id)}{@render titleCardTile(
																	c,
																	sg.season
																)}{/each}
														</div>
													{/if}
												{/if}
											</div>
										{/each}
									{/if}
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/each}
	</section>
{:else}
	<p class="mt-8 pb-4 text-sm text-neutral-400">
		{data.item.resolved ? m.item_no_candidates_resolved() : m.item_no_candidates_unresolved()}
	</p>
{/if}

<div class="pb-28">
	<ArtworkTimeline
		itemId={data.item.id}
		locale={data.locale}
		refreshToken={historyRefresh}
		onUndoItem={previewUndoItem}
		onUndoRevision={previewUndoRevision}
		onUndoAvailabilityChange={(available) => (undoAvailable = available)}
	/>
</div>

{#if jobId !== null}
	<div class="mt-6 pb-28"><JobProgress {jobId} onDone={onApplyDone} /></div>
{/if}

{#if undoJobId}
	<div class="mt-6 pb-28"><JobProgress jobId={undoJobId} onDone={onUndoDone} /></div>
{/if}

<ArtworkUndoDialog
	open={undoPreview !== null}
	busy={undoBusy}
	preview={undoPreview}
	contextLabel={undoContextLabel}
	onConfirm={confirmUndo}
	onCancel={cancelUndo}
/>

<!-- Sticky custom-set builder -->
<div
	class="fixed inset-x-0 bottom-0 z-30 border-t border-accent-900/40 bg-neutral-950/95 backdrop-blur"
>
	<div class="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-2.5">
		{#if message}
			<p
				role={messageError ? 'alert' : 'status'}
				aria-live={messageError ? 'assertive' : 'polite'}
				class="basis-full text-xs {messageError ? 'text-red-300' : 'text-neutral-300'}"
			>
				{message}
			</p>
		{/if}
		{#if completionRetry}
			<div class="basis-full">
				<button
					type="button"
					class="btn btn-subtle px-3 py-1.5 text-xs"
					disabled={finishingAdvance}
					onclick={() =>
						completeReviewAndAdvance(completionRetry!.jobId, completionRetry!.targetHref)}
				>
					{finishingAdvance
						? m.review_apply_next_finishing()
						: m.review_apply_next_retry_completion()}
				</button>
			</div>
		{/if}
		{#if confirmApply && advanceAfterApply && applyPreview && !canConfirmApplyAndNext(applyPreview)}
			<p class="basis-full text-xs text-amber-300" role="alert">
				{applyPreview.summary.skipCount > 0
					? m.review_apply_next_preview_skips({ count: applyPreview.summary.skipCount })
					: m.review_apply_next_preview_incomplete()}
			</p>
		{/if}
		<div class="flex items-center gap-2">
			<div
				class="h-[51px] w-[34px] flex-none overflow-hidden rounded border border-neutral-700 bg-neutral-900"
			>
				{#if selectedPoster}<img
						src={selectedPoster}
						alt=""
						class="h-full w-full object-cover"
					/>{/if}
			</div>
			<div
				class="h-[45px] w-20 flex-none overflow-hidden rounded border border-neutral-700 bg-neutral-900"
			>
				{#if selectedBackground}<img
						src={selectedBackground}
						alt=""
						class="h-full w-full object-cover"
					/>{/if}
			</div>
		</div>
		<span class="text-xs text-neutral-400">
			{selectedPoster ? m.item_label_poster() : m.item_label_no_poster()}{selectedBackground
				? m.item_label_backdrop_suffix()
				: ''}{#if stagedSeasons}
				· {m.item_staged_seasons({ count: stagedSeasons })}{/if}{#if stagedEpisodes}
				· {m.item_staged_episodes({ count: stagedEpisodes })}{/if}
		</span>

		<details class="text-xs">
			<summary class="cursor-pointer text-neutral-400 hover:text-neutral-200"
				>{m.item_custom()}</summary
			>
			<div
				class="absolute bottom-14 left-4 flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-3 shadow-xl"
			>
				<div class="flex gap-1.5">
					<input
						bind:value={posterUrlInput}
						placeholder={m.item_poster_url_placeholder()}
						class="input w-56 py-1 text-xs"
					/>
					<button onclick={() => useCustomUrl('poster')} class="btn btn-subtle px-2 py-1 text-xs"
						>{m.item_set()}</button
					>
				</div>
				<div class="flex gap-1.5">
					<input
						bind:value={backgroundUrlInput}
						placeholder={m.item_backdrop_url_placeholder()}
						class="input w-56 py-1 text-xs"
					/>
					<button
						onclick={() => useCustomUrl('background')}
						class="btn btn-subtle px-2 py-1 text-xs">{m.item_set()}</button
					>
				</div>
				<div class="flex items-center gap-1.5">
					<input
						type="file"
						accept="image/jpeg,image/png,image/webp"
						aria-label={m.item_upload_file_label()}
						onchange={(e) => {
							posterFile = e.currentTarget.files?.[0] ?? null;
							uploadPreview = null;
						}}
						class="max-w-[180px] text-[11px] text-neutral-400"
					/>
					<button
						onclick={uploadPoster}
						disabled={busy || !posterFile}
						class={uploadPreview
							? 'btn btn-accent px-2 py-1 text-xs'
							: 'btn btn-subtle px-2 py-1 text-xs'}
						>{uploadPreview ? m.item_upload_confirm() : m.item_upload_preview()}</button
					>
				</div>
				{#if uploadPreview}
					<div class="rounded border border-neutral-700 bg-neutral-950/70 p-2" role="status">
						<p class="text-[11px] text-neutral-200">
							{m.item_upload_preview_summary({
								size: (uploadPreview.image.sizeBytes / (1024 * 1024)).toFixed(1)
							})}
						</p>
						<button
							type="button"
							class="mt-1 text-[11px] text-neutral-400 underline hover:text-neutral-200"
							onclick={() => (uploadPreview = null)}>{m.item_upload_cancel()}</button
						>
					</div>
				{/if}
				<p class="text-[10px] text-neutral-400">
					{m.item_upload_hint()}
				</p>
			</div>
		</details>

		<div class="ml-auto flex items-center gap-2">
			<select
				bind:value={method}
				disabled={finishingAdvance}
				onchange={() => {
					confirmApply = false;
					applyPreview = null;
					advanceAfterApply = false;
					advanceTargetHref = null;
					completionRetry = null;
				}}
				aria-label={m.library_apply_method_label()}
				class="input py-1 text-xs"
			>
				<option value="both">{m.library_method_both()}</option>
				<option value="plex">{m.library_method_plex()}</option>
				<option value="kometa">{m.library_method_kometa()}</option>
			</select>
			{#if confirmApply}
				<!-- Confirm the exact frozen destination operations. -->
				<span class="hidden text-xs text-neutral-200 sm:inline"
					>{advanceAfterApply
						? m.review_apply_next_confirm({ target: confirmTarget })
						: m.item_apply_confirm({ target: confirmTarget })}
					{#if applyPreview}
						· {m.library_preview_summary({
							uploads: applyPreview.summary.destinations.server,
							exports: applyPreview.summary.destinations.kometa,
							skipped: applyPreview.summary.skipCount
						})}
					{/if}</span
				>
				<button
					onclick={apply}
					disabled={busy ||
						finishingAdvance ||
						!applyPreview?.planId ||
						!applyPreview.digest ||
						(advanceAfterApply && !canConfirmApplyAndNext(applyPreview))}
					class="btn btn-accent"
				>
					{busy
						? m.item_working()
						: advanceAfterApply
							? m.review_confirm_apply_next()
							: m.library_apply_confirm_yes()}
				</button>
				<button
					onclick={() => {
						confirmApply = false;
						applyPreview = null;
						advanceAfterApply = false;
						advanceTargetHref = null;
					}}
					disabled={busy || finishingAdvance}
					class="btn btn-ghost"
				>
					{m.jobs_cancel()}
				</button>
			{:else}
				<button
					onclick={() => requestApply(false)}
					disabled={busy || finishingAdvance || !hasStaged}
					class="btn btn-accent">{busy ? m.item_working() : m.item_apply()}</button
				>
				{#if data.reviewNavigation?.next}
					<button
						type="button"
						class="btn btn-subtle"
						disabled={busy || finishingAdvance || !hasStaged}
						aria-keyshortcuts="A"
						onclick={() => requestApply(true)}>{m.review_apply_next()}</button
					>
				{/if}
			{/if}
		</div>
	</div>
</div>
