import { describe, expect, it } from 'vitest';
import { deriveSetupResumeStep, setupConfigurationReady, setupServerReady } from './setup-progress';

const ready = {
	language: 'en',
	serverType: 'plex' as const,
	plexUrl: 'http://plex',
	plexTokenSet: true,
	jellyfinUrl: null,
	jellyfinApiKeySet: false,
	embyUrl: null,
	embyApiKeySet: false,
	tmdbKeySet: true,
	providerMediux: true,
	providerTmdb: true,
	providerFanart: false,
	providerThePosterDb: false
};

describe('setup progress derivation', () => {
	it('recognizes the credentials required by each server type', () => {
		expect(setupServerReady(ready)).toBe(true);
		expect(
			setupServerReady({
				...ready,
				serverType: 'jellyfin',
				jellyfinUrl: 'http://jellyfin',
				jellyfinApiKeySet: true
			})
		).toBe(true);
		expect(setupServerReady({ ...ready, plexTokenSet: false })).toBe(false);
	});

	it('resumes at the first invalid persisted step', () => {
		expect(
			deriveSetupResumeStep(
				{ ...ready, language: null },
				{ cachedLibraryCount: 2, successfulSync: false }
			)
		).toBe(0);
		expect(
			deriveSetupResumeStep(
				{ ...ready, plexTokenSet: false },
				{ cachedLibraryCount: 2, successfulSync: false }
			)
		).toBe(1);
		expect(
			deriveSetupResumeStep(
				{ ...ready, tmdbKeySet: false },
				{ cachedLibraryCount: 2, successfulSync: false }
			)
		).toBe(2);
		expect(
			deriveSetupResumeStep(
				{ ...ready, providerMediux: false, providerTmdb: false },
				{ cachedLibraryCount: 2, successfulSync: false }
			)
		).toBe(3);
		expect(deriveSetupResumeStep(ready, { cachedLibraryCount: 0, successfulSync: false })).toBe(4);
		expect(deriveSetupResumeStep(ready, { cachedLibraryCount: 0, successfulSync: true })).toBe(5);
		expect(deriveSetupResumeStep(ready, { cachedLibraryCount: 2, successfulSync: false })).toBe(5);
	});

	it('separates usable configuration from first-sync completion', () => {
		expect(setupConfigurationReady(ready)).toBe(true);
		expect(setupConfigurationReady({ ...ready, tmdbKeySet: false })).toBe(false);
	});
});
