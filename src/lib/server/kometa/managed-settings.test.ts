import { describe, expect, it } from 'vitest';
import { MANAGED_SETTINGS, managedSettingDef } from './managed-settings';

describe('kometa/managed-settings', () => {
	it('looks up a managed setting by id', () => {
		expect(managedSettingDef('asset_directory')?.key).toBe('asset_directory');
		expect(managedSettingDef('__nope__')).toBeUndefined();
	});

	it('has unique ids', () => {
		const ids = MANAGED_SETTINGS.map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
