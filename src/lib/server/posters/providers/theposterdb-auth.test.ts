import { describe, expect, it } from 'vitest';
import { extractLoginToken, looksLikeRejectedLogin } from './theposterdb-auth';

describe('extractLoginToken', () => {
	it('extracts the CSRF _token hidden-input value', () => {
		const html = `<form method="POST" action="https://theposterdb.com/login">
			<input type="hidden" name="_token" value="Y6MpZOrbHFVBB5bZKWBfK9AkQKAxlFq34uhoS7dM" autocomplete="off">
			<input id="login" type="text" name="login" required>`;
		expect(extractLoginToken(html)).toBe('Y6MpZOrbHFVBB5bZKWBfK9AkQKAxlFq34uhoS7dM');
	});

	it('returns null when no token is present', () => {
		expect(extractLoginToken('<html>no form here</html>')).toBeNull();
	});
});

describe('looksLikeRejectedLogin', () => {
	it('detects the login form re-rendered with a fresh token', () => {
		const html = `<input type="hidden" name="_token" value="freshTokenAfterRejection">
			<input id="password" type="password" name="password">`;
		expect(looksLikeRejectedLogin(html)).toBe(true);
	});

	it('is false for a page with neither field (e.g. the post-login dashboard)', () => {
		expect(looksLikeRejectedLogin('<html>Welcome back</html>')).toBe(false);
	});
});
