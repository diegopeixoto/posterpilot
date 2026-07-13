import { describe, expect, it } from 'vitest';
import type { AppConfig } from '$lib/server/config';
import { providerAvailability } from './availability';

const config = {
	providerMediux: true,
	providerTmdb: true,
	providerFanart: true,
	providerThePosterDb: false,
	tmdbKey: 'tmdb-key',
	fanartKey: null
} as AppConfig;

describe('providerAvailability', () => {
	it('distinguishes disabled providers from missing credentials', () => {
		expect(providerAvailability('mediux', config)).toBe('available');
		expect(providerAvailability('theposterdb', config)).toBe('disabled');
		expect(providerAvailability('fanarttv', config)).toBe('missing_credential');
	});

	it('requires the shared TMDB credential when TMDB artwork is enabled', () => {
		expect(providerAvailability('tmdb', { ...config, tmdbKey: null })).toBe('missing_credential');
	});
});
