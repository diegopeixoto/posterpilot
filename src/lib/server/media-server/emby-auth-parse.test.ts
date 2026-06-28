import { describe, expect, it } from 'vitest';
import { parseAuthResult } from './emby-parse';

describe('parseAuthResult', () => {
	it('extracts the access token and user', () => {
		const result = parseAuthResult({
			AccessToken: 'tok-123',
			User: { Id: 'user-1', Name: 'alice' }
		});
		expect(result).toEqual({ accessToken: 'tok-123', userId: 'user-1', userName: 'alice' });
	});

	it('returns null when no access token is present', () => {
		expect(parseAuthResult({ User: { Id: 'user-1' } })).toBeNull();
		expect(parseAuthResult({ AccessToken: '' })).toBeNull();
		expect(parseAuthResult(null)).toBeNull();
		expect(parseAuthResult(undefined)).toBeNull();
	});

	it('tolerates a missing user object', () => {
		const result = parseAuthResult({ AccessToken: 'tok-9' });
		expect(result).toEqual({ accessToken: 'tok-9', userId: '', userName: null });
	});
});
