import { describe, expect, it } from 'vitest';
import {
	MIGRATION_DISCLOSURE_BATCH_SIZE,
	ROLLBACK_DISCLOSURE_BATCH_SIZE,
	disclosureState,
	nextDisclosureLimit,
	reconciledMigrationFeedback,
	shouldDiscardFrozenPreview
} from './kometa-migration-view-state';

describe('Kometa migration disclosure state', () => {
	it('reveals stable migration batches and reports the exact remainder', () => {
		expect(disclosureState(MIGRATION_DISCLOSURE_BATCH_SIZE, 65, 30)).toEqual({
			shown: 30,
			remaining: 35,
			next: 30
		});
		expect(nextDisclosureLimit(30, 65, 30)).toBe(60);
		expect(disclosureState(60, 65, 30)).toEqual({ shown: 60, remaining: 5, next: 5 });
		expect(nextDisclosureLimit(60, 65, 30)).toBe(65);
	});

	it('keeps rollback disclosure bounded and clamps malformed counts', () => {
		expect(disclosureState(ROLLBACK_DISCLOSURE_BATCH_SIZE, 41, 40)).toEqual({
			shown: 40,
			remaining: 1,
			next: 1
		});
		expect(disclosureState(100, 3, 40)).toEqual({ shown: 3, remaining: 0, next: 0 });
		expect(disclosureState(-1, Number.NaN, 0)).toEqual({ shown: 0, remaining: 0, next: 0 });
	});

	it('discards frozen identities that are stale, consumed, or followed by durable execution', () => {
		for (const code of [
			'plan_expired',
			'plan_consumed',
			'plan_stale',
			'plan_scope_mismatch',
			'migration_target_changed',
			'migration_legacy_changed',
			'migration_backup_invalid',
			'migration_write_failed',
			'migration_verify_failed',
			'migration_evidence_changed',
			'migration_evidence_unavailable',
			'migration_rollback_unavailable',
			'kometa_migration_in_progress',
			'kometa_migration_config_incompatible',
			'kometa_migration_scope_changed',
			'kometa_migration_rollback_unavailable'
		]) {
			expect(shouldDiscardFrozenPreview(code), code).toBe(true);
		}
		expect(shouldDiscardFrozenPreview('kometa_migration_ambiguous_confirmation_required')).toBe(
			false
		);
		expect(shouldDiscardFrozenPreview('kometa_migration_request_failed')).toBe(false);
	});

	it('reconciles request errors only when a durable checkpoint proves the outcome', () => {
		expect(
			reconciledMigrationFeedback('before', 'after', {
				status: 'failed',
				hasLastFailure: true
			})
		).toBe('failure');
		expect(
			reconciledMigrationFeedback('before', 'after', {
				status: 'completed',
				hasLastFailure: false
			})
		).toBe('completed');
		expect(
			reconciledMigrationFeedback('before', 'after', {
				status: 'awaiting_manual_wiring',
				hasLastFailure: false
			})
		).toBe('awaiting_manual_wiring');
		expect(
			reconciledMigrationFeedback('before', 'after', {
				status: 'abandoned',
				hasLastFailure: true
			})
		).toBe('abandoned');
		expect(
			reconciledMigrationFeedback('before', 'after', {
				status: 'rolled_back',
				hasLastFailure: false
			})
		).toBe('rolled_back');
		expect(
			reconciledMigrationFeedback('same', 'same', {
				status: 'failed',
				hasLastFailure: true
			})
		).toBeNull();
		expect(
			reconciledMigrationFeedback('before', 'after', {
				status: 'writing_splits',
				hasLastFailure: false
			})
		).toBeNull();
	});
});
