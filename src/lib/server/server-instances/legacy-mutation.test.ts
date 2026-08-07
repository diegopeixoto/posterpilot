import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	assertOwned: vi.fn(),
	checkpointGuard: vi.fn(),
	loadJournal: vi.fn(),
	isIncomplete: vi.fn(),
	withControlLock: vi.fn()
}));

vi.mock('$lib/server/kometa/migration-control-lock', () => ({
	withKometaMigrationControlLock: h.withControlLock
}));
vi.mock('$lib/server/kometa/config-mutation-recovery', () => ({
	assertNoPendingKometaConfigMutationWhileOwned: h.checkpointGuard
}));
vi.mock('$lib/server/kometa/migration-store', () => ({
	loadKometaMigrationJournalForGuard: h.loadJournal
}));
vi.mock('$lib/server/kometa/migration-journal', () => ({
	isKometaMigrationIncomplete: h.isIncomplete
}));

import {
	LegacyServerMutationControlError,
	withLegacyServerMutationControl
} from './legacy-mutation';

beforeEach(() => {
	vi.clearAllMocks();
	h.withControlLock.mockImplementation(
		async (operation: (assertOwned: typeof h.assertOwned) => Promise<unknown>) =>
			operation(h.assertOwned)
	);
	h.checkpointGuard.mockImplementation(async (assertOwned: () => Promise<unknown>) => {
		await assertOwned();
	});
	h.loadJournal.mockResolvedValue(null);
	h.isIncomplete.mockReturnValue(false);
	h.assertOwned.mockResolvedValueOnce('checkpoint-lease').mockResolvedValueOnce('write-lease');
});

describe('withLegacyServerMutationControl', () => {
	it('renews the durable lease after checkpoint and journal guards and passes it to the writer', async () => {
		const operation = vi.fn(async ({ controlLease }) => controlLease);

		await expect(withLegacyServerMutationControl(operation)).resolves.toBe('write-lease');
		expect(h.checkpointGuard).toHaveBeenCalledWith(h.assertOwned);
		expect(h.loadJournal).toHaveBeenCalledWith('legacy-default');
		expect(h.assertOwned).toHaveBeenCalledTimes(2);
		expect(operation).toHaveBeenCalledWith({
			assertControlLockOwned: h.assertOwned,
			controlLease: 'write-lease'
		});
	});

	it('fails closed before the write when a migration journal is incomplete', async () => {
		h.loadJournal.mockResolvedValue({ status: 'config_written' });
		h.isIncomplete.mockReturnValue(true);
		const operation = vi.fn();

		await expect(withLegacyServerMutationControl(operation)).rejects.toEqual(
			new LegacyServerMutationControlError('kometa_migration_config_locked')
		);
		expect(operation).not.toHaveBeenCalled();
		expect(h.assertOwned).toHaveBeenCalledTimes(1);
	});

	it('fails closed when the global journal guard cannot be read', async () => {
		h.loadJournal.mockRejectedValue(new Error('journal unavailable'));

		await expect(withLegacyServerMutationControl(vi.fn())).rejects.toMatchObject({
			code: 'kometa_migration_config_locked'
		});
	});

	it('reports checkpoint recovery before consulting the migration journal', async () => {
		h.checkpointGuard.mockRejectedValue(new Error('checkpoint pending'));

		await expect(withLegacyServerMutationControl(vi.fn())).rejects.toMatchObject({
			code: 'kometa_config_recovery_required'
		});
		expect(h.loadJournal).not.toHaveBeenCalled();
	});
});
