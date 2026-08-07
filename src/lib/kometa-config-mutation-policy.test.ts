import { describe, expect, it } from 'vitest';
import {
	isKometaConfigMutationLocked,
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

	it('ignores absent and out-of-scope journals', () => {
		expect(isKometaConfigMutationLocked('structured', null)).toBe(false);
		expect(
			isKometaConfigMutationLocked('restore', { status: 'config_written', scopeMatches: false })
		).toBe(false);
	});

	it('fails closed for an unknown in-scope nonterminal status', () => {
		expect(
			isKometaConfigMutationLocked('raw', { status: 'future_checkpoint', scopeMatches: true })
		).toBe(true);
	});
});
