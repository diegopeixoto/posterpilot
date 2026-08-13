import { describe, expect, it } from 'vitest';
import { bypassesAuthStateLookup, classifyPath, safeRedirectTarget } from './guard';

describe('auth/guard · classifyPath', () => {
	it('treats the health probe, login, logout, and assets as public', () => {
		expect(classifyPath('/api/health')).toBe('public');
		expect(classifyPath('/api/ready')).toBe('public');
		expect(classifyPath('/login')).toBe('public');
		expect(classifyPath('/api/auth/logout')).toBe('public');
		expect(classifyPath('/api/automation-webhooks/automation-a')).toBe('public');
		expect(classifyPath('/_app/immutable/chunk.js')).toBe('public');
		expect(classifyPath('/favicon.ico')).toBe('public');
		expect(classifyPath('/logo.svg')).toBe('public');
	});

	it('treats other APIs as api (→ 401)', () => {
		expect(classifyPath('/api/settings')).toBe('api');
		expect(classifyPath('/api/jobs/5/stream')).toBe('api');
		expect(classifyPath('/api/auth/credentials')).toBe('api');
	});

	it('treats other pages as page (→ redirect)', () => {
		expect(classifyPath('/')).toBe('page');
		expect(classifyPath('/library')).toBe('page');
		expect(classifyPath('/settings')).toBe('page');
	});
});

describe('auth/guard · bypassesAuthStateLookup', () => {
	it('bypasses the database only for liveness and readiness probes', () => {
		expect(bypassesAuthStateLookup('/api/health')).toBe(true);
		expect(bypassesAuthStateLookup('/api/ready')).toBe(true);
	});

	it('keeps login and other public routes on the real auth state', () => {
		expect(bypassesAuthStateLookup('/login')).toBe(false);
		expect(bypassesAuthStateLookup('/api/auth/logout')).toBe(false);
		expect(bypassesAuthStateLookup('/api/automation-webhooks/automation-a')).toBe(false);
		expect(bypassesAuthStateLookup('/favicon.ico')).toBe(false);
	});
});

describe('auth/guard · safeRedirectTarget', () => {
	it('accepts same-site absolute paths', () => {
		expect(safeRedirectTarget('/library?x=1')).toBe('/library?x=1');
		expect(safeRedirectTarget('/')).toBe('/');
	});

	it('rejects open-redirect vectors', () => {
		expect(safeRedirectTarget('//evil.com')).toBeNull();
		expect(safeRedirectTarget('/\\evil.com')).toBeNull();
		expect(safeRedirectTarget('https://evil.com')).toBeNull();
		expect(safeRedirectTarget('evil.com')).toBeNull();
		expect(safeRedirectTarget('')).toBeNull();
		expect(safeRedirectTarget(null)).toBeNull();
	});
});
