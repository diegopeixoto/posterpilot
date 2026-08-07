import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
	class ControlError extends Error {
		constructor(
			readonly code: 'kometa_config_recovery_required' | 'kometa_migration_config_locked'
		) {
			super(code);
		}
	}
	return {
		ControlError,
		materialize: vi.fn(),
		withControl: vi.fn()
	};
});

vi.mock('./index', () => ({ materializeLegacyServerInstance: h.materialize }));
vi.mock('./legacy-mutation', () => ({
	LegacyServerMutationControlError: h.ControlError,
	withLegacyServerMutationControl: h.withControl
}));

import { materializeLegacyServerInstanceAtBoot } from './legacy-boot';

beforeEach(() => {
	vi.clearAllMocks();
	h.withControl.mockImplementation(
		async (operation: (control: { controlLease: string }) => Promise<unknown>) =>
			operation({ controlLease: 'boot-lease' })
	);
	h.materialize.mockResolvedValue({ id: 'legacy-default', name: 'Legacy' });
});

describe('materializeLegacyServerInstanceAtBoot', () => {
	it('materializes inside the guard and fences the store transaction with its lease', async () => {
		await expect(materializeLegacyServerInstanceAtBoot()).resolves.toEqual({
			status: 'materialized',
			server: { id: 'legacy-default', name: 'Legacy' }
		});
		expect(h.materialize).toHaveBeenCalledWith('boot-lease');
	});

	it.each(['kometa_config_recovery_required', 'kometa_migration_config_locked'] as const)(
		'defers boot materialization when %s is pending',
		async (code) => {
			h.withControl.mockRejectedValue(new h.ControlError(code));

			await expect(materializeLegacyServerInstanceAtBoot()).resolves.toEqual({
				status: 'deferred',
				reason: code
			});
			expect(h.materialize).not.toHaveBeenCalled();
		}
	);

	it('does not hide unexpected boot failures', async () => {
		h.withControl.mockRejectedValue(new Error('database unavailable'));

		await expect(materializeLegacyServerInstanceAtBoot()).rejects.toThrow('database unavailable');
	});
});
