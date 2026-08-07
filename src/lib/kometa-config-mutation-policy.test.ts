import { describe, expect, it } from 'vitest';
import {
	canRepairKometaMigrationScope,
	isKometaConfigMutationLocked,
	kometaMigrationMutationBlocker,
	type KometaConfigMutationAction
} from './kometa-config-mutation-policy';

const INCOMPLETE_STATUSES = [
	'prepared',
	'writing_splits',
	'splits_verified',
	'config_written',
	'awaiting_manual_wiring',
	'failed',
	'recovery_required',
	'abandoned',
	'rollback_prepared'
] as const;

describe('isKometaConfigMutationLocked', () => {
	it.each(INCOMPLETE_STATUSES)('blocks structured sync while %s', (status) => {
		expect(isKometaConfigMutationLocked('structured', { status, scopeMatches: true })).toBe(true);
	});

	it.each(INCOMPLETE_STATUSES)('blocks restore while %s', (status) => {
		expect(isKometaConfigMutationLocked('restore', { status, scopeMatches: true })).toBe(true);
	});

	it.each(INCOMPLETE_STATUSES.filter((status) => status !== 'awaiting_manual_wiring'))(
		'blocks raw replacement while %s',
		(status) => {
			expect(isKometaConfigMutationLocked('raw', { status, scopeMatches: true })).toBe(true);
		}
	);

	it('allows raw replacement only for the manual-wiring checkpoint', () => {
		expect(
			isKometaConfigMutationLocked('raw', {
				status: 'awaiting_manual_wiring',
				scopeMatches: true
			})
		).toBe(false);
	});

	it.each(['completed', 'rolled_back'] as const)(
		'allows every config action after %s',
		(status) => {
			for (const action of ['structured', 'raw', 'restore'] as KometaConfigMutationAction[]) {
				expect(isKometaConfigMutationLocked(action, { status, scopeMatches: true })).toBe(false);
			}
		}
	);

	it('ignores an absent journal but fails closed for an out-of-scope incomplete journal', () => {
		expect(isKometaConfigMutationLocked('structured', null)).toBe(false);
		expect(
			isKometaConfigMutationLocked('restore', { status: 'config_written', scopeMatches: false })
		).toBe(true);
		expect(
			isKometaConfigMutationLocked('raw', {
				status: 'awaiting_manual_wiring',
				scopeMatches: false
			})
		).toBe(true);
	});

	it('fails closed for an unknown in-scope nonterminal status', () => {
		expect(
			isKometaConfigMutationLocked('raw', { status: 'future_checkpoint', scopeMatches: true })
		).toBe(true);
	});
});

describe('canRepairKometaMigrationScope', () => {
	it('allows a drifted incomplete journal to expose only its restorative settings UI', () => {
		expect(
			canRepairKometaMigrationScope({ status: 'recovery_required', scopeMatches: false })
		).toBe(true);
		expect(canRepairKometaMigrationScope({ status: 'abandoned', scopeMatches: false })).toBe(true);
	});

	it('does not open settings for an in-scope, absent, or terminal journal', () => {
		expect(canRepairKometaMigrationScope(null)).toBe(false);
		expect(canRepairKometaMigrationScope({ status: 'failed', scopeMatches: true })).toBe(false);
		expect(canRepairKometaMigrationScope({ status: 'completed', scopeMatches: false })).toBe(false);
		expect(canRepairKometaMigrationScope({ status: 'rolled_back', scopeMatches: false })).toBe(
			false
		);
	});
});

describe('kometaMigrationMutationBlocker', () => {
	it('lets the durable journal recovery flow win over local settings blockers', () => {
		expect(
			kometaMigrationMutationBlocker({
				migrationScopeLocked: true,
				bindingReady: false,
				savingHeader: true,
				headerDirty: true
			})
		).toBeNull();
	});

	it('prioritizes the binding, save-in-flight, and dirty-setting reasons', () => {
		expect(
			kometaMigrationMutationBlocker({
				migrationScopeLocked: false,
				bindingReady: false,
				savingHeader: true,
				headerDirty: true
			})
		).toBe('binding');
		expect(
			kometaMigrationMutationBlocker({
				migrationScopeLocked: false,
				bindingReady: true,
				savingHeader: true,
				headerDirty: true
			})
		).toBe('saving_settings');
		expect(
			kometaMigrationMutationBlocker({
				migrationScopeLocked: false,
				bindingReady: true,
				savingHeader: false,
				headerDirty: true
			})
		).toBe('dirty_settings');
	});

	it('does not block a clean migration scope', () => {
		expect(
			kometaMigrationMutationBlocker({
				migrationScopeLocked: false,
				bindingReady: true,
				savingHeader: false,
				headerDirty: false
			})
		).toBeNull();
	});
});
