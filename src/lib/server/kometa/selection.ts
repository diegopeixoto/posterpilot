/**
 * The Kometa-tab selection payload and its parser. Pure (no db/fs/$env) so it can
 * be unit-tested and imported by the API endpoints without pulling in the heavier
 * sync orchestration.
 */

/** Selections coming from the Kometa tab. */
export interface SyncSelectionInput {
	/** Managed library section keys (Plex section ids). */
	libraries: string[];
	/** Enabled default collection names per section key. */
	defaults: Record<string, string[]>;
	/** Managed-setting id → value (empty value means "unmanage"). */
	settings: Record<string, string>;
}

/** Coerce an untrusted request body into a well-formed SyncSelectionInput. */
export function parseSelectionInput(body: unknown): SyncSelectionInput {
	const b = (body ?? {}) as Record<string, unknown>;
	const libraries = Array.isArray(b.libraries) ? b.libraries.map(String) : [];
	const defaults: Record<string, string[]> = {};
	if (b.defaults && typeof b.defaults === 'object' && !Array.isArray(b.defaults)) {
		for (const [k, v] of Object.entries(b.defaults as Record<string, unknown>)) {
			if (Array.isArray(v)) defaults[k] = v.map(String);
		}
	}
	const settings: Record<string, string> = {};
	if (b.settings && typeof b.settings === 'object' && !Array.isArray(b.settings)) {
		for (const [k, v] of Object.entries(b.settings as Record<string, unknown>)) {
			if (typeof v === 'string') settings[k] = v;
		}
	}
	return { libraries, defaults, settings };
}
