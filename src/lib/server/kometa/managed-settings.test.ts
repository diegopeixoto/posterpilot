import { describe, expect, it } from 'vitest';
import {
	MANAGED_SETTINGS,
	MANAGED_SETTING_SECRET_PATHS,
	managedSettingDef
} from './managed-settings';

describe('kometa/managed-settings', () => {
	it('looks up a managed setting by id', () => {
		expect(managedSettingDef('asset_directory')?.key).toBe('asset_directory');
		expect(managedSettingDef('__nope__')).toBeUndefined();
	});

	it('has unique ids', () => {
		const ids = MANAGED_SETTINGS.map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('classifies every managed webhook URL as a secret', () => {
		for (const setting of MANAGED_SETTINGS.filter((entry) => entry.section === 'webhooks')) {
			expect(setting.secret).toBe(true);
			expect(MANAGED_SETTING_SECRET_PATHS).toContain(`${setting.section}.${setting.key}`);
		}
	});
});
