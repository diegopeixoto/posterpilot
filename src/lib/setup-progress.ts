export interface SetupConfigSnapshot {
	language: string | null;
	serverType: 'plex' | 'jellyfin' | 'emby';
	plexUrl: string | null;
	plexTokenSet: boolean;
	jellyfinUrl: string | null;
	jellyfinApiKeySet: boolean;
	embyUrl: string | null;
	embyApiKeySet: boolean;
	tmdbKeySet: boolean;
	providerMediux: boolean;
	providerTmdb: boolean;
	providerFanart: boolean;
	providerThePosterDb: boolean;
}

export function setupServerReady(config: SetupConfigSnapshot): boolean {
	if (config.serverType === 'plex') return Boolean(config.plexUrl && config.plexTokenSet);
	if (config.serverType === 'jellyfin') {
		return Boolean(config.jellyfinUrl && config.jellyfinApiKeySet);
	}
	return Boolean(config.embyUrl && config.embyApiKeySet);
}

/** First setup step that still needs attention, derived only from valid persisted state. */
export function deriveSetupResumeStep(
	config: SetupConfigSnapshot,
	options: { cachedLibraryCount: number; successfulSync: boolean }
): number {
	if (!config.language) return 0;
	if (!setupServerReady(config)) return 1;
	if (!config.tmdbKeySet) return 2;
	if (
		!config.providerMediux &&
		!config.providerTmdb &&
		!config.providerFanart &&
		!config.providerThePosterDb
	) {
		return 3;
	}
	if (!options.successfulSync && options.cachedLibraryCount === 0) return 4;
	return 5;
}

export function setupConfigurationReady(config: SetupConfigSnapshot): boolean {
	return setupServerReady(config) && config.tmdbKeySet;
}
