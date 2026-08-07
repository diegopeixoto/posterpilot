<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import {
		MIGRATION_DISCLOSURE_BATCH_SIZE,
		ROLLBACK_DISCLOSURE_BATCH_SIZE,
		disclosureState,
		nextDisclosureLimit,
		shouldDiscardFrozenPreview
	} from './kometa-migration-view-state';

	type MigrationStatus =
		| 'prepared'
		| 'writing_splits'
		| 'splits_verified'
		| 'config_written'
		| 'awaiting_manual_wiring'
		| 'completed'
		| 'failed'
		| 'recovery_required'
		| 'rollback_prepared'
		| 'rolled_back';
	type Activation = 'managed' | 'manual';
	type MediaKind = 'movie' | 'show';
	type AmbiguityReason =
		| 'unsupported_legacy_key'
		| 'unsupported_entry_shape'
		| 'no_authoritative_mapping'
		| 'missing_typed_identifier'
		| 'multiple_typed_destinations'
		| 'mixed_slot_provenance'
		| 'revision_no_longer_matches'
		| 'typed_target_conflict'
		| 'incompatible_entry_shape';

	type MigrationFile = {
		physicalPath: string;
		configReference: string;
	};
	type MigrationState = {
		migrationId: string;
		status: MigrationStatus;
		activation: Activation;
		classifiedCount: number;
		ambiguousCount: number;
		references: { movie: string; show: string };
		files: { movie: MigrationFile; show: MigrationFile };
		manualSnippet: string | null;
		manualSnippetFingerprint: string | null;
		lastFailure: { phase: string; code: string; at: string } | null;
		createdAt: string;
		updatedAt: string;
		completedAt: string | null;
		scopeMatches: boolean;
		frozenScope: {
			serverInstanceId: string;
			serverName: string;
			outputDirectory: string;
			configPath: string | null;
			mode: 'merge' | 'own' | null;
			metadataPathPrefix: string;
		};
		canResume: boolean;
		canRestartPreview: boolean;
		requiresAcknowledgment: boolean;
		canRollback: boolean;
	};
	type FileChange = {
		operation: 'add' | 'unchanged' | 'normalize_key';
		path: string;
		targetMappingId: string;
		entryFingerprint: string;
		targetFingerprint: string | null;
	};
	type PreviewFile = MigrationFile & {
		filename: string;
		sourceFingerprint: string;
		proposedFingerprint: string;
		added: number;
		unchanged: number;
		changes: FileChange[];
	};
	type MigrationPreview = {
		required: true;
		planId: string;
		digest: string;
		expiresAt: string;
		migrationId: string;
		activation: Activation;
		display: {
			classified: Array<{
				legacyKey: string;
				entryFingerprint: string;
				slots: string[];
				destination: {
					mediaKind: MediaKind;
					namespace: 'tmdb' | 'tvdb' | 'imdb';
					mappingId: string;
					filename: string;
				};
				evidence: 'mapping' | 'revision';
			}>;
			ambiguous: Array<{
				legacyKey: string;
				entryFingerprint: string;
				slots: string[];
				reason: AmbiguityReason;
			}>;
			files: { movie: PreviewFile; show: PreviewFile };
			libraries: Array<{
				library: string;
				mediaKind: MediaKind;
				before: string[];
				after: string;
			}>;
			diffTruncated: boolean;
		};
		manualSnippet: string | null;
		manualSnippetFingerprint: string | null;
		fingerprints: {
			legacy: string;
			evidence: string;
			movieSource: string;
			movieProposed: string;
			showSource: string;
			showProposed: string;
			configSource: string | null;
			configProposed: string | null;
		};
	};
	type RawChange = {
		op: 'add' | 'modify' | 'remove';
		path: string;
		before?: string | null;
		after?: string | null;
	};
	type RollbackPreview = {
		planId: string;
		digest: string;
		expiresAt: string;
		migrationId: string;
		changes: RawChange[];
		warnings: string[];
	};

	let {
		required,
		reason,
		migration,
		stateError = null,
		mutationDisabled = false,
		onChanged
	}: {
		required: boolean;
		reason: 'active_legacy_reference' | 'unknown_config_with_legacy_file' | null;
		migration: MigrationState | null;
		stateError?: 'journal_unreadable' | null;
		mutationDisabled?: boolean;
		onChanged: () => void | Promise<void>;
	} = $props();

	let preview = $state<MigrationPreview | null>(null);
	let rollbackPreview = $state<RollbackPreview | null>(null);
	let busyAction = $state<
		| 'preview'
		| 'confirm'
		| 'cancel-preview'
		| 'resume'
		| 'acknowledge'
		| 'rollback-preview'
		| 'rollback'
		| 'cancel-rollback-preview'
		| null
	>(null);
	let errorCode = $state<string | null>(null);
	let notice = $state<string | null>(null);
	let acceptAmbiguous = $state(false);
	let acknowledgeManual = $state(false);
	let confirmRollback = $state(false);
	let panelHeading = $state<HTMLElement | null>(null);
	let previewHeading = $state<HTMLElement | null>(null);
	let previewButton = $state<HTMLButtonElement | null>(null);
	let ambiguousVisibleLimit = $state(MIGRATION_DISCLOSURE_BATCH_SIZE);
	let classifiedVisibleLimit = $state(MIGRATION_DISCLOSURE_BATCH_SIZE);
	let fileChangeVisibleLimits = $state<Record<MediaKind, number>>({
		movie: MIGRATION_DISCLOSURE_BATCH_SIZE,
		show: MIGRATION_DISCLOSURE_BATCH_SIZE
	});
	let rollbackVisibleLimit = $state(ROLLBACK_DISCLOSURE_BATCH_SIZE);
	let disclosureAnnouncement = $state('');

	const ambiguousCount = $derived(preview?.display.ambiguous.length ?? 0);
	const isBusy = $derived(busyAction !== null);
	const ambiguousDisclosure = $derived(
		disclosureState(
			ambiguousVisibleLimit,
			preview?.display.ambiguous.length ?? 0,
			MIGRATION_DISCLOSURE_BATCH_SIZE
		)
	);
	const classifiedDisclosure = $derived(
		disclosureState(
			classifiedVisibleLimit,
			preview?.display.classified.length ?? 0,
			MIGRATION_DISCLOSURE_BATCH_SIZE
		)
	);
	const rollbackDisclosure = $derived(
		disclosureState(
			rollbackVisibleLimit,
			rollbackPreview?.changes.length ?? 0,
			ROLLBACK_DISCLOSURE_BATCH_SIZE
		)
	);

	class MigrationRequestError extends Error {
		readonly code: string;

		constructor(code: string) {
			super(code);
			this.code = code;
		}
	}

	function responseCode(value: unknown): string {
		if (!value || typeof value !== 'object') return 'kometa_migration_request_failed';
		const body = value as Record<string, unknown>;
		if (typeof body.error === 'string') return body.error;
		if (body.error && typeof body.error === 'object') {
			const code = (body.error as Record<string, unknown>).code;
			if (typeof code === 'string') return code;
		}
		return typeof body.code === 'string' ? body.code : 'kometa_migration_request_failed';
	}

	function unwrap<T>(value: unknown, keys: string[]): T {
		if (value && typeof value === 'object') {
			const body = value as Record<string, unknown>;
			for (const key of keys) if (body[key] && typeof body[key] === 'object') return body[key] as T;
		}
		return value as T;
	}

	async function post<T>(
		path: string,
		body: Record<string, unknown> | undefined = undefined,
		keys: string[] = []
	): Promise<T> {
		const response = await fetch(path, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body ?? {})
		});
		const result = await response.json().catch(() => ({}));
		if (!response.ok) throw new MigrationRequestError(responseCode(result));
		return unwrap<T>(result, keys);
	}

	function clearFeedback(): void {
		errorCode = null;
		notice = null;
	}

	function resetMigrationDisclosure(): void {
		ambiguousVisibleLimit = MIGRATION_DISCLOSURE_BATCH_SIZE;
		classifiedVisibleLimit = MIGRATION_DISCLOSURE_BATCH_SIZE;
		fileChangeVisibleLimits = {
			movie: MIGRATION_DISCLOSURE_BATCH_SIZE,
			show: MIGRATION_DISCLOSURE_BATCH_SIZE
		};
		disclosureAnnouncement = '';
	}

	function resetRollbackDisclosure(): void {
		rollbackVisibleLimit = ROLLBACK_DISCLOSURE_BATCH_SIZE;
		disclosureAnnouncement = '';
	}

	function clearMigrationPreview(): void {
		preview = null;
		acceptAmbiguous = false;
		resetMigrationDisclosure();
	}

	function clearRollbackPreview(): void {
		rollbackPreview = null;
		confirmRollback = false;
		resetRollbackDisclosure();
	}

	function requestErrorCode(error: unknown): string {
		return error instanceof MigrationRequestError ? error.code : 'kometa_migration_request_failed';
	}

	async function refreshAndFocus(): Promise<void> {
		try {
			await onChanged();
		} catch {
			// The mutation already succeeded. Keep its success notice instead of
			// misreporting a follow-up refresh problem as a migration failure.
		}
		queueMicrotask(() => panelHeading?.focus());
	}

	async function captureMutationError(error: unknown): Promise<string> {
		const code = requestErrorCode(error);
		errorCode = code;
		// A failed response may still follow a durably recorded checkpoint. Refresh so
		// recovery/resume controls reflect the journal without asking for a page reload.
		try {
			await onChanged();
		} catch {
			// Keep the bounded action error; never replace it with a client refresh detail.
		}
		queueMicrotask(() => panelHeading?.focus());
		return code;
	}

	function announceDisclosure(shown: number, total: number): void {
		disclosureAnnouncement = m.kometa_migration_disclosure_announcement({ shown, total });
	}

	function revealMoreAmbiguous(): void {
		ambiguousVisibleLimit = nextDisclosureLimit(
			ambiguousVisibleLimit,
			preview?.display.ambiguous.length ?? 0,
			MIGRATION_DISCLOSURE_BATCH_SIZE
		);
		announceDisclosure(ambiguousVisibleLimit, preview?.display.ambiguous.length ?? 0);
	}

	function revealMoreClassified(): void {
		classifiedVisibleLimit = nextDisclosureLimit(
			classifiedVisibleLimit,
			preview?.display.classified.length ?? 0,
			MIGRATION_DISCLOSURE_BATCH_SIZE
		);
		announceDisclosure(classifiedVisibleLimit, preview?.display.classified.length ?? 0);
	}

	function revealMoreFileChanges(kind: MediaKind, total: number): void {
		const next = nextDisclosureLimit(
			fileChangeVisibleLimits[kind],
			total,
			MIGRATION_DISCLOSURE_BATCH_SIZE
		);
		fileChangeVisibleLimits = { ...fileChangeVisibleLimits, [kind]: next };
		announceDisclosure(next, total);
	}

	function revealMoreRollbackChanges(): void {
		rollbackVisibleLimit = nextDisclosureLimit(
			rollbackVisibleLimit,
			rollbackPreview?.changes.length ?? 0,
			ROLLBACK_DISCLOSURE_BATCH_SIZE
		);
		announceDisclosure(rollbackVisibleLimit, rollbackPreview?.changes.length ?? 0);
	}

	async function createPreview(): Promise<void> {
		if (isBusy || mutationDisabled || preview || rollbackPreview) return;
		busyAction = 'preview';
		clearFeedback();
		try {
			const nextPreview = await post<MigrationPreview>('/api/kometa/migration/preview', undefined, [
				'preview'
			]);
			preview = nextPreview;
			resetMigrationDisclosure();
			queueMicrotask(() => previewHeading?.focus());
		} catch (error) {
			clearMigrationPreview();
			errorCode = requestErrorCode(error);
		} finally {
			busyAction = null;
		}
	}

	async function cancelPreview(): Promise<void> {
		if (isBusy || !preview) return;
		busyAction = 'cancel-preview';
		clearFeedback();
		const frozen = preview;
		try {
			await post<{ cancelled: true }>('/api/kometa/migration/cancel', {
				planId: frozen.planId,
				digest: frozen.digest
			});
			clearMigrationPreview();
			notice = m.kometa_migration_cancelled_notice();
			queueMicrotask(() => previewButton?.focus());
		} catch (error) {
			const code = requestErrorCode(error);
			errorCode = code;
			if (shouldDiscardFrozenPreview(code)) {
				clearMigrationPreview();
				queueMicrotask(() => previewButton?.focus());
			}
		} finally {
			busyAction = null;
		}
	}

	async function confirmMigration(): Promise<void> {
		if (isBusy || mutationDisabled || !preview || (ambiguousCount > 0 && !acceptAmbiguous)) return;
		busyAction = 'confirm';
		clearFeedback();
		const frozen = preview;
		try {
			await post<MigrationState>(
				'/api/kometa/migration/confirm',
				{
					planId: frozen.planId,
					digest: frozen.digest,
					acceptAmbiguous: ambiguousCount > 0 ? acceptAmbiguous : undefined
				},
				['migration', 'state']
			);
			clearMigrationPreview();
			notice = m.kometa_migration_started_notice();
			await refreshAndFocus();
		} catch (error) {
			const code = await captureMutationError(error);
			if (shouldDiscardFrozenPreview(code)) {
				clearMigrationPreview();
				queueMicrotask(() => previewButton?.focus());
			}
		} finally {
			busyAction = null;
		}
	}

	async function resumeMigration(): Promise<void> {
		if (isBusy || mutationDisabled || !migration?.canResume) return;
		busyAction = 'resume';
		clearFeedback();
		try {
			await post<MigrationState>(
				'/api/kometa/migration/resume',
				{ migrationId: migration.migrationId },
				['migration', 'state']
			);
			notice = m.kometa_migration_resumed_notice();
			await refreshAndFocus();
		} catch (error) {
			await captureMutationError(error);
		} finally {
			busyAction = null;
		}
	}

	async function acknowledgeMigration(): Promise<void> {
		if (
			isBusy ||
			mutationDisabled ||
			!migration?.requiresAcknowledgment ||
			!migration.scopeMatches ||
			!migration.manualSnippetFingerprint ||
			!acknowledgeManual
		)
			return;
		busyAction = 'acknowledge';
		clearFeedback();
		try {
			await post<MigrationState>(
				'/api/kometa/migration/acknowledge',
				{
					migrationId: migration.migrationId,
					manualSnippetFingerprint: migration.manualSnippetFingerprint
				},
				['migration', 'state']
			);
			acknowledgeManual = false;
			notice = m.kometa_migration_acknowledged_notice();
			await refreshAndFocus();
		} catch (error) {
			await captureMutationError(error);
		} finally {
			busyAction = null;
		}
	}

	async function createRollbackPreview(): Promise<void> {
		if (isBusy || mutationDisabled || !migration?.canRollback || preview || rollbackPreview) return;
		busyAction = 'rollback-preview';
		clearFeedback();
		try {
			const nextPreview = await post<RollbackPreview>(
				'/api/kometa/migration/rollback/preview',
				undefined,
				['preview', 'rollback']
			);
			rollbackPreview = nextPreview;
			resetRollbackDisclosure();
			queueMicrotask(() => previewHeading?.focus());
		} catch (error) {
			clearRollbackPreview();
			errorCode = requestErrorCode(error);
		} finally {
			busyAction = null;
		}
	}

	async function cancelRollbackPreview(): Promise<void> {
		if (isBusy || !rollbackPreview) return;
		busyAction = 'cancel-rollback-preview';
		clearFeedback();
		const frozen = rollbackPreview;
		try {
			await post<{ cancelled: true }>('/api/kometa/migration/rollback/cancel', {
				planId: frozen.planId,
				digest: frozen.digest
			});
			clearRollbackPreview();
			notice = m.kometa_migration_cancelled_notice();
			queueMicrotask(() => panelHeading?.focus());
		} catch (error) {
			const code = requestErrorCode(error);
			errorCode = code;
			if (shouldDiscardFrozenPreview(code)) {
				clearRollbackPreview();
				queueMicrotask(() => panelHeading?.focus());
			}
		} finally {
			busyAction = null;
		}
	}

	async function rollbackMigration(): Promise<void> {
		if (isBusy || mutationDisabled || !rollbackPreview || !confirmRollback) return;
		busyAction = 'rollback';
		clearFeedback();
		const frozen = rollbackPreview;
		try {
			await post<MigrationState>(
				'/api/kometa/migration/rollback/confirm',
				{ planId: frozen.planId, digest: frozen.digest },
				['migration', 'state']
			);
			clearRollbackPreview();
			notice = m.kometa_migration_rolled_back_notice();
			await refreshAndFocus();
		} catch (error) {
			const code = await captureMutationError(error);
			if (shouldDiscardFrozenPreview(code)) clearRollbackPreview();
		} finally {
			busyAction = null;
		}
	}

	function shortFingerprint(value: string | null | undefined): string {
		return value ? `${value.slice(0, 12)}…` : m.kometa_migration_not_applicable();
	}

	function dateLabel(value: string): string {
		try {
			return new Intl.DateTimeFormat(undefined, {
				dateStyle: 'medium',
				timeStyle: 'short'
			}).format(new Date(value));
		} catch {
			return value;
		}
	}

	function statusLabel(status: MigrationStatus): string {
		switch (status) {
			case 'prepared':
				return m.kometa_migration_status_prepared();
			case 'writing_splits':
				return m.kometa_migration_status_writing_splits();
			case 'splits_verified':
				return m.kometa_migration_status_splits_verified();
			case 'config_written':
				return m.kometa_migration_status_config_written();
			case 'awaiting_manual_wiring':
				return m.kometa_migration_status_awaiting_manual();
			case 'completed':
				return m.kometa_migration_status_completed();
			case 'failed':
				return m.kometa_migration_status_failed();
			case 'recovery_required':
				return m.kometa_migration_status_recovery_required();
			case 'rollback_prepared':
				return m.kometa_migration_rollback_title();
			case 'rolled_back':
				return m.kometa_migration_status_rolled_back();
		}
	}

	function statusHint(status: MigrationStatus): string {
		switch (status) {
			case 'prepared':
				return m.kometa_migration_status_prepared_hint();
			case 'writing_splits':
				return m.kometa_migration_status_writing_splits_hint();
			case 'splits_verified':
				return m.kometa_migration_status_splits_verified_hint();
			case 'config_written':
				return m.kometa_migration_status_config_written_hint();
			case 'awaiting_manual_wiring':
				return m.kometa_migration_status_awaiting_manual_hint();
			case 'completed':
				return m.kometa_migration_status_completed_hint();
			case 'failed':
				return m.kometa_migration_status_failed_hint();
			case 'recovery_required':
				return m.kometa_migration_status_recovery_required_hint();
			case 'rollback_prepared':
				return m.kometa_migration_rollback_hint();
			case 'rolled_back':
				return m.kometa_migration_status_rolled_back_hint();
		}
	}

	function reasonLabel(value: typeof reason): string {
		return value === 'active_legacy_reference'
			? m.kometa_migration_reason_active_reference()
			: m.kometa_migration_reason_unknown_config();
	}

	function errorMessage(code: string): string {
		switch (code) {
			case 'plan_stale':
			case 'plan_expired':
			case 'plan_consumed':
			case 'plan_digest_mismatch':
				return m.kometa_migration_error_stale();
			case 'kometa_migration_in_progress':
				return m.kometa_migration_error_in_progress();
			case 'kometa_migration_not_required':
				return m.kometa_migration_error_not_required();
			case 'kometa_migration_scope_changed':
				return m.kometa_migration_error_scope_changed();
			case 'kometa_migration_ambiguous_confirmation_required':
				return m.kometa_migration_error_ambiguous_confirmation();
			case 'kometa_migration_manual_ack_mismatch':
				return m.kometa_migration_error_manual_mismatch();
			case 'kometa_migration_rollback_unavailable':
				return m.kometa_migration_error_rollback_unavailable();
			default:
				return m.kometa_migration_error_generic();
		}
	}

	function ambiguityLabel(reason: AmbiguityReason): string {
		switch (reason) {
			case 'unsupported_legacy_key':
				return m.kometa_migration_ambiguity_unsupported_key();
			case 'unsupported_entry_shape':
			case 'incompatible_entry_shape':
				return m.kometa_migration_ambiguity_entry_shape();
			case 'no_authoritative_mapping':
				return m.kometa_migration_ambiguity_no_mapping();
			case 'missing_typed_identifier':
				return m.kometa_migration_ambiguity_missing_identifier();
			case 'multiple_typed_destinations':
				return m.kometa_migration_ambiguity_multiple_destinations();
			case 'mixed_slot_provenance':
				return m.kometa_migration_ambiguity_mixed_provenance();
			case 'revision_no_longer_matches':
				return m.kometa_migration_ambiguity_revision_mismatch();
			case 'typed_target_conflict':
				return m.kometa_migration_ambiguity_target_conflict();
		}
	}

	function mediaKindLabel(kind: MediaKind): string {
		return kind === 'movie' ? m.manual_match_type_movie() : m.manual_match_type_show();
	}

	function evidenceLabel(evidence: 'mapping' | 'revision'): string {
		return evidence === 'mapping'
			? m.kometa_migration_evidence_mapping()
			: m.kometa_migration_evidence_revision();
	}

	function operationLabel(operation: FileChange['operation'] | RawChange['op']): string {
		switch (operation) {
			case 'add':
				return m.kometa_migration_operation_add();
			case 'unchanged':
				return m.kometa_migration_operation_unchanged();
			case 'normalize_key':
				return m.kometa_migration_operation_rekeyed();
			case 'modify':
				return m.kometa_migration_operation_modified();
			case 'remove':
				return m.kometa_migration_operation_removed();
			default:
				return m.kometa_migration_operation_unknown();
		}
	}

	function fingerprintLabel(label: keyof MigrationPreview['fingerprints']): string {
		switch (label) {
			case 'legacy':
				return m.kometa_migration_fingerprint_legacy();
			case 'evidence':
				return m.kometa_migration_fingerprint_evidence();
			case 'movieSource':
				return m.kometa_migration_fingerprint_movie_source();
			case 'movieProposed':
				return m.kometa_migration_fingerprint_movie_proposed();
			case 'showSource':
				return m.kometa_migration_fingerprint_show_source();
			case 'showProposed':
				return m.kometa_migration_fingerprint_show_proposed();
			case 'configSource':
				return m.kometa_migration_fingerprint_config_source();
			case 'configProposed':
				return m.kometa_migration_fingerprint_config_proposed();
			default:
				return m.kometa_migration_fingerprint_unknown();
		}
	}

	function slotKindLabel(kind: string): string {
		switch (kind) {
			case 'poster':
			case 'url_poster':
				return m.jobs_slot_poster();
			case 'background':
			case 'url_background':
				return m.jobs_slot_background();
			case 'title_card':
				return m.jobs_slot_title_card();
			default:
				return m.jobs_slot_other();
		}
	}

	function slotIndex(value: string | undefined): number | null {
		if (!value || !/^\d+$/.test(value)) return null;
		const parsed = Number(value);
		return Number.isSafeInteger(parsed) ? parsed : null;
	}

	function slotLabel(value: string): string {
		const [kind, seasonValue, episodeValue, extra] = value.split(':');
		const kindLabel = slotKindLabel(kind);
		if (extra !== undefined || seasonValue === undefined) return kindLabel;
		if (seasonValue === 'root' && episodeValue === 'root') return kindLabel;
		const season = slotIndex(seasonValue);
		const episode = slotIndex(episodeValue);
		if (season !== null && episode !== null) {
			return m.jobs_slot_scope_episode({ kind: kindLabel, season, episode });
		}
		if (season !== null && episodeValue === 'root') {
			return m.jobs_slot_scope_season({ kind: kindLabel, season });
		}
		return kindLabel;
	}

	function slotsLabel(slots: string[]): string {
		return [...new Set(slots.map(slotLabel))].join(', ');
	}

	function modeLabel(mode: MigrationState['frozenScope']['mode']): string {
		if (mode === 'merge') return m.kometa_mode_merge();
		if (mode === 'own') return m.kometa_mode_own();
		return m.kometa_migration_not_applicable();
	}

	function panelTone(): string {
		if (stateError || migration?.status === 'failed' || migration?.status === 'recovery_required') {
			return 'border-red-900/70 bg-red-950/20';
		}
		if (migration?.status === 'completed') return 'border-emerald-900/60 bg-emerald-950/15';
		if (required || migration?.requiresAcknowledgment) return 'border-amber-800/70 bg-amber-950/25';
		return 'border-neutral-800 bg-neutral-900/60';
	}
</script>

{#if required || migration || stateError}
	<section
		data-testid="kometa-migration-panel"
		class="mt-4 rounded-xl border p-5 {panelTone()}"
		aria-labelledby="kometa-migration-title"
		aria-busy={isBusy}
	>
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div class="flex min-w-0 items-start gap-3">
				<span
					class="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border {migration?.status ===
					'completed'
						? 'border-emerald-700/70 text-emerald-300'
						: stateError ||
							  migration?.status === 'failed' ||
							  migration?.status === 'recovery_required'
							? 'border-red-700/70 text-red-300'
							: 'border-amber-700/70 text-amber-300'}"
					aria-hidden="true"
				>
					{#if migration?.status === 'completed'}
						<svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor">
							<path d="m5 10 3 3 7-7" stroke-width="1.8" stroke-linecap="round" />
						</svg>
					{:else}
						<svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor">
							<path d="M10 6.5v4M10 14h.01" stroke-width="1.8" stroke-linecap="round" />
							<circle cx="10" cy="10" r="7" stroke-width="1.5" />
						</svg>
					{/if}
				</span>
				<div>
					<p class="text-[11px] font-medium tracking-[0.14em] text-neutral-400 uppercase">
						{m.kometa_migration_eyebrow()}
					</p>
					<h2
						bind:this={panelHeading}
						id="kometa-migration-title"
						tabindex="-1"
						class="mt-0.5 text-lg font-semibold tracking-tight text-neutral-100"
					>
						{stateError
							? m.kometa_migration_state_error_title()
							: required && !migration
								? m.kometa_migration_required_title()
								: m.kometa_migration_title()}
					</h2>
					{#if stateError}
						<p class="mt-1 max-w-3xl text-sm text-red-200" role="alert">
							{m.kometa_migration_state_error_hint()}
						</p>
					{:else if migration}
						<div class="mt-1 flex flex-wrap items-center gap-2">
							<span
								class="badge {migration.status === 'completed'
									? 'badge-success'
									: migration.status === 'failed' || migration.status === 'recovery_required'
										? 'badge-error'
										: migration.status === 'rolled_back'
											? 'badge-muted'
											: 'badge-warn'}"
							>
								{statusLabel(migration.status)}
							</span>
							<span class="text-xs text-neutral-400">
								{migration.activation === 'managed'
									? m.kometa_migration_activation_managed()
									: m.kometa_migration_activation_manual()}
							</span>
						</div>
						<p class="mt-2 max-w-3xl text-sm text-neutral-300">{statusHint(migration.status)}</p>
					{:else}
						<p class="mt-1 max-w-3xl text-sm text-neutral-300">
							{m.kometa_migration_required_hint()}
						</p>
					{/if}
					{#if !stateError && required && reason}
						<p class="mt-2 text-xs text-amber-200">{reasonLabel(reason)}</p>
					{/if}
				</div>
			</div>

			<div class="flex shrink-0 flex-wrap gap-2">
				{#if !stateError && required && !preview && !rollbackPreview && (!migration || migration.canRestartPreview || ['completed', 'rolled_back'].includes(migration.status))}
					<button
						bind:this={previewButton}
						type="button"
						class="btn btn-accent min-h-11"
						disabled={isBusy || mutationDisabled}
						onclick={createPreview}
					>
						{busyAction === 'preview'
							? m.kometa_migration_previewing()
							: m.kometa_migration_preview_action()}
					</button>
				{/if}
				{#if !stateError && migration?.canResume}
					<button
						type="button"
						class="btn btn-accent min-h-11"
						disabled={isBusy || mutationDisabled}
						onclick={resumeMigration}
					>
						{busyAction === 'resume'
							? m.kometa_migration_resuming()
							: m.kometa_migration_resume_action()}
					</button>
				{/if}
				{#if !stateError && migration?.canRollback && !preview && !rollbackPreview}
					<button
						type="button"
						class="btn btn-ghost min-h-11"
						disabled={isBusy || mutationDisabled}
						onclick={createRollbackPreview}
					>
						{busyAction === 'rollback-preview'
							? m.kometa_migration_rollback_previewing()
							: m.kometa_migration_rollback_preview_action()}
					</button>
				{/if}
			</div>
		</div>

		{#if !stateError && mutationDisabled && (required || migration?.canResume || migration?.requiresAcknowledgment)}
			<p class="mt-3 text-xs text-amber-300" role="status">
				{m.kometa_migration_save_settings_first()}
			</p>
		{/if}

		{#if !stateError && migration}
			{#if !migration.scopeMatches && migration.status !== 'rolled_back'}
				<div class="mt-4 rounded-xl border border-amber-800/70 bg-amber-950/25 p-4" role="status">
					<h3 class="text-sm font-semibold text-amber-100">
						{m.kometa_migration_scope_mismatch_title()}
					</h3>
					<p class="mt-1 max-w-3xl text-xs text-amber-200/90">
						{m.kometa_migration_scope_mismatch_hint()}
					</p>
					<dl class="mt-3 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-5">
						<div class="rounded-lg border border-amber-900/60 bg-black/20 p-2">
							<dt class="text-amber-300/80">{m.kometa_migration_scope_server()}</dt>
							<dd class="mt-1 text-neutral-100">{migration.frozenScope.serverName}</dd>
							<dd class="mt-0.5 break-all font-mono text-[11px] text-neutral-400">
								{migration.frozenScope.serverInstanceId}
							</dd>
						</div>
						<div class="rounded-lg border border-amber-900/60 bg-black/20 p-2">
							<dt class="text-amber-300/80">{m.kometa_migration_scope_output_directory()}</dt>
							<dd class="mt-1 break-all font-mono text-neutral-100">
								{migration.frozenScope.outputDirectory}
							</dd>
						</div>
						<div class="rounded-lg border border-amber-900/60 bg-black/20 p-2">
							<dt class="text-amber-300/80">{m.kometa_migration_scope_config_path()}</dt>
							<dd class="mt-1 break-all font-mono text-neutral-100">
								{migration.frozenScope.configPath ?? m.kometa_migration_scope_config_path_empty()}
							</dd>
						</div>
						<div class="rounded-lg border border-amber-900/60 bg-black/20 p-2">
							<dt class="text-amber-300/80">{m.kometa_migration_scope_mode()}</dt>
							<dd class="mt-1 text-neutral-100">{modeLabel(migration.frozenScope.mode)}</dd>
						</div>
						<div class="rounded-lg border border-amber-900/60 bg-black/20 p-2">
							<dt class="text-amber-300/80">{m.kometa_migration_scope_metadata_prefix()}</dt>
							<dd class="mt-1 break-all font-mono text-neutral-100">
								{migration.frozenScope.metadataPathPrefix}
							</dd>
						</div>
					</dl>
					<p class="mt-3 text-xs font-medium text-amber-100">
						{m.kometa_migration_scope_restore_action()}
					</p>
				</div>
			{/if}
			{#if migration.canRestartPreview}
				<p class="mt-3 text-xs text-amber-200" role="status">
					{m.kometa_migration_restart_preview_hint()}
				</p>
			{/if}
			{#if migration.ambiguousCount > 0}
				<p class="mt-3 text-xs text-amber-200" role="status">
					{m.kometa_migration_ambiguous_hint()}
				</p>
			{/if}
			<div class="mt-4 grid gap-2 sm:grid-cols-3" aria-label={m.kometa_migration_summary()}>
				<div class="rounded-lg border border-neutral-800/80 bg-neutral-950/40 p-3">
					<strong class="block text-xl font-semibold tabular-nums text-neutral-100">
						{migration.classifiedCount}
					</strong>
					<span class="text-xs text-neutral-400">{m.kometa_migration_classified()}</span>
				</div>
				<div class="rounded-lg border border-neutral-800/80 bg-neutral-950/40 p-3">
					<strong class="block text-xl font-semibold tabular-nums text-neutral-100">
						{migration.ambiguousCount}
					</strong>
					<span class="text-xs text-neutral-400">{m.kometa_migration_ambiguous()}</span>
				</div>
				<div class="rounded-lg border border-neutral-800/80 bg-neutral-950/40 p-3">
					<strong class="block truncate font-mono text-sm font-semibold text-neutral-100">
						{dateLabel(migration.updatedAt)}
					</strong>
					<span class="text-xs text-neutral-400">{m.kometa_migration_last_update()}</span>
				</div>
			</div>

			<details class="mt-3 rounded-lg border border-neutral-800/80 bg-neutral-950/30 p-3">
				<summary class="cursor-pointer text-xs font-medium text-neutral-300">
					{m.kometa_migration_files_and_references()}
				</summary>
				<div class="mt-3 grid gap-3 md:grid-cols-2">
					{#each ['movie', 'show'] as kind (kind)}
						{@const file = migration.files[kind as MediaKind]}
						<div class="rounded-lg border border-neutral-800 p-3 text-xs">
							<p class="font-medium text-neutral-200">
								{mediaKindLabel(kind as MediaKind)}
							</p>
							<p class="mt-2 text-neutral-500">{m.kometa_migration_physical_file()}</p>
							<p class="break-all font-mono text-neutral-300">{file.physicalPath}</p>
							<p class="mt-2 text-neutral-500">{m.kometa_migration_config_reference()}</p>
							<p class="break-all font-mono text-neutral-300">{file.configReference}</p>
						</div>
					{/each}
				</div>
			</details>

			{#if migration.lastFailure}
				<div class="mt-3 rounded-lg border border-red-900/70 bg-red-950/30 p-3" role="alert">
					<p class="text-sm font-medium text-red-200">{m.kometa_migration_last_failure()}</p>
					<p class="mt-1 text-xs text-red-300">
						{m.kometa_migration_failure_detail({
							phase: migration.lastFailure.phase,
							code: migration.lastFailure.code,
							date: dateLabel(migration.lastFailure.at)
						})}
					</p>
				</div>
			{/if}

			{#if migration.requiresAcknowledgment && migration.manualSnippet}
				<div class="mt-4 rounded-xl border border-amber-800/70 bg-neutral-950/50 p-4">
					<h3 class="text-sm font-semibold text-neutral-100">
						{m.kometa_migration_manual_title()}
					</h3>
					<p class="mt-1 text-xs text-neutral-300">{m.kometa_migration_manual_hint()}</p>
					<ol class="mt-3 list-decimal space-y-1 pl-5 text-xs text-amber-100">
						<li>{m.kometa_migration_manual_step_replace()}</li>
						<li>{m.kometa_migration_manual_step_preserve()}</li>
						<li>{m.kometa_migration_manual_step_verify()}</li>
					</ol>
					<pre
						class="mt-3 max-h-72 overflow-auto rounded-lg border border-neutral-800 bg-black/60 p-3 text-xs whitespace-pre-wrap text-neutral-200">{migration.manualSnippet}</pre>
					<p class="mt-2 font-mono text-[11px] text-neutral-500">
						{m.kometa_migration_fingerprint({
							fingerprint: shortFingerprint(migration.manualSnippetFingerprint)
						})}
					</p>
					<label class="mt-4 flex max-w-3xl items-start gap-2 text-xs text-neutral-200">
						<input
							type="checkbox"
							bind:checked={acknowledgeManual}
							disabled={isBusy || mutationDisabled || !migration.scopeMatches}
							class="mt-0.5"
						/>
						<span>{m.kometa_migration_manual_acknowledge()}</span>
					</label>
					<button
						type="button"
						class="btn btn-accent mt-3 min-h-11"
						disabled={isBusy || mutationDisabled || !migration.scopeMatches || !acknowledgeManual}
						onclick={acknowledgeMigration}
					>
						{busyAction === 'acknowledge'
							? m.kometa_migration_acknowledging()
							: m.kometa_migration_acknowledge_action()}
					</button>
					<p class="mt-2 text-[11px] text-neutral-500">
						{m.kometa_migration_manual_not_verified()}
					</p>
				</div>
			{/if}
		{/if}

		<div class="sr-only" aria-live="polite" aria-atomic="true">
			{#if busyAction}{m.kometa_migration_working()}{/if}
			{#if notice}{notice}{/if}
			{#if disclosureAnnouncement}{disclosureAnnouncement}{/if}
		</div>
		{#if errorCode}<p class="mt-3 text-sm text-red-300" role="alert">
				{errorMessage(errorCode)}
			</p>{/if}
		{#if notice}<p class="mt-3 text-sm text-emerald-300" role="status">{notice}</p>{/if}

		{#if preview}
			<div class="mt-5 rounded-xl border border-accent-900/60 bg-neutral-950/60 p-4">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div>
						<p class="text-[11px] font-medium tracking-[0.14em] text-accent-300 uppercase">
							{m.kometa_migration_preview_eyebrow()}
						</p>
						<h3
							bind:this={previewHeading}
							tabindex="-1"
							class="mt-1 text-base font-semibold text-neutral-100"
						>
							{m.kometa_migration_preview_title()}
						</h3>
						<p class="mt-1 text-xs text-neutral-400">
							{preview.activation === 'managed'
								? m.kometa_migration_preview_managed_hint()
								: m.kometa_migration_preview_manual_hint()}
						</p>
					</div>
					<span class="badge badge-muted">
						{preview.activation === 'managed'
							? m.kometa_migration_activation_managed()
							: m.kometa_migration_activation_manual()}
					</span>
				</div>

				<div class="mt-4 grid grid-cols-2 gap-2">
					<div class="rounded-lg border border-neutral-800 p-3">
						<strong class="block text-xl tabular-nums">{preview.display.classified.length}</strong>
						<span class="text-xs text-neutral-400">{m.kometa_migration_classified()}</span>
					</div>
					<div class="rounded-lg border border-neutral-800 p-3">
						<strong class="block text-xl tabular-nums">{preview.display.ambiguous.length}</strong>
						<span class="text-xs text-neutral-400">{m.kometa_migration_ambiguous()}</span>
					</div>
				</div>

				{#if preview.display.ambiguous.length > 0}
					<div class="mt-4 rounded-lg border border-amber-800/80 bg-amber-950/30 p-3">
						<h4 class="text-sm font-semibold text-amber-100">
							{m.kometa_migration_ambiguous_title({ count: preview.display.ambiguous.length })}
						</h4>
						<p class="mt-1 text-xs text-amber-200/90">
							{m.kometa_migration_ambiguous_hint()}
						</p>
						<ul
							id="kometa-migration-ambiguous-list"
							class="mt-3 max-h-52 space-y-2 overflow-y-auto pr-1"
						>
							{#each preview.display.ambiguous.slice(0, ambiguousDisclosure.shown) as item, index (`${item.entryFingerprint}-${index}`)}
								<li class="rounded-md border border-amber-900/50 bg-black/20 p-2 text-xs">
									<div class="flex flex-wrap items-baseline justify-between gap-2">
										<span class="font-mono text-neutral-200">{item.legacyKey}</span>
										<span class="text-amber-200">{ambiguityLabel(item.reason)}</span>
									</div>
									{#if item.slots.length}
										<p class="mt-1 text-neutral-400">
											{m.kometa_migration_slots({ slots: slotsLabel(item.slots) })}
										</p>
									{/if}
								</li>
							{/each}
						</ul>
						<p class="mt-2 text-xs text-neutral-400">
							{m.kometa_migration_disclosure_count({
								shown: ambiguousDisclosure.shown,
								total: preview.display.ambiguous.length,
								remaining: ambiguousDisclosure.remaining
							})}
						</p>
						{#if preview.display.ambiguous.length > MIGRATION_DISCLOSURE_BATCH_SIZE}
							<button
								type="button"
								class="btn btn-ghost mt-2 min-h-11"
								disabled={ambiguousDisclosure.remaining === 0}
								aria-controls="kometa-migration-ambiguous-list"
								onclick={revealMoreAmbiguous}
							>
								{ambiguousDisclosure.remaining > 0
									? m.kometa_migration_load_more({
											count: ambiguousDisclosure.next,
											remaining: ambiguousDisclosure.remaining
										})
									: m.kometa_migration_all_entries_shown({
											total: preview.display.ambiguous.length
										})}
							</button>
						{/if}
						<label class="mt-4 flex items-start gap-2 text-xs font-medium text-amber-50">
							<input type="checkbox" bind:checked={acceptAmbiguous} class="mt-0.5" />
							<span>{m.kometa_migration_accept_ambiguous()}</span>
						</label>
					</div>
				{/if}

				<details class="mt-4 rounded-lg border border-neutral-800 p-3">
					<summary class="cursor-pointer text-sm font-medium text-neutral-200">
						{m.kometa_migration_classified_details()}
					</summary>
					{#if preview.display.classified.length === 0}
						<p class="mt-2 text-xs text-neutral-400">{m.kometa_migration_no_classified()}</p>
					{:else}
						<ul
							id="kometa-migration-classified-list"
							class="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1"
						>
							{#each preview.display.classified.slice(0, classifiedDisclosure.shown) as item, index (`${item.entryFingerprint}-${index}`)}
								<li class="rounded-md border border-neutral-800 bg-neutral-900/50 p-2 text-xs">
									<div class="flex flex-wrap items-baseline justify-between gap-2">
										<span class="font-mono text-neutral-200">{item.legacyKey}</span>
										<span class="text-neutral-400">
											{mediaKindLabel(item.destination.mediaKind)} · {item.destination.namespace.toUpperCase()}
											{item.destination.mappingId}
										</span>
									</div>
									<p class="mt-1 text-neutral-500">
										{m.kometa_migration_evidence({ evidence: evidenceLabel(item.evidence) })}
										{#if item.slots.length}
											· {m.kometa_migration_slots({
												slots: slotsLabel(item.slots)
											})}{/if}
									</p>
								</li>
							{/each}
						</ul>
						<p class="mt-2 text-xs text-neutral-400">
							{m.kometa_migration_disclosure_count({
								shown: classifiedDisclosure.shown,
								total: preview.display.classified.length,
								remaining: classifiedDisclosure.remaining
							})}
						</p>
						{#if preview.display.classified.length > MIGRATION_DISCLOSURE_BATCH_SIZE}
							<button
								type="button"
								class="btn btn-ghost mt-2 min-h-11"
								disabled={classifiedDisclosure.remaining === 0}
								aria-controls="kometa-migration-classified-list"
								onclick={revealMoreClassified}
							>
								{classifiedDisclosure.remaining > 0
									? m.kometa_migration_load_more({
											count: classifiedDisclosure.next,
											remaining: classifiedDisclosure.remaining
										})
									: m.kometa_migration_all_entries_shown({
											total: preview.display.classified.length
										})}
							</button>
						{/if}
					{/if}
				</details>

				<div class="mt-4 grid gap-3 lg:grid-cols-2">
					{#each ['movie', 'show'] as kind (kind)}
						{@const file = preview.display.files[kind as MediaKind]}
						{@const changeDisclosure = disclosureState(
							fileChangeVisibleLimits[kind as MediaKind],
							file.changes.length,
							MIGRATION_DISCLOSURE_BATCH_SIZE
						)}
						<div class="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
							<div class="flex items-start justify-between gap-3">
								<div>
									<h4 class="text-sm font-medium text-neutral-100">{file.filename}</h4>
									<p class="mt-1 break-all font-mono text-[11px] text-neutral-500">
										{file.physicalPath}
									</p>
								</div>
								<span class="badge badge-info">
									{m.kometa_migration_file_counts({ added: file.added, unchanged: file.unchanged })}
								</span>
							</div>
							<p class="mt-2 text-xs text-neutral-400">
								{m.kometa_migration_reference({ reference: file.configReference })}
							</p>
							{#if file.changes.length}
								<ul
									id={`kometa-migration-${kind}-changes`}
									class="mt-3 max-h-48 space-y-1 overflow-y-auto font-mono text-[11px]"
								>
									{#each file.changes.slice(0, changeDisclosure.shown) as change, index (`${change.entryFingerprint}-${index}`)}
										<li class="flex gap-2">
											<span
												class="font-sans {change.operation === 'add'
													? 'text-emerald-300'
													: 'text-neutral-400'}"
											>
												{operationLabel(change.operation)}
											</span>
											<span class="min-w-0 break-all text-neutral-300">{change.path}</span>
										</li>
									{/each}
								</ul>
								<p class="mt-2 text-xs text-neutral-400">
									{m.kometa_migration_disclosure_count({
										shown: changeDisclosure.shown,
										total: file.changes.length,
										remaining: changeDisclosure.remaining
									})}
								</p>
								{#if file.changes.length > MIGRATION_DISCLOSURE_BATCH_SIZE}
									<button
										type="button"
										class="btn btn-ghost mt-2 min-h-11"
										disabled={changeDisclosure.remaining === 0}
										aria-controls={`kometa-migration-${kind}-changes`}
										onclick={() => revealMoreFileChanges(kind as MediaKind, file.changes.length)}
									>
										{changeDisclosure.remaining > 0
											? m.kometa_migration_load_more({
													count: changeDisclosure.next,
													remaining: changeDisclosure.remaining
												})
											: m.kometa_migration_all_entries_shown({ total: file.changes.length })}
									</button>
								{/if}
							{/if}
						</div>
					{/each}
				</div>

				{#if preview.display.libraries.length}
					<div class="mt-4 rounded-lg border border-neutral-800 p-3">
						<h4 class="text-sm font-medium text-neutral-100">
							{m.kometa_migration_library_changes()}
						</h4>
						<ul class="mt-3 space-y-2">
							{#each preview.display.libraries as library (library.library)}
								<li class="text-xs">
									<p class="font-medium text-neutral-200">
										{library.library} · {mediaKindLabel(library.mediaKind)}
									</p>
									<p class="mt-1 break-all font-mono text-neutral-400">
										{library.before.length ? library.before.join(', ') : m.kometa_migration_none()} →
										<span class="text-neutral-200">{library.after}</span>
									</p>
								</li>
							{/each}
						</ul>
					</div>
				{/if}

				{#if preview.activation === 'manual' && preview.manualSnippet}
					<div class="mt-4 rounded-lg border border-amber-900/60 bg-amber-950/20 p-3">
						<h4 class="text-sm font-medium text-amber-100">
							{m.kometa_migration_manual_preview_title()}
						</h4>
						<p class="mt-1 text-xs text-amber-200/80">
							{m.kometa_migration_manual_preview_hint()}
						</p>
						<pre
							class="mt-3 max-h-64 overflow-auto rounded-md border border-neutral-800 bg-black/50 p-3 text-xs whitespace-pre-wrap text-neutral-200">{preview.manualSnippet}</pre>
					</div>
				{/if}

				<details class="mt-4 rounded-lg border border-neutral-800 p-3">
					<summary class="cursor-pointer text-sm font-medium text-neutral-300">
						{m.kometa_migration_fingerprints_title()}
					</summary>
					<dl class="mt-3 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
						{#each Object.entries(preview.fingerprints) as [label, fingerprint] (label)}
							<div
								class="flex items-baseline justify-between gap-3 border-b border-neutral-800/70 pb-1"
							>
								<dt class="text-neutral-500">
									{fingerprintLabel(label as keyof MigrationPreview['fingerprints'])}
								</dt>
								<dd class="font-mono text-neutral-300">{shortFingerprint(fingerprint)}</dd>
							</div>
						{/each}
					</dl>
				</details>

				{#if preview.display.diffTruncated}
					<p class="mt-3 text-xs text-amber-300">{m.kometa_diff_truncated()}</p>
				{/if}

				<div class="mt-5 flex flex-wrap items-center gap-2 border-t border-neutral-800 pt-4">
					<button
						type="button"
						class="btn btn-accent min-h-11"
						disabled={isBusy || mutationDisabled || (ambiguousCount > 0 && !acceptAmbiguous)}
						onclick={confirmMigration}
					>
						{busyAction === 'confirm'
							? m.kometa_migration_confirming()
							: m.kometa_migration_confirm_action()}
					</button>
					<button
						type="button"
						class="btn btn-ghost min-h-11"
						disabled={isBusy}
						onclick={cancelPreview}
					>
						{busyAction === 'cancel-preview'
							? m.kometa_migration_cancelling()
							: m.kometa_migration_cancel_preview()}
					</button>
					<p class="text-xs text-neutral-500">{m.kometa_migration_cancel_hint()}</p>
				</div>
			</div>
		{/if}

		{#if rollbackPreview}
			<div class="mt-5 rounded-xl border border-red-900/70 bg-neutral-950/60 p-4">
				<p class="text-[11px] font-medium tracking-[0.14em] text-red-300 uppercase">
					{m.kometa_migration_rollback_eyebrow()}
				</p>
				<h3
					bind:this={previewHeading}
					tabindex="-1"
					class="mt-1 text-base font-semibold text-neutral-100"
				>
					{m.kometa_migration_rollback_title()}
				</h3>
				<p class="mt-1 max-w-3xl text-xs text-neutral-300">
					{m.kometa_migration_rollback_hint()}
				</p>

				{#if rollbackPreview.warnings.includes('diff_truncated')}
					<p class="mt-3 text-xs text-amber-300">{m.kometa_diff_truncated()}</p>
				{/if}
				{#if rollbackPreview.changes.length === 0}
					<p class="mt-3 text-xs text-neutral-400">{m.kometa_preview_none()}</p>
				{:else}
					<ul
						id="kometa-migration-rollback-changes"
						class="mt-3 max-h-64 space-y-1 overflow-y-auto rounded-lg border border-neutral-800 bg-black/30 p-3"
					>
						{#each rollbackPreview.changes.slice(0, rollbackDisclosure.shown) as change, index (index)}
							<li class="flex flex-wrap gap-x-2 font-mono text-xs">
								<span class="font-sans text-red-300">{operationLabel(change.op)}</span>
								<span class="break-all text-neutral-300">{change.path}</span>
								{#if change.before != null}<span class="text-neutral-500">{change.before}</span
									>{/if}
								{#if change.after != null}<span class="text-neutral-400">→ {change.after}</span
									>{/if}
							</li>
						{/each}
					</ul>
					<p class="mt-2 text-xs text-neutral-400">
						{m.kometa_migration_disclosure_count({
							shown: rollbackDisclosure.shown,
							total: rollbackPreview.changes.length,
							remaining: rollbackDisclosure.remaining
						})}
					</p>
					{#if rollbackPreview.changes.length > ROLLBACK_DISCLOSURE_BATCH_SIZE}
						<button
							type="button"
							class="btn btn-ghost mt-2 min-h-11"
							disabled={rollbackDisclosure.remaining === 0}
							aria-controls="kometa-migration-rollback-changes"
							onclick={revealMoreRollbackChanges}
						>
							{rollbackDisclosure.remaining > 0
								? m.kometa_migration_load_more({
										count: rollbackDisclosure.next,
										remaining: rollbackDisclosure.remaining
									})
								: m.kometa_migration_all_entries_shown({
										total: rollbackPreview.changes.length
									})}
						</button>
					{/if}
				{/if}

				<div
					class="mt-4 rounded-lg border border-amber-900/60 bg-amber-950/20 p-3 text-xs text-amber-100"
				>
					<p class="font-medium">{m.kometa_migration_rollback_preserves_title()}</p>
					<p class="mt-1 text-amber-200/80">{m.kometa_migration_rollback_preserves_hint()}</p>
				</div>
				<label class="mt-4 flex max-w-3xl items-start gap-2 text-xs text-neutral-200">
					<input type="checkbox" bind:checked={confirmRollback} class="mt-0.5" />
					<span>{m.kometa_migration_rollback_confirm_check()}</span>
				</label>
				<div class="mt-4 flex flex-wrap gap-2 border-t border-neutral-800 pt-4">
					<button
						type="button"
						class="btn min-h-11 bg-red-900/60 text-red-100 hover:bg-red-800/70"
						disabled={isBusy || mutationDisabled || !confirmRollback}
						onclick={rollbackMigration}
					>
						{busyAction === 'rollback'
							? m.kometa_migration_rolling_back()
							: m.kometa_migration_rollback_confirm_action()}
					</button>
					<button
						type="button"
						class="btn btn-ghost min-h-11"
						disabled={isBusy}
						onclick={cancelRollbackPreview}
					>
						{busyAction === 'cancel-rollback-preview'
							? m.kometa_migration_cancelling()
							: m.kometa_migration_cancel_preview()}
					</button>
					<p class="self-center text-xs text-neutral-500">
						{m.kometa_migration_cancel_hint()}
					</p>
				</div>
			</div>
		{/if}
	</section>
{/if}
