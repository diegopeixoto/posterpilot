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
}

export const MANAGED_SETTINGS: readonly ManagedSettingDef[] = Object.freeze([
	{ id: 'asset_directory', section: 'settings', key: 'asset_directory', placeholder: '/assets' },
	{ id: 'webhook_error', section: 'webhooks', key: 'error', placeholder: 'https://…' },
	{ id: 'webhook_run_start', section: 'webhooks', key: 'run_start', placeholder: 'https://…' },
	{ id: 'webhook_run_end', section: 'webhooks', key: 'run_end', placeholder: 'https://…' }
]);

const BY_ID = new Map(MANAGED_SETTINGS.map((s) => [s.id, s]));

/** Resolve a managed-setting definition by id, or undefined if unknown. */
export function managedSettingDef(id: string): ManagedSettingDef | undefined {
	return BY_ID.get(id);
}
