import { describe, expect, it } from 'vitest';
import { LoginThrottle, MAX_FAILURES, WINDOW_MS } from './login-throttle';

const T0 = 1_700_000_000_000;

describe('auth/login-throttle', () => {
	it('is not locked below the threshold', () => {
		const t = new LoginThrottle();
		for (let i = 0; i < MAX_FAILURES - 1; i++) t.recordFailure('ip', T0);
		expect(t.isLocked('ip', T0)).toBe(false);
	});

	it('locks once the threshold is reached', () => {
		const t = new LoginThrottle();
		let locked = false;
		for (let i = 0; i < MAX_FAILURES; i++) locked = t.recordFailure('ip', T0);
		expect(locked).toBe(true);
		expect(t.isLocked('ip', T0)).toBe(true);
	});

	it('rolls the window over after it expires', () => {
		const t = new LoginThrottle();
		for (let i = 0; i < MAX_FAILURES; i++) t.recordFailure('ip', T0);
		expect(t.isLocked('ip', T0 + WINDOW_MS + 1)).toBe(false);
	});

	it('reset clears a client', () => {
		const t = new LoginThrottle();
		for (let i = 0; i < MAX_FAILURES; i++) t.recordFailure('ip', T0);
		t.reset('ip');
		expect(t.isLocked('ip', T0)).toBe(false);
	});

	it('tracks clients independently', () => {
		const t = new LoginThrottle();
		for (let i = 0; i < MAX_FAILURES; i++) t.recordFailure('a', T0);
		expect(t.isLocked('a', T0)).toBe(true);
		expect(t.isLocked('b', T0)).toBe(false);
	});
});
