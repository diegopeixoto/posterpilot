import { describe, it, expect } from 'vitest';
import { shouldReprocessItem } from './incremental';

const older = new Date('2024-01-01T00:00:00Z');
const newer = new Date('2024-06-01T00:00:00Z');

describe('shouldReprocessItem', () => {
	it('forces reprocess when full is true (even with up-to-date timestamps)', () => {
		// Server unchanged since last sync, but a full sync overrides that.
		expect(shouldReprocessItem(older, newer, { full: true, incremental: true })).toBe(true);
	});

	it('forces reprocess when incremental is disabled', () => {
		// Same unchanged timestamps, but incremental off means always reprocess.
		expect(shouldReprocessItem(older, newer, { full: false, incremental: false })).toBe(true);
	});

	it('reprocesses when serverUpdatedAt is null (server reports no timestamp)', () => {
		expect(shouldReprocessItem(null, newer, { full: false, incremental: true })).toBe(true);
	});

	it('reprocesses when lastSyncedAt is null (never synced)', () => {
		expect(shouldReprocessItem(newer, null, { full: false, incremental: true })).toBe(true);
	});

	it('reprocesses when serverUpdatedAt is newer than lastSyncedAt', () => {
		expect(shouldReprocessItem(newer, older, { full: false, incremental: true })).toBe(true);
	});

	it('skips when serverUpdatedAt is older than lastSyncedAt', () => {
		expect(shouldReprocessItem(older, newer, { full: false, incremental: true })).toBe(false);
	});

	it('skips when serverUpdatedAt equals lastSyncedAt', () => {
		expect(
			shouldReprocessItem(older, new Date(older.getTime()), { full: false, incremental: true })
		).toBe(false);
	});
});
