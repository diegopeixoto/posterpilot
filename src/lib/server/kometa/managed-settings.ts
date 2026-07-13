/**
 * The bounded set of global Kometa `settings:` / `webhooks:` values PosterPilot
 * exposes for management. Deliberately small and string-valued (so we never have
 * to decide how to quote booleans/numbers); grow it deliberately.
 *
 * Pure data — safe to import from both server orchestration and the settings UI.
 */

export interface ManagedSettingDef {
	/** Stable id used as the storage key and the i18n key suffix `kometa_setting_<id>`. */
	id: string;
	/** Target top-level section in config.yml. */
	section: 'settings' | 'webhooks';
	/** Key within that section. */
	key: string;
	/** Hint for the input control. */
	placeholder?: string;
	/** Secret values are never returned to the browser after being stored. */
	secret?: boolean;
}

export const MANAGED_SETTINGS: readonly ManagedSettingDef[] = Object.freeze([
	{ id: 'asset_directory', section: 'settings', key: 'asset_directory', placeholder: '/assets' },
	{
		id: 'webhook_error',
		section: 'webhooks',
		key: 'error',
		placeholder: 'https://…',
		secret: true
	},
	{
		id: 'webhook_run_start',
		section: 'webhooks',
		key: 'run_start',
		placeholder: 'https://…',
		secret: true
	},
	{
		id: 'webhook_run_end',
		section: 'webhooks',
		key: 'run_end',
		placeholder: 'https://…',
		secret: true
	}
]);

/** Managed setting paths that must be masked in structured and raw previews. */
export const MANAGED_SETTING_SECRET_PATHS: ReadonlySet<string> = new Set(
	MANAGED_SETTINGS.filter((setting) => setting.secret).map(
		(setting) => `${setting.section}.${setting.key}`
	)
);

const BY_ID = new Map(MANAGED_SETTINGS.map((s) => [s.id, s]));

/** Resolve a managed-setting definition by id, or undefined if unknown. */
export function managedSettingDef(id: string): ManagedSettingDef | undefined {
	return BY_ID.get(id);
}
