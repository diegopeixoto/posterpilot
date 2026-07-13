import { m } from '$lib/paraglide/messages';
import type { PublicJobFailure } from '$lib/job-progress';

export function jobStatusLabel(status: string): string {
	switch (status) {
		case 'pending':
			return m.jobs_status_pending();
		case 'running':
			return m.jobs_status_running();
		case 'retry_scheduled':
			return m.jobs_status_retry_scheduled();
		case 'completed':
			return m.jobs_status_completed();
		case 'partial_failed':
			return m.jobs_status_partial_failed();
		case 'failed':
			return m.jobs_status_failed();
		case 'cancelled':
			return m.jobs_status_cancelled();
		case 'interrupted':
			return m.jobs_status_interrupted();
		default:
			return m.jobs_status_unknown();
	}
}

export function jobTypeLabel(type: string): string {
	switch (type) {
		case 'sync':
			return m.jobs_type_sync();
		case 'full_rescan':
			return m.jobs_type_full_rescan();
		case 'discover':
			return m.jobs_type_discover();
		case 'apply':
			return m.jobs_type_apply();
		case 'undo':
			return m.jobs_type_undo();
		case 'retry':
			return m.jobs_type_retry();
		case 'automation':
			return m.jobs_type_automation();
		case 'diagnostics':
			return m.jobs_type_diagnostics();
		case 'backup':
			return m.jobs_type_backup();
		case 'restore':
			return m.jobs_type_restore();
		case 'collection_apply':
			return m.jobs_type_collection_apply();
		case 'cross_server_apply':
			return m.jobs_type_cross_server_apply();
		default:
			return m.jobs_type_unknown();
	}
}

export function jobPhaseLabel(phase: string | null, status = 'running'): string {
	if (!phase && (status === 'pending' || status === 'retry_scheduled')) {
		return m.jobs_phase_queued();
	}
	switch (phase) {
		case 'server_read':
			return m.jobs_phase_server_read();
		case 'resolution':
			return m.jobs_phase_resolution();
		case 'reconciliation':
			return m.jobs_phase_reconciliation();
		case 'artwork_observation':
			return m.jobs_phase_artwork_observation();
		case 'discovery':
			return m.jobs_phase_discovery();
		case 'apply':
			return m.jobs_phase_apply();
		case 'collections':
			return m.jobs_phase_collections();
		case 'automation_sync':
			return m.jobs_phase_automation_sync();
		case 'automation_discovery':
			return m.jobs_phase_automation_discovery();
		default:
			return m.jobs_phase_unknown();
	}
}

export function jobErrorLabel(code: string | null | undefined): string {
	switch (code) {
		case 'item_failures':
			return m.jobs_error_item_failures();
		case 'provider_timeout':
		case 'timed_out':
			return m.jobs_error_provider_timeout();
		case 'provider_discovery_failed':
			return m.jobs_error_provider_discovery();
		case 'sync_item_transient':
			return m.jobs_error_sync_item();
		case 'cancelled':
			return m.jobs_error_cancelled();
		default:
			return m.jobs_error_unknown({ code: code || 'job_failed' });
	}
}

function jobDestinationLabel(destination: string | null): string {
	if (destination === 'server') return m.jobs_destination_server();
	if (destination === 'kometa') return m.jobs_destination_kometa();
	return m.jobs_destination_other();
}

function jobArtworkKindLabel(kind: string | null): string {
	switch (kind) {
		case 'poster':
			return m.jobs_slot_poster();
		case 'background':
			return m.jobs_slot_background();
		case 'season':
			return m.jobs_slot_season();
		case 'title_card':
			return m.jobs_slot_title_card();
		default:
			return m.jobs_slot_other();
	}
}

export function jobFailureTargetLabel(failure: PublicJobFailure): string {
	const kind = jobArtworkKindLabel(failure.kind);
	const slot =
		failure.episode !== null && failure.season !== null
			? m.jobs_slot_scope_episode({
					kind,
					season: failure.season,
					episode: failure.episode
				})
			: failure.season !== null
				? m.jobs_slot_scope_season({ kind, season: failure.season })
				: kind;
	const destination = jobDestinationLabel(failure.destination);
	return failure.mediaItemId === null
		? m.jobs_failure_target_general({ destination, slot })
		: m.jobs_failure_target({
				item: failure.mediaItemId,
				destination,
				slot
			});
}

export function jobRetryErrorLabel(code: string | null, conflictingJobId?: number): string {
	if (code === 'job_retry_no_eligible_outcomes') return m.jobs_retry_no_eligible();
	if (code === 'job_conflict' && conflictingJobId) {
		return m.jobs_retry_conflict({ id: conflictingJobId });
	}
	return m.jobs_retry_error();
}
