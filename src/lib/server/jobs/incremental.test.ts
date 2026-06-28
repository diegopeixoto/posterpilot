import { describe, it, expect } from 'vitest';
import { shouldReprocessItem } from './incremental';

const older = new Date('2024-01-01T00:00:00Z');
const newer = new Date('2024-06-01T00:00:00Z');

// Args: (serverUpdatedAt, previousServerUpdatedAt, lastSyncedAt, opts)
describe('shouldReprocessItem', () => {
	it('forces reprocess when full is true (even if unchanged)', () => {
		expect(shouldReprocessItem(older, older, newer, { full: true, incremental: true })).toBe(true);
	});

	it('forces reprocess when incremental is disabled', () => {
		expect(shouldReprocessItem(older, older, newer, { full: false, incremental: false })).toBe(
			true
		);
	});

	it('reprocesses when never successfully synced (lastSyncedAt null)', () => {
		expect(shouldReprocessItem(older, older, null, { full: false, incremental: true })).toBe(true);
	});

	it('reprocesses when the server reports no current timestamp', () => {
		expect(shouldReprocessItem(null, older, newer, { full: false, incremental: true })).toBe(true);
	});

	it('reprocesses when there is no stored baseline to compare against', () => {
		expect(shouldReprocessItem(newer, null, newer, { full: false, incremental: true })).toBe(true);
	});

	it('reprocesses when the server timestamp changed since last stored', () => {
		expect(shouldReprocessItem(newer, older, newer, { full: false, incremental: true })).toBe(true);
	});

	it('skips when the server timestamp is unchanged since last stored', () => {
		expect(
			shouldReprocessItem(older, new Date(older.getTime()), newer, {
				full: false,
				incremental: true
			})
		).toBe(false);
	});

	it('is immune to clock skew: a changed item reprocesses even when lastSyncedAt is later than serverUpdatedAt', () => {
		// Server clock is behind the app clock, so lastSyncedAt > serverUpdatedAt, but
		// the server timestamp differs from what we stored → it genuinely changed.
		const appClockLater = new Date('2025-01-01T00:00:00Z');
		expect(
			shouldReprocessItem(newer, older, appClockLater, { full: false, incremental: true })
		).toBe(true);
	});

	it('is immune to clock skew: an unchanged item skips even when serverUpdatedAt is after lastSyncedAt', () => {
		// serverUpdatedAt(newer) > lastSyncedAt(older) would have re-run under the old
		// app-clock comparison, but it matches the stored baseline → unchanged → skip.
		expect(shouldReprocessItem(newer, newer, older, { full: false, incremental: true })).toBe(
			false
		);
	});
});
