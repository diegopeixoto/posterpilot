import { describe, expect, it } from 'vitest';
import {
	MIGRATION_DISCLOSURE_BATCH_SIZE,
	ROLLBACK_DISCLOSURE_BATCH_SIZE,
	disclosureState,
	nextDisclosureLimit,
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

	it('discards only frozen identities that cannot be confirmed again', () => {
		expect(shouldDiscardFrozenPreview('plan_expired')).toBe(true);
		expect(shouldDiscardFrozenPreview('plan_consumed')).toBe(true);
		expect(shouldDiscardFrozenPreview('plan_stale')).toBe(false);
		expect(shouldDiscardFrozenPreview('migration_write_failed')).toBe(false);
	});
});
