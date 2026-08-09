<script lang="ts">
	import { onMount } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import type { PosterCandidate } from '$lib/server/db/schema';
	import type { CandidateSet } from '$lib/server/posters/sets';
	import { groupSetArtwork } from '$lib/posters/season-groups';
	import { defaultExpanded, providerKey, setKey, seasonKey } from '$lib/posters/collapse';
	import {
		CANDIDATE_DISCLOSURE_BATCH_SIZE,
		artworkLanguageName,
		candidateDisclosureKey,
		disclosureState,
		isLanguageFallbackCandidate,
		nextDisclosureLimit,
		summarizeCandidateLanguages,
		visibleArtworkCandidates
	} from '$lib/posters/candidate-disclosure';
	import {
		resolveArtworkLanguagePolicy,
		type ArtworkLanguagePolicy
	} from '$lib/tmdb-artwork-language';
	import {
		stagedArtworkMatchesCandidate,
		toggleStagedArtworkCandidate
	} from '$lib/posters/selection-match';
	import { coverageBreakdown, coverageOccurrenceReport } from '$lib/coverage-presentation';
	import { m } from '$lib/paraglide/messages';
	import CoverageBadge from '$lib/components/CoverageBadge.svelte';
	import JobProgress from '$lib/components/JobProgress.svelte';
	import ApplySkipReasons from '$lib/components/ApplySkipReasons.svelte';
	import ManualTmdbMatch from '$lib/components/ManualTmdbMatch.svelte';
	import ArtworkTimeline from '$lib/components/ArtworkTimeline.svelte';
	import ArtworkUndoDialog from '$lib/components/ArtworkUndoDialog.svelte';
	import ArtworkPreviewDialog from '$lib/components/ArtworkPreviewDialog.svelte';
	import type { PublicJobProgress } from '$lib/job-progress';
	import { jobStatusLabel } from '$lib/job-labels';
	import {
		canConfirmApplyAndNext,
		canRetryApplyNextCompletion,
		isFullySuccessfulApply,
		shouldAutoConfirmApply
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
	let selectedPosterCandidateId = $state<number | null>(data.item.selectedPosterCandidateId);
	// svelte-ignore state_referenced_locally
	let selectedPosterProvider = $state<string | null>(data.item.selectedPosterProvider);
	// svelte-ignore state_referenced_locally
	let selectedBackground = $state<string | null>(data.item.selectedBackgroundUrl);
	// svelte-ignore state_referenced_locally
	let selectedBackgroundCandidateId = $state<number | null>(
		data.item.selectedBackgroundCandidateId
	);
	// svelte-ignore state_referenced_locally
	let selectedBackgroundProvider = $state<string | null>(data.item.selectedBackgroundProvider);
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
		items: Array<{ skips: Array<{ code: string }> }>;
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
	function hydrateChildCandidateIds(
		rows: typeof data.childSelections
	): Record<string, number | null> {
		const out: Record<string, number | null> = {};
		for (const r of rows) out[childKey(r.kind, r.season, r.episode)] = r.candidateId;
		return out;
	}
	function hydrateChildProviders(rows: typeof data.childSelections): Record<string, string | null> {
		const out: Record<string, string | null> = {};
		for (const r of rows) out[childKey(r.kind, r.season, r.episode)] = r.provider;
		return out;
	}
	// svelte-ignore state_referenced_locally
	let childSel = $state<Record<string, string>>(hydrateChildren(data.childSelections));
	// svelte-ignore state_referenced_locally
	let childCandidateIds = $state<Record<string, number | null>>(
		hydrateChildCandidateIds(data.childSelections)
	);
	// svelte-ignore state_referenced_locally
	let childProviders = $state<Record<string, string | null>>(
		hydrateChildProviders(data.childSelections)
	);
	function syncSelectionStateFromData() {
		selectedPoster = data.item.selectedPosterUrl;
		selectedPosterCandidateId = data.item.selectedPosterCandidateId;
		selectedPosterProvider = data.item.selectedPosterProvider;
		selectedBackground = data.item.selectedBackgroundUrl;
		selectedBackgroundCandidateId = data.item.selectedBackgroundCandidateId;
		selectedBackgroundProvider = data.item.selectedBackgroundProvider;
		childSel = hydrateChildren(data.childSelections);
		childCandidateIds = hydrateChildCandidateIds(data.childSelections);
		childProviders = hydrateChildProviders(data.childSelections);
	}
	async function recoverSelectionFailure() {
		try {
			await invalidateAll();
		} catch {
			// Keep the last server-rendered snapshot if revalidation itself is unavailable.
		} finally {
			syncSelectionStateFromData();
			setMessage(m.collection_suggestion_failed(), true);
		}
	}
	function isChildStaged(
		kind: string,
		season: number,
		episode: number | null,
		candidate: PosterCandidate
	) {
		const key = childKey(kind, season, episode);
		return stagedArtworkMatchesCandidate(
			{
				url: childSel[key],
				candidateId: childCandidateIds[key],
				provider: childProviders[key]
			},
			candidate
		);
	}
	function isRootStaged(kind: 'poster' | 'background', candidate: PosterCandidate): boolean {
		return stagedArtworkMatchesCandidate(
			{
				url: kind === 'poster' ? selectedPoster : selectedBackground,
				candidateId: kind === 'poster' ? selectedPosterCandidateId : selectedBackgroundCandidateId,
				provider: kind === 'poster' ? selectedPosterProvider : selectedBackgroundProvider
			},
			candidate
		);
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
	// ---- Artwork language ------------------------------------------------------
	// The saved preference decides what this page shows; the toggle below is
	// item-local `$state` and deliberately never writes to /api/settings, so
	// browsing every language for one title cannot change the global default.
	let showAllLanguages = $state(false);
	const preferredLanguagePolicy = $derived(
		resolveArtworkLanguagePolicy(data.tmdbArtworkLanguage, data.locale)
	);
	const languagePolicy = $derived<ArtworkLanguagePolicy>(
		showAllLanguages ? { mode: 'all' } : preferredLanguagePolicy
	);
	const preferredLanguageName = $derived(
		preferredLanguagePolicy.mode === 'preferred'
			? artworkLanguageName(preferredLanguagePolicy.language)
			: ''
	);
	// A persisted pick stays visible under a restricted policy: an automatic
	// language fallback has to be reviewable (and revocable) rather than hidden by
	// the very preference that produced it. Read from the server payload, not from
	// local staging, so picking artwork never makes a tile vanish mid-session.
	const pinnedCandidateIds = $derived(
		new Set(
			[
				data.item.selectedPosterCandidateId,
				data.item.selectedBackgroundCandidateId,
				...data.childSelections.map((row) => row.candidateId)
			].filter((id): id is number => id !== null)
		)
	);
	function visibleCandidatesOf(candidates: PosterCandidate[]): PosterCandidate[] {
		return visibleArtworkCandidates(candidates, languagePolicy, (candidate) =>
			pinnedCandidateIds.has(candidate.id)
		);
	}
	/** True for a rendered tile the preference would otherwise have filtered away. */
	function isLanguageFallback(candidate: PosterCandidate): boolean {
		return isLanguageFallbackCandidate(candidate, preferredLanguagePolicy);
	}
	function candidateLanguageName(candidate: PosterCandidate): string {
		return candidate.languageProvenance === 'tagged'
			? artworkLanguageName(candidate.language)
			: m.item_language_unverified();
	}
	const visibleCandidates = $derived(visibleCandidatesOf(data.candidates));
	const languageSummary = $derived(summarizeCandidateLanguages(data.candidates, languagePolicy));
	// Provider groups re-derived from the filtered inventory so every set count,
	// every grid and every "load more" total describes what is actually reachable.
	const visibleProviderGroups = $derived(
		data.providerGroups.map((group) => ({
			provider: group.provider,
			sets: group.sets
				.map((set) => ({ ...set, candidates: visibleCandidatesOf(set.candidates) }))
				.filter((set) => set.candidates.length > 0),
			language: summarizeCandidateLanguages(
				group.sets.flatMap((set) => set.candidates),
				languagePolicy
			),
			truncatedKinds: data.truncatedKinds[group.provider] ?? []
		}))
	);

	// ---- Progressive disclosure (per provider × set × artwork kind) -------------
	// Undisclosed tiles are not rendered at all: `loading="lazy"` still mounts the
	// element, and a set can carry hundreds of images.
	let disclosureLimits = $state<Record<string, number>>({});
	let disclosureAnnouncement = $state('');
	function disclosureFor(key: string, total: number) {
		return disclosureState(
			disclosureLimits[key] ?? CANDIDATE_DISCLOSURE_BATCH_SIZE,
			total,
			CANDIDATE_DISCLOSURE_BATCH_SIZE
		);
	}
	function revealMore(key: string, total: number) {
		const next = nextDisclosureLimit(
			disclosureLimits[key] ?? CANDIDATE_DISCLOSURE_BATCH_SIZE,
			total,
			CANDIDATE_DISCLOSURE_BATCH_SIZE
		);
		disclosureLimits = { ...disclosureLimits, [key]: next };
		disclosureAnnouncement = m.item_disclosure_announcement({ shown: next, total });
	}

	// Reactive (recomputes after discovery refreshes the candidate list). Fed the
	// language-filtered list so a suggestion is never hidden by the filter.
	const suggestions = $derived(computeSuggestions(visibleCandidates, data.suggestPreselect));

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
		const rootPatch: RootSelectionPatch = {};
		if (!selectedPoster && s.poster) {
			rootPatch.poster = { url: s.poster.url, candidateId: s.poster.id };
		}
		if (!selectedBackground && s.background) {
			rootPatch.background = { url: s.background.url, candidateId: s.background.id };
		}
		const children: {
			kind: string;
			season: number;
			episode: number | null;
			url: string;
			candidateId: number;
			provider: string;
		}[] = [];
		for (const [season, c] of s.seasonPosters) {
			if (!childSel[childKey('poster', season, null)]) {
				children.push({
					kind: 'poster',
					season,
					episode: null,
					url: c.url,
					candidateId: c.id,
					provider: c.provider
				});
			}
		}
		for (const c of s.titleCards.values()) {
			if (c.season == null || c.episode == null) continue;
			if (!childSel[childKey('title_card', c.season, c.episode)]) {
				children.push({
					kind: 'title_card',
					season: c.season,
					episode: c.episode,
					url: c.url,
					candidateId: c.id,
					provider: c.provider
				});
			}
		}
		try {
			const showChanged = Boolean(rootPatch.poster || rootPatch.background);
			if (showChanged && !(await persistSelection(rootPatch))) {
				throw new Error('selection_failed');
			}
			if (children.length) {
				const res = await fetch(`/api/items/${data.item.id}/select`, {
					method: 'POST',
					headers: jsonHeaders,
					body: JSON.stringify({ children })
				});
				if (!res.ok) throw new Error('selection_failed');
			}
			if (showChanged || children.length) {
				if (rootPatch.poster && s.poster) {
					selectedPoster = s.poster.url;
					selectedPosterCandidateId = s.poster.id;
					selectedPosterProvider = s.poster.provider;
				}
				if (rootPatch.background && s.background) {
					selectedBackground = s.background.url;
					selectedBackgroundCandidateId = s.background.id;
					selectedBackgroundProvider = s.background.provider;
				}
				const add: Record<string, string> = {};
				const addIds: Record<string, number | null> = {};
				const addProviders: Record<string, string | null> = {};
				for (const c of children) {
					const key = childKey(c.kind, c.season, c.episode);
					add[key] = c.url;
					addIds[key] = c.candidateId;
					addProviders[key] = c.provider;
				}
				childSel = { ...childSel, ...add };
				childCandidateIds = { ...childCandidateIds, ...addIds };
				childProviders = { ...childProviders, ...addProviders };
				setMessage(m.review_suggestion_staged());
				if (data.reviewNavigation) {
					void fetch(`/api/review/items/${data.item.id}`, {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({
							serverId: data.item.serverInstanceId,
							action: 'staged',
							context: { source: 'item_detail' }
						})
					}).catch(() => undefined);
				}
			} else {
				setMessage(m.review_no_suggestion_to_stage());
			}
		} catch {
			await recoverSelectionFailure();
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

	// ---- Full-size preview -----------------------------------------------------
	// Preview is a sibling action, never a selection side effect: opening, walking
	// and closing the dialog touch no staged slot and persist nothing.
	let previewOpen = $state(false);
	let previewIndex = $state(0);
	let previewTrigger = $state<HTMLElement | null>(null);
	/**
	 * Exactly the candidates on screen, in render order. Walks the same path the
	 * markup below does — expanded provider, expanded set, poster then backdrop
	 * pane, then each expanded season — so previous/next can never reach artwork the
	 * language filter, the collapse state or a disclosure limit is currently hiding.
	 * Keep this walk in lockstep with the candidate grids; the dialog is handed this
	 * sequence rather than re-deriving visibility for itself.
	 */
	const previewSequence = $derived.by(() => {
		const sequence: PosterCandidate[] = [];
		const disclosed = (key: string, candidates: PosterCandidate[]) =>
			candidates.slice(0, disclosureFor(key, candidates.length).shown);
		for (const group of visibleProviderGroups) {
			if (!isExpanded(providerKey(group.provider))) continue;
			for (const set of group.sets) {
				if (!isExpanded(setKey(set.setId))) continue;
				const g = groupSetArtwork(set.candidates);
				// `season` carries an explicit default instead of being optional: the dev
				// server's TypeScript strip drops the annotation but leaves the `?` on
				// the parameter, which is invalid JS. It 500s the page under `vite dev`
				// — which is what the E2E suite runs — while `svelte-check` and
				// `bun run build` both accept it.
				const pane = (
					kind: 'poster' | 'background' | 'season' | 'title_card',
					season: number | null = null
				) => candidateDisclosureKey(group.provider, set.setId, kind, season);
				sequence.push(...disclosed(pane('poster'), g.posters));
				sequence.push(...disclosed(pane('background'), g.backgrounds));
				if (!isShow) continue;
				for (const sg of g.seasons) {
					if (!isExpanded(seasonKey(set.setId, sg.season))) continue;
					sequence.push(...disclosed(pane('season', sg.season), sg.posters));
					sequence.push(...disclosed(pane('title_card', sg.season), sg.titleCards));
				}
			}
		}
		return sequence;
	});
	/**
	 * Open the dialog at one candidate. Handing the dialog the element that was
	 * activated — rather than letting it read `document.activeElement` — is what
	 * makes focus come back to this exact tile, including after a touch activation
	 * that never focused the button.
	 */
	function openPreview(candidate: PosterCandidate, trigger: HTMLElement) {
		const index = previewSequence.findIndex((entry) => entry.id === candidate.id);
		if (index < 0) return;
		previewTrigger = trigger;
		previewIndex = index;
		previewOpen = true;
	}

	// Re-sync local selection when navigating to a different item.
	// svelte-ignore state_referenced_locally
	let loadedId = data.item.id;
	$effect(() => {
		if (data.item.id !== loadedId) {
			loadedId = data.item.id;
			syncSelectionStateFromData();
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
			showAllLanguages = false;
			disclosureLimits = {};
			disclosureAnnouncement = '';
			previewOpen = false;
			previewIndex = 0;
			previewTrigger = null;
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

	// One report per destination, always both, each keeping its own slots and counts.
	// Never reduced to a single verdict here or in the markup below: a title verified
	// on the server whose Kometa file carries only some of its slots has to say so.
	const coverageReports = $derived(coverageBreakdown(data.coverage.slots));
	const occurrenceReport = $derived(coverageOccurrenceReport(data.coverage.occurrences));

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
	function stagedRootPreview(
		kind: 'poster' | 'background',
		canonicalUrl: string | null,
		candidateId: number | null
	): string | null {
		if (!canonicalUrl) return null;
		const candidate =
			candidateId === null
				? null
				: data.candidates.find(
						(entry) =>
							entry.id === candidateId &&
							entry.kind === kind &&
							entry.season === null &&
							entry.episode === null &&
							entry.url === canonicalUrl
					);
		// Candidate previews are trusted provider assets and belong in the thumb cache.
		// A staged candidate remains previewable if its provider was disabled after staging;
		// keep direct display only for a custom URL that has no matching candidate row.
		const persistedPreview =
			canonicalUrl ===
			(kind === 'poster' ? data.item.selectedPosterUrl : data.item.selectedBackgroundUrl)
				? data.selectedRootPreviews[kind]
				: null;
		const previewUrl = candidate?.previewUrl ?? candidate?.url ?? persistedPreview;
		return previewUrl ? thumb(previewUrl) : canonicalUrl;
	}
	const selectedPosterPreview = $derived(
		stagedRootPreview('poster', selectedPoster, selectedPosterCandidateId)
	);
	const selectedBackgroundPreview = $derived(
		stagedRootPreview('background', selectedBackground, selectedBackgroundCandidateId)
	);

	const jsonHeaders = { 'content-type': 'application/json' };
	type RootSelectionPatch = {
		poster?: { url: string | null; candidateId: number | null };
		background?: { url: string | null; candidateId: number | null };
	};

	/** Persist only the root slots changed by this interaction. */
	async function persistSelection(selection: RootSelectionPatch): Promise<boolean> {
		if (finishingAdvance) return false;
		confirmApply = false;
		applyPreview = null;
		advanceAfterApply = false;
		advanceTargetHref = null;
		completionRetry = null;
		const response = await fetch(`/api/items/${data.item.id}/select`, {
			method: 'POST',
			headers: jsonHeaders,
			body: JSON.stringify({
				...(selection.poster
					? {
							posterUrl: selection.poster.url,
							posterCandidateId: selection.poster.candidateId
						}
					: {}),
				...(selection.background
					? {
							backgroundUrl: selection.background.url,
							backgroundCandidateId: selection.background.candidateId
						}
					: {})
			})
		});
		return response.ok;
	}

	async function pickPoster(candidate: PosterCandidate) {
		if (finishingAdvance) return;
		const next = toggleStagedArtworkCandidate(
			{
				url: selectedPoster,
				candidateId: selectedPosterCandidateId,
				provider: selectedPosterProvider
			},
			candidate
		);
		try {
			if (!(await persistSelection({ poster: { url: next.url, candidateId: next.candidateId } }))) {
				throw new Error('selection_failed');
			}
			selectedPoster = next.url;
			selectedPosterCandidateId = next.candidateId;
			selectedPosterProvider = next.provider;
		} catch {
			await recoverSelectionFailure();
		}
	}
	async function pickBackground(candidate: PosterCandidate) {
		if (finishingAdvance) return;
		const next = toggleStagedArtworkCandidate(
			{
				url: selectedBackground,
				candidateId: selectedBackgroundCandidateId,
				provider: selectedBackgroundProvider
			},
			candidate
		);
		try {
			if (
				!(await persistSelection({
					background: { url: next.url, candidateId: next.candidateId }
				}))
			) {
				throw new Error('selection_failed');
			}
			selectedBackground = next.url;
			selectedBackgroundCandidateId = next.candidateId;
			selectedBackgroundProvider = next.provider;
		} catch {
			await recoverSelectionFailure();
		}
	}

	/** Toggle a single season/episode slot and persist it. */
	async function pickChild(
		kind: 'poster' | 'background' | 'title_card',
		season: number,
		episode: number | null,
		candidate: PosterCandidate
	) {
		if (finishingAdvance) return;
		confirmApply = false;
		applyPreview = null;
		completionRetry = null;
		const key = childKey(kind, season, episode);
		const next = toggleStagedArtworkCandidate(
			{
				url: childSel[key],
				candidateId: childCandidateIds[key],
				provider: childProviders[key]
			},
			candidate
		);
		try {
			const response = await fetch(`/api/items/${data.item.id}/select`, {
				method: 'POST',
				headers: jsonHeaders,
				body: JSON.stringify({
					child: {
						kind,
						season,
						episode,
						url: next.url,
						candidateId: next.candidateId
					}
				})
			});
			if (!response.ok) throw new Error('selection_failed');
			if (next.url === null) {
				const copy = { ...childSel };
				const idCopy = { ...childCandidateIds };
				const providerCopy = { ...childProviders };
				delete copy[key];
				delete idCopy[key];
				delete providerCopy[key];
				childSel = copy;
				childCandidateIds = idCopy;
				childProviders = providerCopy;
			} else {
				childSel = { ...childSel, [key]: next.url };
				childCandidateIds = { ...childCandidateIds, [key]: next.candidateId };
				childProviders = { ...childProviders, [key]: next.provider };
			}
		} catch {
			await recoverSelectionFailure();
		}
	}

	/** Stage a whole set: show poster + backdrop and every season/episode slot it covers. */
	async function useSet(set: CandidateSet) {
		if (finishingAdvance) return;
		confirmApply = false;
		applyPreview = null;
		const g = groupSetArtwork(set.candidates);
		const rootPatch: RootSelectionPatch = {};
		if (g.posters[0]) {
			rootPatch.poster = { url: g.posters[0].url, candidateId: g.posters[0].id };
		}
		if (g.backgrounds[0]) {
			rootPatch.background = { url: g.backgrounds[0].url, candidateId: g.backgrounds[0].id };
		}

		const children: {
			kind: string;
			season: number;
			episode: number | null;
			url: string;
			candidateId: number;
			provider: string;
		}[] = [];
		const seenEpisode = new Set<string>();
		for (const sg of g.seasons) {
			if (sg.posters[0]) {
				children.push({
					kind: 'poster',
					season: sg.season,
					episode: null,
					url: sg.posters[0].url,
					candidateId: sg.posters[0].id,
					provider: sg.posters[0].provider
				});
			}
			for (const tc of sg.titleCards) {
				if (tc.episode === null) continue;
				const epKey = `${sg.season}:${tc.episode}`;
				if (seenEpisode.has(epKey)) continue;
				seenEpisode.add(epKey);
				children.push({
					kind: 'title_card',
					season: sg.season,
					episode: tc.episode,
					url: tc.url,
					candidateId: tc.id,
					provider: tc.provider
				});
			}
		}
		try {
			if ((rootPatch.poster || rootPatch.background) && !(await persistSelection(rootPatch))) {
				throw new Error('selection_failed');
			}
			if (children.length) {
				const response = await fetch(`/api/items/${data.item.id}/select`, {
					method: 'POST',
					headers: jsonHeaders,
					body: JSON.stringify({ children })
				});
				if (!response.ok) throw new Error('selection_failed');
			}
			if (g.posters[0]) {
				selectedPoster = g.posters[0].url;
				selectedPosterCandidateId = g.posters[0].id;
				selectedPosterProvider = g.posters[0].provider;
			}
			if (g.backgrounds[0]) {
				selectedBackground = g.backgrounds[0].url;
				selectedBackgroundCandidateId = g.backgrounds[0].id;
				selectedBackgroundProvider = g.backgrounds[0].provider;
			}
			const add: Record<string, string> = {};
			const addIds: Record<string, number | null> = {};
			const addProviders: Record<string, string | null> = {};
			for (const c of children) {
				const key = childKey(c.kind, c.season, c.episode);
				add[key] = c.url;
				addIds[key] = c.candidateId;
				addProviders[key] = c.provider;
			}
			childSel = { ...childSel, ...add };
			childCandidateIds = { ...childCandidateIds, ...addIds };
			childProviders = { ...childProviders, ...addProviders };
			setMessage(m.item_msg_set_staged());
		} catch {
			await recoverSelectionFailure();
		}
	}

	async function useCustomUrl(which: 'poster' | 'background') {
		if (finishingAdvance) return;
		const url = (which === 'poster' ? posterUrlInput : backgroundUrlInput).trim();
		if (!url) return;
		try {
			const persisted = await persistSelection(
				which === 'poster'
					? { poster: { url, candidateId: null } }
					: { background: { url, candidateId: null } }
			);
			if (!persisted) throw new Error('selection_failed');
			if (which === 'poster') {
				selectedPoster = url;
				selectedPosterCandidateId = null;
				selectedPosterProvider = 'custom';
			} else {
				selectedBackground = url;
				selectedBackgroundCandidateId = null;
				selectedBackgroundProvider = 'custom';
			}
		} catch {
			await recoverSelectionFailure();
		}
	}

	async function discover(opts: { providers?: string[]; forceRefresh?: boolean } = {}) {
		if (busy) return;
		busy = true;
		setMessage('');
		try {
			const res = await fetch(`/api/items/${data.item.id}/discover`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					forceRefresh: opts.forceRefresh ?? false,
					providers: opts.providers
				})
			});
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

	/** Re-check a single provider, bypassing its normal cache — e.g. "force re-search ThePosterDB". */
	async function refreshProvider(providerId: string) {
		await discover({ providers: [providerId], forceRefresh: true });
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
				// Own state first: the artwork preview suspends page shortcuts even if its
				// dialog markup changes shape.
				modalOpen:
					previewOpen || Boolean(document.querySelector('dialog[open], [aria-modal="true"]'))
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
			const preview = (await res.json()) as typeof applyPreview;
			applyPreview = preview;
			if (!shouldAdvance && shouldAutoConfirmApply(preview)) {
				// Warning-free single-item plan: a second click has nothing to surface.
				// Hand off to apply(), which manages its own busy window.
				busy = false;
				await apply();
				return;
			}
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
			selectedPosterCandidateId = null;
			selectedPosterProvider = null;
			selectedBackground = null;
			selectedBackgroundCandidateId = null;
			selectedBackgroundProvider = null;
			childSel = {};
			childCandidateIds = {};
			childProviders = {};
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

<!-- Every tile is a non-interactive wrapper holding two sibling controls: the image
     button stages the slot, the footer button only enlarges it. Nesting the second
     inside the first would be invalid HTML and unreachable to assistive tech. The
     staged ring and the hover affordance move to the wrapper so the whole tile still
     reads as one selectable unit. -->
{#snippet candidateTile(
	c: PosterCandidate,
	kind: string,
	staged: boolean,
	aspect: string,
	stage: () => void
)}
	<!-- Clipping stays on the image button, not on the wrapper: the shared
	     `:focus-visible` outline is drawn 2px outside its control, and a wrapper with
	     `overflow-hidden` would cut the keyboard focus ring off both siblings. -->
	<div
		class="relative flex flex-col rounded-lg border-2 transition-colors {staged
			? 'border-accent-500'
			: 'border-transparent hover:border-neutral-600'}"
	>
		<button
			type="button"
			data-artwork-select
			onclick={stage}
			aria-pressed={staged}
			aria-label={m.item_candidate_label({ kind, provider: c.provider })}
			class="block overflow-hidden rounded-t-md"
		>
			<!-- `block` matters: an inline image leaves baseline space beneath it, which
			     showed up as a gap between the artwork and the preview strip below. -->
			<img
				src={thumb(c.previewUrl ?? c.url)}
				alt=""
				loading="lazy"
				class="{aspect} block w-full object-cover"
			/>
		</button>
		{#if suggestions.ids.has(c.id)}{@render suggestedChip()}{/if}
		{#if isLanguageFallback(c)}{@render languageChip(c)}{/if}
		{@render previewControl(c, kind)}
	</div>
{/snippet}

{#snippet previewControl(c: PosterCandidate, kind: string)}
	{@const label = m.item_preview_open({ kind, provider: c.provider })}
	<!-- Always rendered and always a 44px target: a hover-only control would be
	     unreachable by touch and invisible to a keyboard user. It sits below the
	     image rather than over it so it never covers the selection control. -->
	<button
		type="button"
		data-artwork-preview
		onclick={(event) => openPreview(c, event.currentTarget)}
		aria-label={label}
		title={label}
		class="flex h-11 w-full shrink-0 items-center justify-center rounded-b-md border-t border-neutral-800 bg-neutral-900 text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100"
	>
		<span aria-hidden="true" class="text-base leading-none">⤢</span>
	</button>
{/snippet}

{#snippet posterTile(c: PosterCandidate)}
	{@render candidateTile(
		c,
		m.item_poster(),
		isRootStaged('poster', c),
		'aspect-[2/3]',
		() => void pickPoster(c)
	)}
{/snippet}

{#snippet backdropTile(c: PosterCandidate)}
	{@render candidateTile(
		c,
		m.item_backdrop(),
		isRootStaged('background', c),
		'aspect-video',
		() => void pickBackground(c)
	)}
{/snippet}

{#snippet seasonPosterTile(c: PosterCandidate, season: number)}
	{@render candidateTile(
		c,
		`${m.item_season_label({ number: season })} · ${m.item_poster()}`,
		isChildStaged('poster', season, null, c),
		'aspect-[2/3]',
		() => void pickChild('poster', season, null, c)
	)}
{/snippet}

{#snippet titleCardTile(c: PosterCandidate, season: number)}
	{@render candidateTile(
		c,
		`${m.item_season_label({ number: season })} · ${m.item_episode_label({ number: c.episode ?? 0 })} · ${m.item_title_card()}`,
		isChildStaged('title_card', season, c.episode, c),
		'aspect-video',
		() => void pickChild('title_card', season, c.episode, c)
	)}
{/snippet}

{#snippet suggestedChip()}
	<!-- Top-scored pick for this slot. Icon + label (never color alone); overridable. -->
	<span
		class="pointer-events-none absolute top-1.5 left-1.5 z-10 inline-flex items-center gap-1 rounded-full bg-accent-500/90 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm ring-1 ring-black/30"
	>
		<span aria-hidden="true">✦</span>{m.item_suggested()}
	</span>
{/snippet}

{#snippet languageChip(c: PosterCandidate)}
	<!-- Artwork the language preference would hide, kept because it is the staged pick.
	     Icon + language name (never color alone) so the fallback is legible as such. -->
	<span
		class="pointer-events-none absolute top-1.5 right-1.5 z-10 inline-flex items-center gap-1 rounded-full bg-neutral-950/90 px-1.5 py-0.5 text-[10px] font-medium text-amber-200 shadow-sm ring-1 ring-black/30"
		aria-label={m.item_language_fallback({ language: candidateLanguageName(c) })}
	>
		<span aria-hidden="true">⚑</span>{candidateLanguageName(c)}
	</span>
{/snippet}

{#snippet disclosureFooter(key: string, total: number)}
	{#if total > CANDIDATE_DISCLOSURE_BATCH_SIZE}
		{@const disclosure = disclosureFor(key, total)}
		<div class="mt-1 flex flex-wrap items-center gap-2">
			<p class="text-[11px] text-neutral-400">
				{m.item_disclosure_count({
					shown: disclosure.shown,
					total,
					remaining: disclosure.remaining
				})}
			</p>
			<button
				type="button"
				class="btn btn-ghost min-h-11 px-2 py-1 text-xs"
				disabled={disclosure.remaining === 0}
				aria-controls={key}
				onclick={() => revealMore(key, total)}
			>
				{disclosure.remaining > 0
					? m.item_load_more({ count: disclosure.next, remaining: disclosure.remaining })
					: m.item_all_shown({ total })}
			</button>
		</div>
	{/if}
{/snippet}

{#snippet truncatedNotice(provider: string)}
	<p class="mt-1 text-[11px] text-amber-300">
		<span aria-hidden="true">⚠</span>
		{m.item_truncated_pane({ provider: providerLabel(provider) })}
	</p>
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
				<button
					onclick={() => discover()}
					disabled={busy || !data.item.resolved}
					class="btn btn-subtle"
				>
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

<!-- Destination coverage.
     Sits directly under the hero because "did my artwork actually land" is the
     question this page exists to answer, and the artwork history further down
     answers a different one: what we did, not what is true now.

     Two panels, never one. The media server and the Kometa file are independent
     destinations that never imply one another, so they are counted, badged and
     explained separately — and each slot inside a panel keeps the status the
     reconciler gave it rather than being folded into a panel-level verdict. -->
<section class="mt-6" aria-labelledby="artwork-coverage-title">
	<div class="mb-3 flex flex-wrap items-end justify-between gap-3">
		<h2 id="artwork-coverage-title" class="section-title mb-0">{m.coverage_filter_label()}</h2>
		{#if occurrenceReport.reportable}
			<!-- Only when the title exists more than once. With a single copy there is
			     nothing "across servers and libraries" to report, and the panels below
			     already say what happened to it. -->
			<p class="text-xs text-neutral-300">{occurrenceReport.label}</p>
		{/if}
	</div>
	<div class="grid gap-3 sm:grid-cols-2">
		{#each coverageReports as report (report.destination)}
			<div class="surface p-3">
				<h3 class="text-xs font-semibold tracking-wide text-neutral-400 uppercase">
					{report.label}
				</h3>
				{#if report.empty}
					<!-- Stated, not omitted. A destination that disappears when it holds no
					     evidence is one the reader never learns to ask about, and its silence
					     would read as coverage. `missing` is the honest wording for it: it says
					     PosterPilot did not apply anything here, which is a claim about what we
					     did — never a claim that the title has no artwork. -->
					<div class="mt-2"><CoverageBadge status="missing" /></div>
				{:else}
					<!-- A show whose every episode was applied has a long slot list, so it
					     scrolls in place rather than burying the rest of the page — the same
					     bounded-list treatment the collection and migration panels use. -->
					<ul class="mt-2 max-h-72 space-y-1.5 overflow-y-auto pr-1">
						{#each report.slots as slot (slot.key)}
							<li class="flex flex-wrap items-center justify-between gap-2">
								<span class="text-xs text-neutral-300">{slot.label}</span>
								<CoverageBadge status={slot.status} />
							</li>
						{/each}
					</ul>
				{/if}
				{#if report.note}
					<!-- The line the whole destination split exists for: a Kometa entry is a
					     file on disk, and nothing about writing it proves Kometa ever ran. -->
					<p class="mt-2 text-xs text-neutral-400">{report.note}</p>
				{/if}
			</div>
		{/each}
	</div>
</section>

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
{#if preferredLanguagePolicy.mode === 'preferred' && data.providerGroups.length}
	<!-- Item-local language filter. Flipping it never touches the saved preference. -->
	<section
		class="mt-8 rounded-xl border border-neutral-800 bg-neutral-950/60 p-3"
		aria-label={m.item_language_filter_title()}
	>
		<div class="flex flex-wrap items-center justify-between gap-2">
			<p class="text-xs text-neutral-300">
				<span aria-hidden="true">🌐</span>
				{#if showAllLanguages}
					{m.item_language_showing_all()}
				{:else if languageSummary.foreign + languageSummary.unknown > 0}
					{m.item_language_filter_hidden({
						language: preferredLanguageName,
						hidden: languageSummary.foreign + languageSummary.unknown
					})}
				{:else}
					{m.item_language_filter_active({ language: preferredLanguageName })}
				{/if}
			</p>
			<button
				type="button"
				class="btn btn-ghost min-h-11 px-3 text-xs"
				aria-pressed={showAllLanguages}
				onclick={() => (showAllLanguages = !showAllLanguages)}
			>
				{showAllLanguages
					? m.item_language_show_preferred({ language: preferredLanguageName })
					: m.item_language_show_all()}
			</button>
		</div>
		{#if languageSummary.emptyForPreference}
			<div class="mt-2 flex flex-wrap items-center gap-2">
				<p class="text-xs text-amber-300">
					<span aria-hidden="true">⚠</span>
					{m.item_language_empty({
						language: preferredLanguageName,
						count: languageSummary.foreign + languageSummary.unknown
					})}
				</p>
				<button
					type="button"
					class="btn btn-subtle min-h-11 px-3 text-xs"
					onclick={() => (showAllLanguages = true)}>{m.item_language_show_all()}</button
				>
			</div>
		{/if}
	</section>
{/if}
<p class="sr-only" aria-live="polite" aria-atomic="true">{disclosureAnnouncement}</p>
{#if data.providerGroups.length}
	<section class="mt-8 space-y-6 pb-4">
		{#each visibleProviderGroups as group (group.provider)}
			{@const pKey = providerKey(group.provider)}
			<div>
				<div class="flex items-center gap-2">
					<button
						type="button"
						onclick={() => toggle(pKey)}
						aria-expanded={isExpanded(pKey)}
						aria-label={isExpanded(pKey) ? m.item_collapse() : m.item_expand()}
						class="section-title flex flex-1 items-center gap-2"
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
					<button
						type="button"
						onclick={() => refreshProvider(group.provider)}
						disabled={busy}
						class="btn btn-ghost shrink-0 px-2 py-1 text-sm"
						aria-label={m.item_refresh_provider({ provider: providerLabel(group.provider) })}
						title={m.item_refresh_provider({ provider: providerLabel(group.provider) })}
					>
						<span aria-hidden="true" class="inline-block {busy ? 'animate-spin' : ''}">⟳</span>
					</button>
				</div>

				{#if isExpanded(pKey)}
					<div class="mt-2 space-y-4">
						{#if group.language.needsRefresh}
							<!-- Stored before provenance existed: ask for a fresh search instead of
							     guessing that untagged-looking artwork is language-neutral. -->
							<div
								class="flex flex-wrap items-center gap-2 rounded-lg border border-amber-900/50 bg-amber-950/20 p-2"
							>
								<p class="text-xs text-amber-200">
									<span aria-hidden="true">⚠</span>
									{m.item_language_unverified_hint({
										provider: providerLabel(group.provider),
										count: group.language.unknown
									})}
								</p>
								<button
									type="button"
									class="btn btn-ghost min-h-11 px-3 text-xs"
									disabled={busy}
									onclick={() => refreshProvider(group.provider)}
									>{m.item_refresh_provider({ provider: providerLabel(group.provider) })}</button
								>
							</div>
						{/if}
						{#if group.sets.length === 0}
							<p class="text-xs text-neutral-400">
								{m.item_language_provider_empty({
									provider: providerLabel(group.provider),
									language: preferredLanguageName
								})}
							</p>
						{/if}
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
											{@const pane = candidateDisclosureKey(group.provider, set.setId, 'poster')}
											<div class="min-w-0 flex-1">
												<p class="mb-1 text-[11px] text-neutral-400">
													{g.posters.length > 1 ? m.item_posters() : m.item_poster()}
												</p>
												<div id={pane} class="flex gap-2 overflow-x-auto pb-2">
													{#each g.posters.slice(0, disclosureFor(pane, g.posters.length).shown) as c (c.id)}<div
															class="w-20 flex-none"
														>
															{@render posterTile(c)}
														</div>{/each}
												</div>
												{@render disclosureFooter(pane, g.posters.length)}
												{#if group.truncatedKinds.includes('poster')}
													{@render truncatedNotice(group.provider)}
												{/if}
											</div>
										{/if}
										{#if g.backgrounds.length}
											{@const pane = candidateDisclosureKey(
												group.provider,
												set.setId,
												'background'
											)}
											<div class="min-w-0 flex-1">
												<p class="mb-1 text-[11px] text-neutral-400">
													{g.backgrounds.length > 1 ? m.item_backdrops() : m.item_backdrop()}
												</p>
												<div id={pane} class="grid grid-cols-2 gap-2">
													{#each g.backgrounds.slice(0, disclosureFor(pane, g.backgrounds.length).shown) as c (c.id)}{@render backdropTile(
															c
														)}{/each}
												</div>
												{@render disclosureFooter(pane, g.backgrounds.length)}
												{#if group.truncatedKinds.includes('background')}
													{@render truncatedNotice(group.provider)}
												{/if}
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
														{@const pane = candidateDisclosureKey(
															group.provider,
															set.setId,
															'season',
															sg.season
														)}
														<p class="mt-2 mb-1 text-[11px] text-neutral-400">
															{sg.posters.length > 1 ? m.item_posters() : m.item_poster()}
														</p>
														<div id={pane} class="grid grid-cols-4 gap-2 sm:grid-cols-8">
															{#each sg.posters.slice(0, disclosureFor(pane, sg.posters.length).shown) as c (c.id)}{@render seasonPosterTile(
																	c,
																	sg.season
																)}{/each}
														</div>
														{@render disclosureFooter(pane, sg.posters.length)}
														{#if group.truncatedKinds.includes('season')}
															{@render truncatedNotice(group.provider)}
														{/if}
													{/if}
													{#if sg.titleCards.length}
														{@const pane = candidateDisclosureKey(
															group.provider,
															set.setId,
															'title_card',
															sg.season
														)}
														<p class="mt-3 mb-1 text-[11px] text-neutral-400">
															{m.item_title_cards({ count: sg.titleCards.length })}
														</p>
														<div id={pane} class="grid grid-cols-2 gap-2 sm:grid-cols-4">
															{#each sg.titleCards.slice(0, disclosureFor(pane, sg.titleCards.length).shown) as c (c.id)}{@render titleCardTile(
																	c,
																	sg.season
																)}{/each}
														</div>
														{@render disclosureFooter(pane, sg.titleCards.length)}
														{#if group.truncatedKinds.includes('title_card')}
															{@render truncatedNotice(group.provider)}
														{/if}
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

<!-- Mounted once for the page and fed the on-screen sequence; it never filters or
     discloses candidates itself, and it never stages one. `open` is two-way so the
     dialog's own Escape, close and backdrop paths dismiss it without a callback
     that could be mistaken for a selection. -->
<ArtworkPreviewDialog
	bind:open={previewOpen}
	sequence={previewSequence}
	index={previewIndex}
	trigger={previewTrigger}
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
				{#if selectedPosterPreview}<img
						src={selectedPosterPreview}
						alt=""
						class="h-full w-full object-cover"
					/>{/if}
			</div>
			<div
				class="h-[45px] w-20 flex-none overflow-hidden rounded border border-neutral-700 bg-neutral-900"
			>
				{#if selectedBackgroundPreview}<img
						src={selectedBackgroundPreview}
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
		{#if applyPreview}
			<ApplySkipReasons
				codes={applyPreview.items.flatMap((item) => item.skips.map((skip) => skip.code))}
			/>
		{/if}
	</div>
</div>
