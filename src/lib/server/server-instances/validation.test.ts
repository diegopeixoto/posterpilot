import { describe, expect, it } from 'vitest';
import {
	SERVER_INSTANCE_NAME_MAX_LENGTH,
	ServerInstanceError,
	assertServerInstanceType,
	hasCredentialReplacement,
	normalizeServerBaseUrl,
	normalizeServerInstanceName
} from './validation';

describe('server instance name normalization', () => {
	it('canonicalizes Unicode, spacing, and case for stable uniqueness', () => {
		expect(normalizeServerInstanceName('  Ｍy\t  PLEX  ')).toEqual({
			name: 'My PLEX',
			normalizedName: 'my plex'
		});
	});

	it('rejects empty, overlong, and invisible-control names', () => {
		for (const name of [
			'   ',
			'x'.repeat(SERVER_INSTANCE_NAME_MAX_LENGTH + 1),
			'Plex\u200BServer'
		]) {
			expect(() => normalizeServerInstanceName(name)).toThrowError(
				expect.objectContaining<Partial<ServerInstanceError>>({ code: 'invalid_name' })
			);
		}
	});
});

describe('server base URL normalization', () => {
	it('accepts HTTP(S), retains a sub-path, and removes only the trailing slash', () => {
		expect(normalizeServerBaseUrl(' http://PLEX.local:32400/ ')).toBe('http://plex.local:32400');
		expect(normalizeServerBaseUrl('https://media.local/jellyfin/')).toBe(
			'https://media.local/jellyfin'
		);
	});

	it('rejects credentials, query strings, fragments, and unsupported protocols', () => {
		for (const url of [
			'ftp://media.local',
			'http://user:secret@media.local',
			'https://media.local?token=secret',
			'https://media.local/#fragment',
			'media.local:32400'
		]) {
			expect(() => normalizeServerBaseUrl(url)).toThrowError(
				expect.objectContaining<Partial<ServerInstanceError>>({ code: 'invalid_base_url' })
			);
		}
	});
});

describe('server instance primitive validation', () => {
	it('accepts only supported server types', () => {
		for (const value of ['plex', 'jellyfin', 'emby']) {
			expect(() => assertServerInstanceType(value)).not.toThrow();
		}
		expect(() => assertServerInstanceType('other')).toThrowError(
			expect.objectContaining<Partial<ServerInstanceError>>({ code: 'invalid_server_type' })
		);
	});

	it('treats omitted, blank, and masked credentials as preservation, not replacement', () => {
		expect(hasCredentialReplacement(undefined)).toBe(false);
		expect(hasCredentialReplacement('')).toBe(false);
		expect(hasCredentialReplacement('   ')).toBe(false);
		expect(hasCredentialReplacement('********')).toBe(false);
		expect(hasCredentialReplacement('••••••••')).toBe(false);
		expect(hasCredentialReplacement('token')).toBe(true);
	});
});
