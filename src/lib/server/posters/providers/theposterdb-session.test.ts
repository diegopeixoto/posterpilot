import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThePosterDbAuthError } from './theposterdb-auth';
import { getThePosterDbSession, invalidateThePosterDbSession } from './theposterdb-session';

vi.mock('./theposterdb-auth', async (importOriginal) => ({
	...(await importOriginal<typeof import('./theposterdb-auth')>()),
	loginToThePosterDb: vi.fn()
}));
import { loginToThePosterDb } from './theposterdb-auth';

beforeEach(() => {
	vi.mocked(loginToThePosterDb).mockReset();
	invalidateThePosterDbSession();
});

describe('ThePosterDB session', () => {
	it('gives concurrent strict and best-effort callers their own failure semantics', async () => {
		let reject!: (error: Error) => void;
		vi.mocked(loginToThePosterDb).mockReturnValue(
			new Promise((_, fail) => {
				reject = fail;
			})
		);
		const bestEffort = getThePosterDbSession('user', 'password');
		const strict = getThePosterDbSession('user', 'password', { throwOnFailure: true });
		reject(new ThePosterDbAuthError('rejected'));
		await expect(bestEffort).resolves.toBeNull();
		await expect(strict).rejects.toBeInstanceOf(ThePosterDbAuthError);
		expect(loginToThePosterDb).toHaveBeenCalledTimes(1);
	});

	it('shares a successful login and caches the result', async () => {
		vi.mocked(loginToThePosterDb).mockResolvedValue('session=abc');
		await expect(
			Promise.all([
				getThePosterDbSession('user', 'password'),
				getThePosterDbSession('user', 'password', { throwOnFailure: true })
			])
		).resolves.toEqual(['session=abc', 'session=abc']);
		await expect(getThePosterDbSession('user', 'password')).resolves.toBe('session=abc');
		expect(loginToThePosterDb).toHaveBeenCalledTimes(1);
	});

	it('allows anonymous discovery when credentials are absent', async () => {
		await expect(getThePosterDbSession(null, null, { throwOnFailure: true })).resolves.toBeNull();
		expect(loginToThePosterDb).not.toHaveBeenCalled();
	});
});
